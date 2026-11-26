// Admin record management: void / replace invoices, edit / archive products,
// set or clear stock. Posted invoices stay immutable in D1 (triggers); a
// "delete" is a void (status=cancelled, stock returned, payments reversed) and
// an "edit" is void + a new invoice in the same transaction. Everything is audited.
import { Hono } from "hono";
import { z } from "zod";
import { audit, current, now, uuid, type Env } from "./security";

const routes = new Hono<Env>();
const safe = z.string().trim().min(1).max(180);

type InvoiceRow = {
  id: string;
  number: string;
  status: string;
  paid_cents: number;
  total_cents: number;
  warehouse_id: string;
  source_type: string | null;
};

/** Statements that void a posted invoice. Run them in one db.batch (atomic). */
export async function voidInvoiceStatements(db: D1Database, invoiceId: string) {
  const invoice = await db
    .prepare("SELECT id,number,status,paid_cents,total_cents,warehouse_id,source_type FROM invoices WHERE id=?")
    .bind(invoiceId)
    .first<InvoiceRow>();
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status !== "posted") throw new Error("Invoice is already cancelled");
  if (invoice.source_type === "consignment")
    throw new Error("Consignment settlement invoices can't be voided here");
  const [items, payments, credit] = await Promise.all([
    db
      .prepare("SELECT variant_id,quantity FROM invoice_items WHERE invoice_id=?")
      .bind(invoiceId)
      .all<{ variant_id: string; quantity: number }>(),
    db
      .prepare("SELECT id,amount_cents,method,created_at FROM payments WHERE invoice_id=?")
      .bind(invoiceId)
      .all<{ id: string; amount_cents: number; method: string; created_at: string }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM credit_notes WHERE invoice_id=? AND status='posted'")
      .bind(invoiceId)
      .first<{ n: number }>(),
  ]);
  if (credit?.n) throw new Error("This invoice has a credit note (return); it can't be voided");
  const stamp = now();
  // Stock goes back only for movements the sale actually made (consignment/skip-stock sales made none).
  const sold = await db
    .prepare("SELECT variant_id,from_warehouse,SUM(quantity) AS quantity FROM stock_movements WHERE reference_id=? AND reason='sale' AND from_warehouse IS NOT NULL GROUP BY variant_id,from_warehouse")
    .bind(invoiceId)
    .all<{ variant_id: string; from_warehouse: string; quantity: number }>();
  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE invoices SET status='cancelled',cancelled_at=?,paid_cents=0 WHERE id=? AND status='posted'")
      .bind(stamp, invoiceId),
    db.prepare("DELETE FROM payments WHERE invoice_id=?").bind(invoiceId),
    ...sold.results.flatMap((x) => [
      db
        .prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)")
        .bind(uuid(), x.variant_id, null, x.from_warehouse, x.quantity, "invoice_reversal", invoiceId, stamp),
      db
        .prepare("INSERT INTO stock_balances VALUES(?,?,?) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET quantity=quantity+excluded.quantity")
        .bind(x.from_warehouse, x.variant_id, x.quantity),
    ]),
  ];
  const snapshot = {
    number: invoice.number,
    totalCents: invoice.total_cents,
    paidCents: invoice.paid_cents,
    items: items.results,
    reversedPayments: payments.results,
    restocked: sold.results,
  };
  return { statements, snapshot };
}

routes.post("/invoices/:id/void", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const id = c.req.param("id"),
    db = c.env.DB,
    body = await c.req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 300) : "";
  try {
    const { statements, snapshot } = await voidInvoiceStatements(db, id);
    await db.batch(statements);
    await audit(db, p.id, "invoice.voided", id, JSON.stringify({ reason, ...snapshot }));
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});

