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
        id: z.string().min(1),
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
  if (d.variants.some((v) => !owned.includes(v.id))) return c.json({ error: "Unknown variant" }, 400);
  try {
    await db.batch([
      db
        .prepare("UPDATE products SET name=?,sku=?,barcode=? WHERE id=?")
        .bind(d.name, d.sku, d.barcode || null, id),
      ...d.variants.map((v) =>
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
  if (!delta) return c.json({ ok: true, delta: 0 });
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
  await audit(db, p.id, "stock.set", id, JSON.stringify({ ...d, from: row.quantity }));
  return c.json({ ok: true, delta });
});

export default routes;