const productPatch = z.object({
  name: safe,
  sku: safe,
  barcode: z.string().max(80).nullable().optional(),
  variants: z
    .array(
      z.object({
        id: z.string().min(1).optional(), // no id = new variant
        label: safe,
        unit: safe,
        grams: z.number().int().positive().nullable().optional(),
        retailCents: z.number().int().nonnegative(),
        wholesaleCents: z.number().int().nonnegative(),
        shopPriceCents: z.number().int().nonnegative(),
        costCents: z.number().int().nonnegative(),
        lowStock: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  removeVariantIds: z.array(z.string().min(1)).max(50).default([]),
});

routes.get("/products/:id", async (c) => {
  if (!current(c).admin) return c.json({ error: "Admin only" }, 403);
  const db = c.env.DB,
    id = c.req.param("id");
  const product = await db.prepare("SELECT id,name,sku,barcode,active FROM products WHERE id=?").bind(id).first();
  if (!product) return c.json({ error: "Not found" }, 404);
  const variants = (
    await db
      .prepare("SELECT id,label,unit,grams,retail_cents,wholesale_cents,shop_price_cents,cost_cents,low_stock FROM product_variants WHERE product_id=?")
      .bind(id)
      .all()
  ).results;
  return c.json({ product, variants });
});

routes.patch("/products/:id", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const parsed = productPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the product details" }, 400);
  const d = parsed.data,
    db = c.env.DB,
    id = c.req.param("id");
  const owned = (
    await db.prepare("SELECT id FROM product_variants WHERE product_id=?").bind(id).all<{ id: string }>()
  ).results.map((x) => x.id);
  if (!owned.length) return c.json({ error: "Product not found" }, 404);
  if (d.variants.some((v) => v.id && !owned.includes(v.id))) return c.json({ error: "Unknown variant" }, 400);
  if (d.removeVariantIds.some((v) => !owned.includes(v))) return c.json({ error: "Unknown variant" }, 400);
  if (owned.length - d.removeVariantIds.length + d.variants.filter((v) => !v.id).length < 1)
    return c.json({ error: "A product needs at least one pack size. Delete the product instead." }, 400);
  // Removing a pack size is only possible if it was never sold / moved (history must stay).
  for (const vid of d.removeVariantIds) {
    const used = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM invoice_items WHERE variant_id=?1)+(SELECT COUNT(*) FROM stock_movements WHERE variant_id=?1)+(SELECT COUNT(*) FROM credit_note_items WHERE variant_id=?1) AS n`,
      )
      .bind(vid)
      .first<{ n: number }>();
    if (used?.n) return c.json({ error: "This pack size already has sales or stock history, so it can't be removed. Set its stock to 0 instead." }, 409);
  }
  try {
    await db.batch([
      ...d.removeVariantIds.flatMap((vid) => [
        db.prepare("DELETE FROM stock_balance_status WHERE variant_id=?").bind(vid),
        db.prepare("DELETE FROM stock_balances WHERE variant_id=?").bind(vid),
        db.prepare("DELETE FROM product_variants WHERE id=? AND product_id=?").bind(vid, id),
      ]),
      ...d.variants
        .filter((v) => !v.id)
        .map((v) =>
          db
            .prepare("INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .bind(uuid(), id, v.label, v.unit, v.grams ?? null, v.retailCents, v.wholesaleCents, v.costCents, v.lowStock, v.shopPriceCents),
        ),
      db
        .prepare("UPDATE products SET name=?,sku=?,barcode=? WHERE id=?")
        .bind(d.name, d.sku, d.barcode || null, id),
      ...d.variants.filter((v) => v.id).map((v) =>
        db
          .prepare("UPDATE product_variants SET label=?,unit=?,grams=?,retail_cents=?,wholesale_cents=?,shop_price_cents=?,cost_cents=?,low_stock=? WHERE id=? AND product_id=?")
          .bind(v.label, v.unit, v.grams ?? null, v.retailCents, v.wholesaleCents, v.shopPriceCents, v.costCents, v.lowStock, v.id, id),
      ),
    ]);
  } catch (error) {
    const msg = (error as Error).message;
    return c.json({ error: /UNIQUE/i.test(msg) ? "SKU or barcode is already used by another product" : msg }, 409);
  }
  await audit(db, p.id, "product.updated", id, JSON.stringify(d));
  return c.json({ ok: true });
});

routes.delete("/products/:id", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const db = c.env.DB,
    id = c.req.param("id");
  const product = await db.prepare("SELECT id,name FROM products WHERE id=?").bind(id).first<{ id: string; name: string }>();
  if (!product) return c.json({ error: "Product not found" }, 404);
  // Never used anywhere → remove for good. Any history (sales, stock movements,
  // returns, transfers…) → foreign keys reject the delete, so archive instead.
  try {
    await db.batch([
      db.prepare("DELETE FROM stock_balance_status WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id=?)").bind(id),
      db.prepare("DELETE FROM stock_balances WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id=?)").bind(id),
      db.prepare("DELETE FROM product_variants WHERE product_id=?").bind(id),
      db.prepare("DELETE FROM products WHERE id=?").bind(id),
    ]);
    await audit(db, p.id, "product.deleted", id, product.name);
    return c.json({ ok: true, mode: "deleted" });
  } catch {
    await db.prepare("UPDATE products SET active=0 WHERE id=?").bind(id).run();
    await audit(db, p.id, "product.archived", id, product.name);
    return c.json({ ok: true, mode: "archived" });
  }
});

routes.post("/stock/set", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const parsed = z
    .object({
      warehouseId: z.string().min(1),
      variantId: z.string().min(1),
      quantity: z.number().int().nonnegative(),
      reason: z.string().trim().max(180).optional(),
      remove: z.boolean().optional(), // also remove the (now empty) stock line from the list
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter a valid quantity (0 or more)" }, 400);
  const d = parsed.data,
    db = c.env.DB;
  const row = await db
    .prepare("SELECT quantity FROM stock_balances WHERE warehouse_id=? AND variant_id=?")
    .bind(d.warehouseId, d.variantId)
    .first<{ quantity: number }>();
  if (!row) return c.json({ error: "Stock line not found" }, 404);
  const delta = d.quantity - row.quantity;
  const removeLine = () =>
    d.remove && d.quantity === 0
      ? db.batch([
          db.prepare("DELETE FROM stock_balance_status WHERE warehouse_id=? AND variant_id=?").bind(d.warehouseId, d.variantId),
          db.prepare("DELETE FROM stock_balances WHERE warehouse_id=? AND variant_id=? AND quantity=0").bind(d.warehouseId, d.variantId),
        ])
      : null;
  if (!delta) {
    await removeLine();
    return c.json({ ok: true, delta: 0 });
  }
  const id = uuid(),
    reason = d.reason || (d.quantity === 0 ? "Admin cleared stock" : "Admin stock correction");
  // Both statements are guarded by the quantity we read, so a sale that lands
  // in between can't be overwritten (and the movement log never drifts).
  const result = await db.batch([
    db
      .prepare("INSERT INTO stock_movements SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stock_balances WHERE warehouse_id=? AND variant_id=? AND quantity=?)")
      .bind(id, d.variantId, delta < 0 ? d.warehouseId : null, delta > 0 ? d.warehouseId : null, Math.abs(delta), reason, null, now(), d.warehouseId, d.variantId, row.quantity),
    db
      .prepare("UPDATE stock_balances SET quantity=? WHERE warehouse_id=? AND variant_id=? AND quantity=?")
      .bind(d.quantity, d.warehouseId, d.variantId, row.quantity),
  ]);
  if (!result[1].meta.changes) return c.json({ error: "Stock changed just now — refresh and try again" }, 409);
  await removeLine();
  await audit(db, p.id, "stock.set", id, JSON.stringify({ ...d, from: row.quantity }));
  return c.json({ ok: true, delta });
});

/* --------------------------------------------------------------- customers */

routes.delete("/customers/:id", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const db = c.env.DB,
    id = c.req.param("id");
  const cust = await db.prepare("SELECT shop_name FROM customers WHERE id=?").bind(id).first<{ shop_name: string }>();
  if (!cust) return c.json({ error: "Customer not found" }, 404);
  // No bills / history → remove for good. Otherwise hide it (history keeps the name).
  try {
    await db.batch([
      db.prepare("DELETE FROM customer_assignments WHERE customer_id=?").bind(id),
      db.prepare("DELETE FROM customer_geo WHERE customer_id=?").bind(id),
      db.prepare("DELETE FROM credit_terms WHERE customer_id=?").bind(id),
      db.prepare("DELETE FROM customers WHERE id=?").bind(id),
    ]);
    await audit(db, p.id, "customer.deleted", id, cust.shop_name);
    return c.json({ ok: true, mode: "deleted" });
  } catch {
    await db.prepare("UPDATE customers SET active=0 WHERE id=?").bind(id).run();
    await audit(db, p.id, "customer.archived", id, cust.shop_name);
    return c.json({ ok: true, mode: "archived" });
  }
});

/** Assign a shop to sales reps (replaces the current assignment). */
routes.put("/customers/:id/reps", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const parsed = z.object({ repIds: z.array(z.string().min(1)).max(20) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid sales reps" }, 400);
  const db = c.env.DB,
    id = c.req.param("id");
  await db.batch([
    db.prepare("DELETE FROM customer_assignments WHERE customer_id=?").bind(id),
    ...parsed.data.repIds.map((r) => db.prepare("INSERT OR IGNORE INTO customer_assignments(customer_id,rep_id) SELECT ?,id FROM users WHERE id=?").bind(id, r)),
  ]);
  await audit(db, p.id, "customer.assigned", id, JSON.stringify(parsed.data.repIds));
  return c.json({ ok: true });
});

routes.get("/customers/:id/reps", async (c) => {
  if (!current(c).admin) return c.json({ error: "Admin only" }, 403);
  const rows = (await c.env.DB.prepare("SELECT rep_id FROM customer_assignments WHERE customer_id=?").bind(c.req.param("id")).all<{ rep_id: string }>()).results;
  return c.json(rows.map((r) => r.rep_id));
});

/* ---------------------------------------------------------------- payments */

/** Remove a wrongly recorded payment: the invoice balance goes back up. */
routes.delete("/payments/:id", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const db = c.env.DB,
    id = c.req.param("id");
  const pay = await db
    .prepare("SELECT p.id,p.invoice_id,p.amount_cents,p.method,p.created_at,i.number,i.status,i.paid_cents FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.id=?")
    .bind(id)
    .first<{ invoice_id: string; amount_cents: number; number: string; status: string; paid_cents: number }>();
  if (!pay) return c.json({ error: "Payment not found" }, 404);
  const result = await db.batch([
    db.prepare("UPDATE invoices SET paid_cents=paid_cents-? WHERE id=? AND paid_cents>=?").bind(pay.amount_cents, pay.invoice_id, pay.amount_cents),
    db.prepare("DELETE FROM payments WHERE id=? AND EXISTS(SELECT 1 FROM invoices WHERE id=? AND paid_cents>=0)").bind(id, pay.invoice_id),
  ]);
  if (!result[0].meta.changes) return c.json({ error: "Invoice balance doesn't match this payment — not removed." }, 409);
  await audit(db, p.id, "payment.deleted", id, JSON.stringify(pay));
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- vehicles */

routes.delete("/vehicles/:id", async (c) => {
  const p = current(c);
  if (!p.admin) return c.json({ error: "Admin only" }, 403);
  const db = c.env.DB,
    id = c.req.param("id");
  const v = await db.prepare("SELECT registration_number,stock_warehouse_id FROM vehicles WHERE id=?").bind(id).first<{ registration_number: string; stock_warehouse_id: string }>();
  if (!v) return c.json({ error: "Vehicle not found" }, 404);
  const stock = await db.prepare("SELECT COALESCE(SUM(quantity),0) AS q FROM stock_balances WHERE warehouse_id=?").bind(v.stock_warehouse_id).first<{ q: number }>();
  if (stock?.q) return c.json({ error: "This vehicle still has stock. Transfer or clear it first." }, 409);
  try {
    await db.batch([
      db.prepare("DELETE FROM vehicles WHERE id=?").bind(id),
      db.prepare("DELETE FROM stock_balance_status WHERE warehouse_id=?").bind(v.stock_warehouse_id),
      db.prepare("DELETE FROM stock_balances WHERE warehouse_id=?").bind(v.stock_warehouse_id),
      db.prepare("DELETE FROM warehouse_metadata WHERE warehouse_id=?").bind(v.stock_warehouse_id),
      db.prepare("DELETE FROM warehouses WHERE id=?").bind(v.stock_warehouse_id),
    ]);
    await audit(db, p.id, "vehicle.deleted", id, v.registration_number);
    return c.json({ ok: true, mode: "deleted" });
  } catch {
    await db.prepare("UPDATE vehicles SET status='Inactive',updated_at=? WHERE id=?").bind(now(), id).run();
    await audit(db, p.id, "vehicle.archived", id, v.registration_number);
    return c.json({ ok: true, mode: "archived" });
  }
});

export default routes;
