import { Hono } from "hono";
import { z } from "zod";
import {
  audit,
  current,
  guard,
  now,
  permission,
  uuid,
  type Env,
  type Principal,
} from "./security";
import { dueDate, invoiceTotals, lineTotal, normalizeWhatsApp, formatWhatsApp, type Discount } from "./finance";

const routes = new Hono<Env>();
const safe = z.string().trim().min(1).max(300);
const key = z.string().min(12).max(128);
const discount = z.object({
  type: z.enum(["fixed", "percent"]),
  value: z.number().int().nonnegative(),
});
const invoiceLine = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  priceType: z.enum(["wholesale", "retail", "shop"]),
  discount: discount.optional(),
});
const billingInput = z.object({
  customerId: z.string().min(1),
  warehouseId: z.string().min(1),
  idempotencyKey: key,
  invoiceDate: z.string().date(),
  items: z.array(invoiceLine).min(1),
  invoiceDiscount: discount.optional(),
  amountPaidCents: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(["cash", "bank", "credit", "other"]).default("cash"),
  paymentTerms: z.string().max(500).default(""),
  dueAt: z.string().date().nullable().optional(),
  notes: z.string().max(1000).default(""),
  terms: z.string().max(1500).default(""),
  customerWhatsapp: z.string().max(40).optional().default(""),
  draftId: z.string().optional(),
});
const distributionItems = z
  .array(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
  )
  .min(1);
const json = async <T extends z.ZodTypeAny>(
  c: any,
  schema: T,
): Promise<z.infer<T>> => schema.parse(await c.req.json());
const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const ref = (prefix: string, id: string, date = localDate()) =>
  `${prefix}-${date.replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;

async function checkScope(
  c: any,
  p: Principal,
  customerId: string,
  warehouseId: string,
) {
  if (p.admin) return null;
  const [customer, warehouse] = await Promise.all([
    c.env.DB.prepare(
      "SELECT 1 FROM customer_assignments WHERE customer_id=? AND rep_id=?",
    )
      .bind(customerId, p.id)
      .first(),
    c.env.DB.prepare("SELECT 1 FROM warehouses WHERE id=? AND rep_id=?")
      .bind(warehouseId, p.id)
      .first(),
  ]);
  if (!customer) return c.json({ error: "Customer not assigned" }, 403);
  if (!warehouse) return c.json({ error: "Stock location not assigned" }, 403);
  return null;
}

type VariantRow = {
  id: string;
  retail_cents: number;
  wholesale_cents: number;
  shop_price_cents: number;
  cost_cents: number;
};
async function variants(db: D1Database, ids: string[]) {
  const rows = new Map<string, VariantRow>();
  for (const id of ids) {
    const row = await db
      .prepare(
        "SELECT v.id,v.retail_cents,v.wholesale_cents,v.shop_price_cents,v.cost_cents FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1",
      )
      .bind(id)
      .first<VariantRow>();
    if (!row) throw new Error("Product variant unavailable");
    rows.set(id, row);
  }
  return rows;
}

function selectedPrice(v: VariantRow, type: "wholesale" | "retail" | "shop") {
  const price =
    type === "retail"
      ? v.retail_cents
      : type === "shop"
        ? v.shop_price_cents
        : v.wholesale_cents;
  if (type === "shop" && price === 0)
    throw new Error("Shop selling price is not configured");
  return price;
}

async function postInvoice(
  c: any,
  input: z.infer<typeof billingInput>,
  sourceType = "sale",
  sourceId: string | null = null,
  skipStock = false,
) {
  const db: D1Database = c.env.DB,
    p = current(c),
    existing = await db
      .prepare("SELECT id,number FROM invoices WHERE idempotency_key=?")
      .bind(input.idempotencyKey)
      .first();
  if (existing) return { existing };
  if (new Set(input.items.map((x) => x.variantId)).size !== input.items.length)
    throw new Error("Duplicate product variants are not allowed");
  const customer = await db
    .prepare(
      "SELECT id,credit_days,credit_limit_cents,whatsapp,phone FROM customers WHERE id=? AND active=1",
    )
    .bind(input.customerId)
    .first<{ id: string; credit_days: number; credit_limit_cents: number; whatsapp: string; phone: string }>();
  if (!customer) throw new Error("Customer unavailable");
  const scope = await checkScope(c, p, input.customerId, input.warehouseId);
  if (scope) return { response: scope };
  const rows = await variants(
    db,
    input.items.map((x) => x.variantId),
  );
  const calculated = input.items.map((item) => {
    const variant = rows.get(item.variantId)!;
    const unitPriceCents = selectedPrice(variant, item.priceType);
    return {
      ...item,
      unitPriceCents,
      costCents: variant.cost_cents,
      shopPriceCents: variant.shop_price_cents,
      lineGrossCents: lineTotal(unitPriceCents, item.quantity),
    };
  });
  const totals = invoiceTotals(
    calculated.map((x) => ({
      unitPriceCents: x.unitPriceCents,
      quantity: x.quantity,
      discount: x.discount as Discount | undefined,
    })),
    input.invoiceDiscount as Discount | undefined,
  );
  if (input.amountPaidCents > totals.totalCents)
    throw new Error("Amount paid exceeds invoice total");
  const outstanding = totals.totalCents - input.amountPaidCents;
  let due: string | null = null;
  if (outstanding > 0) {
    if (customer.credit_days === 0)
      throw new Error("Customer has no credit terms");
    const maximum = dueDate(input.invoiceDate, customer.credit_days);
    due = input.dueAt || maximum;
    if (due < input.invoiceDate || due > maximum)
      throw new Error(
        `Due date must be between ${input.invoiceDate} and ${maximum}`,
      );
  }
  const id = uuid(),
    number = ref("INV", id, input.invoiceDate),
    created = now(),
    shareToken = (uuid() + uuid()).replace(/-/g, ""),
    customerWhatsapp = normalizeWhatsApp(input.customerWhatsapp || (customer as any).whatsapp || (customer as any).phone || "");
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        number,
        input.customerId,
        p.id,
        input.warehouseId,
        totals.totalCents,
        input.amountPaidCents,
        "posted",
        due,
        input.idempotencyKey,
        created,
        null,
        totals.subtotalCents,
        totals.itemDiscountCents,
        totals.invoiceDiscountCents,
        input.paymentMethod,
        input.paymentTerms,
        input.notes,
        input.terms,
        sourceType,
        sourceId,
        customerWhatsapp,
        shareToken,
      ),
  ];
  for (const item of calculated) {
    const itemDiscount = invoiceTotals([
      {
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        discount: item.discount as Discount | undefined,
      },
    ]).itemDiscountCents;
    statements.push(
      db
        .prepare(
          `INSERT INTO invoice_items(id,invoice_id,variant_id,quantity,unit_price_cents,cost_cents,line_cents,price_type,item_discount_cents,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          uuid(),
          id,
          item.variantId,
          item.quantity,
          item.unitPriceCents,
          item.costCents,
          item.lineGrossCents - itemDiscount,
          item.priceType,
          itemDiscount,
          item.shopPriceCents,
        ),
    );
    if (!skipStock) {
      statements.push(
        db
          .prepare(
            "INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .bind(
            uuid(),
            item.variantId,
            input.warehouseId,
            null,
            item.quantity,
            "sale",
            id,
            created,
          ),
      );
      statements.push(
        db
          .prepare(
            "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
          )
          .bind(item.quantity, input.warehouseId, item.variantId),
      );
    }
  }
  if (input.amountPaidCents)
    statements.push(
      db
        .prepare(
          "INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          id,
          input.amountPaidCents,
          input.paymentMethod === "credit" ? "other" : input.paymentMethod,
          `${input.idempotencyKey}:initial`,
          p.id,
          created,
        ),
    );
  if (input.draftId)
    statements.push(
      db
        .prepare("DELETE FROM invoice_drafts WHERE id=? AND rep_id=?")
        .bind(input.draftId, p.id),
    );
  await db.batch(statements);
  await audit(
    db,
    p.id,
    "invoice.posted",
    id,
    JSON.stringify({ sourceType, sourceId, totals }),
  );
  return {
    invoice: {
      id,
      number,
      ...totals,
      paidCents: input.amountPaidCents,
      dueAt: due,
      customerWhatsapp,
      shareToken,
    },
  };
}

routes.post("/billing/invoices", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  try {
    const result = await postInvoice(c, await json(c, billingInput));
    if (result.response) return result.response;
    if (result.existing) return c.json(result.existing);
    return c.json(result.invoice, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

routes.get("/billing/settings", async (c) => {
  const denied = await guard(c, "settings.view");
  if (denied) return denied;
  const rows = (
    await c.env.DB.prepare(
      "SELECT key,value FROM system_settings WHERE key IN('invoice_show_shop_price','invoice_default_terms','invoice_show_customer_whatsapp')",
    ).all<{ key: string; value: string }>()
  ).results;
  return c.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
});
routes.patch("/billing/settings", async (c) => {
  const denied = await guard(c, "settings.edit");
  if (denied) return denied;
  const d = await json(
    c,
    z.object({
      showShopPrice: z.boolean().optional(),
      showCustomerWhatsapp: z.boolean().optional(),
      defaultTerms: z.string().max(1500).optional(),
    }),
  );
  const stmts: any[] = [];
  if (d.showShopPrice !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO system_settings(key,value) VALUES('invoice_show_shop_price',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(String(d.showShopPrice)),
    );
  }
  if (d.showCustomerWhatsapp !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO system_settings(key,value) VALUES('invoice_show_customer_whatsapp',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(String(d.showCustomerWhatsapp)),
    );
  }
  if (d.defaultTerms !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO system_settings(key,value) VALUES('invoice_default_terms',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(d.defaultTerms),
    );
  }
  if (stmts.length) {
    await c.env.DB.batch(stmts);
    await audit(c.env.DB, current(c).id, "billing.settings_updated", null);
  }
  return c.json({ ok: true });
});

routes.patch("/invoices/:id/whatsapp", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const p = current(c),
    id = c.req.param("id"),
    db = c.env.DB;
  const d = await json(c, z.object({ whatsapp: z.string().max(40) }));
  const normalized = normalizeWhatsApp(d.whatsapp);
  if (!normalized) return c.json({ error: "Invalid WhatsApp number" }, 400);
  const invoice = await db
    .prepare("SELECT id,rep_id,customer_whatsapp FROM invoices WHERE id=?")
    .bind(id)
    .first<{ id: string; rep_id: string; customer_whatsapp: string }>();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (!p.admin && invoice.rep_id !== p.id) return c.json({ error: "Forbidden" }, 403);
  const oldPhone = invoice.customer_whatsapp || "";
  await db.prepare("UPDATE invoices SET customer_whatsapp=? WHERE id=?").bind(normalized, id).run();
  await audit(db, p.id, "invoice.whatsapp_updated", id, JSON.stringify({ old: oldPhone, new: normalized }));
  return c.json({ ok: true, whatsapp: normalized });
});

routes.get("/invoice-drafts", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const p = current(c);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT d.*,c.shop_name FROM invoice_drafts d JOIN customers c ON c.id=d.customer_id WHERE (?=1 OR d.rep_id=?) ORDER BY d.updated_at DESC LIMIT 100",
      )
        .bind(p.admin, p.id)
        .all()
    ).results,
  );
});
routes.post("/invoice-drafts", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const p = current(c),
    d = await json(
      c,
      billingInput.omit({ idempotencyKey: true, amountPaidCents: true }),
    ),
    id = uuid(),
    stamp = now();
  const scope = await checkScope(c, p, d.customerId, d.warehouseId);
  if (scope) return scope;
  await c.env.DB.prepare(
    `INSERT INTO invoice_drafts(id,customer_id,rep_id,warehouse_id,invoice_date,due_at,payment_method,payment_terms,notes,terms,invoice_discount_type,invoice_discount_value,payload_json,created_at,updated_at,customer_whatsapp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      d.customerId,
      p.id,
      d.warehouseId,
      d.invoiceDate,
      d.dueAt || null,
      d.paymentMethod,
      d.paymentTerms,
      d.notes,
      d.terms,
      d.invoiceDiscount?.type || "fixed",
      d.invoiceDiscount?.value || 0,
      JSON.stringify(d),
      stamp,
      stamp,
    )
    .run();
  await audit(c.env.DB, p.id, "invoice.draft_created", id);
  return c.json({ id }, 201);
});
routes.patch("/invoice-drafts/:id", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const p = current(c),
    d = await json(
      c,
      billingInput.omit({ idempotencyKey: true, amountPaidCents: true }),
    ),
    id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `UPDATE invoice_drafts SET customer_id=?,warehouse_id=?,invoice_date=?,due_at=?,payment_method=?,payment_terms=?,notes=?,terms=?,invoice_discount_type=?,invoice_discount_value=?,payload_json=?,updated_at=?,customer_whatsapp=? WHERE id=? AND (?=1 OR rep_id=?)`,
  )
    .bind(
      d.customerId,
      d.warehouseId,
      d.invoiceDate,
      d.dueAt || null,
      d.paymentMethod,
      d.paymentTerms,
      d.notes,
      d.terms,
      d.invoiceDiscount?.type || "fixed",
      d.invoiceDiscount?.value || 0,
      JSON.stringify(d),
      now(),
      id,
      p.admin,
      p.id,
    )
    .run();
  if (!result.meta.changes) return c.json({ error: "Draft not found" }, 404);
  return c.json({ ok: true });
});
routes.delete("/invoice-drafts/:id", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const p = current(c),
    result = await c.env.DB.prepare(
      "DELETE FROM invoice_drafts WHERE id=? AND (?=1 OR rep_id=?)",
    )
      .bind(c.req.param("id"), p.admin, p.id)
      .run();
  return result.meta.changes
    ? c.json({ ok: true })
    : c.json({ error: "Draft not found" }, 404);
});

const freeIssueInput = z.object({
  customerId: z.string(),
  warehouseId: z.string(),
  issueDate: z.string().date(),
  reason: z.enum(["sample", "promotion", "trial", "replacement", "other"]),
  notes: z.string().max(1000).default(""),
  issuedBy: safe,
  receivedBy: z.string().max(180).default(""),
  items: distributionItems,
  idempotencyKey: key,
  status: z.enum(["draft", "confirmed"]).default("confirmed"),
});
routes.get("/free-issues", async (c) => {
  const denied = await guard(c, "free_issues.view");
  if (denied) return denied;
  const p = current(c),
    q = (c.req.query("q") || "").trim();
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT f.*,c.shop_name,u.name AS rep_name,COALESCE(SUM(fi.quantity),0) AS total_quantity FROM free_issues f JOIN customers c ON c.id=f.customer_id JOIN users u ON u.id=f.rep_id LEFT JOIN free_issue_items fi ON fi.free_issue_id=f.id WHERE (?=1 OR f.rep_id=?) AND (?='' OR c.shop_name LIKE '%'||?||'%' OR f.reference_number LIKE '%'||?||'%') GROUP BY f.id ORDER BY f.issue_date DESC LIMIT 300`,
      )
        .bind(p.admin, p.id, q, q, q)
        .all()
    ).results,
  );
});
routes.post("/free-issues", async (c) => {
  const denied = await guard(c, "free_issues.create");
  if (denied) return denied;
  const d = await json(c, freeIssueInput),
    db = c.env.DB,
    p = current(c),
    existing = await db
      .prepare(
        "SELECT id,reference_number FROM free_issues WHERE idempotency_key=?",
      )
      .bind(d.idempotencyKey)
      .first();
  if (existing) return c.json(existing);
  if (new Set(d.items.map((x) => x.variantId)).size !== d.items.length)
    return c.json({ error: "Duplicate variants" }, 400);
  const scope = await checkScope(c, p, d.customerId, d.warehouseId);
  if (scope) return scope;
  const rows = await variants(
    db,
    d.items.map((x) => x.variantId),
  );
  const id = uuid(),
    reference = ref("FI", id, d.issueDate),
    stamp = now(),
    statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO free_issues(id,reference_number,issue_date,customer_id,rep_id,warehouse_id,reason,notes,issued_by,received_by,status,idempotency_key,created_at,confirmed_at,cancelled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          reference,
          d.issueDate,
          d.customerId,
          p.id,
          d.warehouseId,
          d.reason,
          d.notes,
          d.issuedBy,
          d.receivedBy,
          d.status,
          d.idempotencyKey,
          stamp,
          d.status === "confirmed" ? stamp : null,
          null,
        ),
    ];
  for (const item of d.items) {
    const v = rows.get(item.variantId)!;
    statements.push(
      db
        .prepare(
          "INSERT INTO free_issue_items(id,free_issue_id,variant_id,quantity,cost_cents) VALUES(?,?,?,?,?)",
        )
        .bind(uuid(), id, item.variantId, item.quantity, v.cost_cents),
    );
    if (d.status === "confirmed") {
      statements.push(
        db
          .prepare(
            "INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .bind(
            uuid(),
            item.variantId,
            d.warehouseId,
            null,
            item.quantity,
            "free_issue",
            id,
            stamp,
          ),
      );
      statements.push(
        db
          .prepare(
            "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
          )
          .bind(item.quantity, d.warehouseId, item.variantId),
      );
    }
  }
  try {
    await db.batch(statements);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  await audit(
    db,
    p.id,
    "free_issue.created",
    id,
    JSON.stringify({ status: d.status }),
  );
  return c.json({ id, referenceNumber: reference }, 201);
});
routes.post("/free-issues/:id/confirm", async (c) => {
  const denied = await guard(c, "free_issues.create");
  if (denied) return denied;
  const db = c.env.DB,
    p = current(c),
    id = c.req.param("id"),
    issue = await db
      .prepare(
        "SELECT * FROM free_issues WHERE id=? AND status='draft' AND (?=1 OR rep_id=?)",
      )
      .bind(id, p.admin, p.id)
      .first<{ warehouse_id: string }>();
  if (!issue) return c.json({ error: "Draft free issue not found" }, 404);
  const items = (
    await db
      .prepare(
        "SELECT variant_id,quantity FROM free_issue_items WHERE free_issue_id=?",
      )
      .bind(id)
      .all<{ variant_id: string; quantity: number }>()
  ).results;
  const stamp = now();
  try {
    await db.batch([
      db
        .prepare(
          "UPDATE free_issues SET status='confirmed',confirmed_at=? WHERE id=? AND status='draft'",
        )
        .bind(stamp, id),
      ...items.flatMap((item) => [
        db
          .prepare(
            "INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .bind(
            uuid(),
            item.variant_id,
            issue.warehouse_id,
            null,
            item.quantity,
            "free_issue",
            id,
            stamp,
          ),
        db
          .prepare(
            "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
          )
          .bind(item.quantity, issue.warehouse_id, item.variant_id),
      ]),
    ]);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  await audit(db, p.id, "free_issue.confirmed", id);
  return c.json({ ok: true });
});
routes.get("/free-issues/:id", async (c) => {
  const denied = await guard(c, "free_issues.view");
  if (denied) return denied;
  const p = current(c),
    id = c.req.param("id"),
    record = await c.env.DB.prepare(
      `SELECT f.*,c.shop_name,c.address,c.phone,c.whatsapp,u.name AS rep_name,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp FROM free_issues f JOIN customers c ON c.id=f.customer_id JOIN users u ON u.id=f.rep_id CROSS JOIN business_settings b WHERE f.id=? AND (?=1 OR f.rep_id=?)`,
    )
      .bind(id, p.admin, p.id)
      .first();
  if (!record) return c.json({ error: "Not found" }, 404);
  const items = (
    await c.env.DB.prepare(
      "SELECT fi.*,p.name,v.label,v.unit FROM free_issue_items fi JOIN product_variants v ON v.id=fi.variant_id JOIN products p ON p.id=v.product_id WHERE fi.free_issue_id=?",
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ record, items });
});

const consignmentInput = z.object({
  customerId: z.string(),
  warehouseId: z.string(),
  issueDate: z.string().date(),
  expectedSettlementDate: z.string().date().nullable().optional(),
  notes: z.string().max(1000).default(""),
  issuedBy: safe,
  receivedBy: z.string().max(180).default(""),
  items: z
    .array(
      z.object({
        variantId: z.string(),
        quantity: z.number().int().positive(),
        agreedUnitPriceCents: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  idempotencyKey: key,
});
routes.get("/consignments", async (c) => {
  const denied = await guard(c, "consignments.view");
  if (denied) return denied;
  const p = current(c),
    q = (c.req.query("q") || "").trim();
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT co.*,c.shop_name,u.name AS rep_name,SUM(ci.issued_quantity) AS issued_quantity,SUM(ci.sold_quantity) AS sold_quantity,SUM(ci.returned_quantity) AS returned_quantity,SUM(ci.damaged_quantity) AS damaged_quantity,SUM(ci.issued_quantity-ci.sold_quantity-ci.returned_quantity-ci.damaged_quantity) AS remaining_quantity FROM consignments co JOIN customers c ON c.id=co.customer_id JOIN users u ON u.id=co.rep_id JOIN consignment_items ci ON ci.consignment_id=co.id WHERE (?=1 OR co.rep_id=?) AND (?='' OR c.shop_name LIKE '%'||?||'%' OR co.reference_number LIKE '%'||?||'%') GROUP BY co.id ORDER BY co.issue_date DESC LIMIT 300`,
      )
        .bind(p.admin, p.id, q, q, q)
        .all()
    ).results,
  );
});
routes.post("/consignments", async (c) => {
  const denied = await guard(c, "consignments.create");
  if (denied) return denied;
  const d = await json(c, consignmentInput),
    db = c.env.DB,
    p = current(c),
    existing = await db
      .prepare(
        "SELECT id,reference_number FROM consignments WHERE idempotency_key=?",
      )
      .bind(d.idempotencyKey)
      .first();
  if (existing) return c.json(existing);
  if (new Set(d.items.map((x) => x.variantId)).size !== d.items.length)
    return c.json({ error: "Duplicate variants" }, 400);
  const scope = await checkScope(c, p, d.customerId, d.warehouseId);
  if (scope) return scope;
  await variants(
    db,
    d.items.map((x) => x.variantId),
  );
  const id = uuid(),
    reference = ref("CON", id, d.issueDate),
    stamp = now(),
    statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO consignments(id,reference_number,issue_date,customer_id,rep_id,warehouse_id,expected_settlement_date,notes,issued_by,received_by,status,idempotency_key,created_at,cancelled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          reference,
          d.issueDate,
          d.customerId,
          p.id,
          d.warehouseId,
          d.expectedSettlementDate || null,
          d.notes,
          d.issuedBy,
          d.receivedBy,
          "open",
          d.idempotencyKey,
          stamp,
          null,
        ),
    ];
  for (const item of d.items) {
    statements.push(
      db
        .prepare(
          "INSERT INTO consignment_items(id,consignment_id,variant_id,issued_quantity,sold_quantity,returned_quantity,damaged_quantity,agreed_unit_price_cents) VALUES(?,?,?,?,0,0,0,?)",
        )
        .bind(
          uuid(),
          id,
          item.variantId,
          item.quantity,
          item.agreedUnitPriceCents,
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          item.variantId,
          d.warehouseId,
          null,
          item.quantity,
          "consignment_issue",
          id,
          stamp,
        ),
    );
    statements.push(
      db
        .prepare(
          "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
        )
        .bind(item.quantity, d.warehouseId, item.variantId),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  await audit(db, p.id, "consignment.created", id);
  return c.json({ id, referenceNumber: reference }, 201);
});
routes.get("/consignments/:id", async (c) => {
  const denied = await guard(c, "consignments.view");
  if (denied) return denied;
  const p = current(c),
    id = c.req.param("id"),
    record = await c.env.DB.prepare(
      `SELECT co.*,c.shop_name,c.address,c.phone,c.whatsapp,u.name AS rep_name,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp FROM consignments co JOIN customers c ON c.id=co.customer_id JOIN users u ON u.id=co.rep_id CROSS JOIN business_settings b WHERE co.id=? AND (?=1 OR co.rep_id=?)`,
    )
      .bind(id, p.admin, p.id)
      .first();
  if (!record) return c.json({ error: "Not found" }, 404);
  const [items, settlements, returns] = await Promise.all([
    c.env.DB.prepare(
      "SELECT ci.*,p.name,v.label,v.unit,(ci.issued_quantity-ci.sold_quantity-ci.returned_quantity-ci.damaged_quantity) AS remaining_quantity FROM consignment_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE ci.consignment_id=?",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT s.id,s.settlement_date,s.invoice_id,i.number AS invoice_number,i.total_cents FROM consignment_settlements s JOIN invoices i ON i.id=s.invoice_id WHERE s.consignment_id=? ORDER BY s.created_at DESC",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT id,return_date,condition,reason,received_by FROM consignment_returns WHERE consignment_id=? ORDER BY created_at DESC",
    )
      .bind(id)
      .all(),
  ]);
  return c.json({
    record,
    items: items.results,
    settlements: settlements.results,
    returns: returns.results,
  });
});

routes.get("/consignment-settlements/:id", async (c) => {
  const denied = await guard(c, "consignments.view");
  if (denied) return denied;
  const p = current(c),
    id = c.req.param("id"),
    record = await c.env.DB.prepare(
      `SELECT s.*,co.reference_number,c.shop_name,c.address,c.phone,c.whatsapp,u.name AS rep_name,i.number AS invoice_number,i.total_cents,i.paid_cents,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp FROM consignment_settlements s JOIN consignments co ON co.id=s.consignment_id JOIN customers c ON c.id=co.customer_id JOIN users u ON u.id=co.rep_id JOIN invoices i ON i.id=s.invoice_id CROSS JOIN business_settings b WHERE s.id=? AND (?=1 OR co.rep_id=?)`,
    )
      .bind(id, p.admin, p.id)
      .first();
  if (!record) return c.json({ error: "Not found" }, 404);
  const items = (
    await c.env.DB.prepare(
      "SELECT si.*,p.name,v.label FROM consignment_settlement_items si JOIN consignment_items ci ON ci.id=si.consignment_item_id JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE si.settlement_id=?",
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ record, items });
});

routes.get("/consignment-returns/:id", async (c) => {
  const denied = await guard(c, "consignments.view");
  if (denied) return denied;
  const p = current(c),
    id = c.req.param("id"),
    record = await c.env.DB.prepare(
      `SELECT r.*,co.reference_number,c.shop_name,c.address,c.phone,c.whatsapp,u.name AS rep_name,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp FROM consignment_returns r JOIN consignments co ON co.id=r.consignment_id JOIN customers c ON c.id=co.customer_id JOIN users u ON u.id=co.rep_id CROSS JOIN business_settings b WHERE r.id=? AND (?=1 OR co.rep_id=?)`,
    )
      .bind(id, p.admin, p.id)
      .first();
  if (!record) return c.json({ error: "Not found" }, 404);
  const items = (
    await c.env.DB.prepare(
      "SELECT ri.*,p.name,v.label FROM consignment_return_items ri JOIN consignment_items ci ON ci.id=ri.consignment_item_id JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE ri.return_id=?",
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ record, items });
});

routes.post("/consignments/:id/settlements", async (c) => {
  const denied = await guard(c, "consignments.settle");
  if (denied) return denied;
  const p = current(c),
    db = c.env.DB,
    id = c.req.param("id"),
    d = await json(
      c,
      z.object({
        settlementDate: z.string().date(),
        items: z
          .array(
            z.object({
              consignmentItemId: z.string(),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
        invoiceDiscount: discount.optional(),
        amountPaidCents: z.number().int().nonnegative().default(0),
        paymentMethod: z
          .enum(["cash", "bank", "credit", "other"])
          .default("credit"),
        paymentTerms: z.string().max(500).default(""),
        dueAt: z.string().date().nullable().optional(),
        notes: z.string().max(1000).default(""),
        terms: z.string().max(1500).default(""),
        idempotencyKey: key,
      }),
    );
  const existing = await db
    .prepare(
      "SELECT invoice_id FROM consignment_settlements WHERE idempotency_key=?",
    )
    .bind(d.idempotencyKey)
    .first();
  if (existing) return c.json(existing);
  const consignment = await db
    .prepare(
      "SELECT * FROM consignments WHERE id=? AND status IN('open','partially_settled') AND (?=1 OR rep_id=?)",
    )
    .bind(id, p.admin, p.id)
    .first<{ customer_id: string; warehouse_id: string }>();
  if (!consignment) return c.json({ error: "Open consignment not found" }, 404);
  const source = [] as Array<{
    row: {
      id: string;
      variant_id: string;
      agreed_unit_price_cents: number;
      remaining_quantity: number;
    };
    quantity: number;
  }>;
  for (const item of d.items) {
    const row = await db
      .prepare(
        "SELECT id,variant_id,agreed_unit_price_cents,issued_quantity-sold_quantity-returned_quantity-damaged_quantity AS remaining_quantity FROM consignment_items WHERE id=? AND consignment_id=?",
      )
      .bind(item.consignmentItemId, id)
      .first<{
        id: string;
        variant_id: string;
        agreed_unit_price_cents: number;
        remaining_quantity: number;
      }>();
    if (!row || item.quantity > row.remaining_quantity)
      return c.json(
        { error: "Settlement exceeds remaining consignment quantity" },
        409,
      );
    source.push({ row, quantity: item.quantity });
  }
  const billing = {
    customerId: consignment.customer_id,
    warehouseId: consignment.warehouse_id,
    idempotencyKey: `${d.idempotencyKey}:invoice`,
    invoiceDate: d.settlementDate,
    items: source.map((x) => ({
      variantId: x.row.variant_id,
      quantity: x.quantity,
      priceType: "shop" as const,
    })),
    invoiceDiscount: d.invoiceDiscount,
    amountPaidCents: d.amountPaidCents,
    paymentMethod: d.paymentMethod,
    paymentTerms: d.paymentTerms,
    dueAt: d.dueAt,
    notes: d.notes,
    terms: d.terms,
  };
  const variantRows = await variants(
    db,
    source.map((x) => x.row.variant_id),
  );
  for (const x of source)
    variantRows.get(x.row.variant_id)!.shop_price_cents =
      x.row.agreed_unit_price_cents;
  const originalVariants = variants;
  void originalVariants;
  try {
    const customer = await db
      .prepare("SELECT credit_days FROM customers WHERE id=?")
      .bind(consignment.customer_id)
      .first<{ credit_days: number }>();
    const subtotal = source.reduce(
        (sum, x) => sum + lineTotal(x.row.agreed_unit_price_cents, x.quantity),
        0,
      ),
      invoiceDiscount = invoiceTotals(
        [{ unitPriceCents: subtotal, quantity: 1 }],
        d.invoiceDiscount as Discount | undefined,
      ).invoiceDiscountCents,
      total = subtotal - invoiceDiscount;
    if (d.amountPaidCents > total)
      return c.json({ error: "Amount paid exceeds total" }, 400);
    const outstanding = total - d.amountPaidCents;
    let due: string | null = null;
    if (outstanding) {
      if (!customer?.credit_days)
        return c.json({ error: "Customer has no credit terms" }, 400);
      const maximum = dueDate(d.settlementDate, customer.credit_days);
      due = d.dueAt || maximum;
      if (due < d.settlementDate || due > maximum)
        return c.json({ error: `Due date must not exceed ${maximum}` }, 400);
    }
    const invoiceId = uuid(),
      invoiceNumber = ref("INV", invoiceId, d.settlementDate),
      settlementId = uuid(),
      stamp = now(),
      statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            invoiceId,
            invoiceNumber,
            consignment.customer_id,
            p.id,
            consignment.warehouse_id,
            total,
            d.amountPaidCents,
            "posted",
            due,
            `${d.idempotencyKey}:invoice`,
            stamp,
            null,
            subtotal,
            0,
            invoiceDiscount,
            d.paymentMethod,
            d.paymentTerms,
            d.notes,
            d.terms,
            "consignment",
            id,
          ),
        db
          .prepare(
            "INSERT INTO consignment_settlements(id,consignment_id,invoice_id,settlement_date,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            settlementId,
            id,
            invoiceId,
            d.settlementDate,
            d.idempotencyKey,
            p.id,
            stamp,
          ),
      ];
    for (const x of source) {
      const v = variantRows.get(x.row.variant_id)!;
      const line = lineTotal(x.row.agreed_unit_price_cents, x.quantity);
      statements.push(
        db
          .prepare(
            "INSERT INTO invoice_items(id,invoice_id,variant_id,quantity,unit_price_cents,cost_cents,line_cents,price_type,item_discount_cents,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            uuid(),
            invoiceId,
            x.row.variant_id,
            x.quantity,
            x.row.agreed_unit_price_cents,
            v.cost_cents,
            line,
            "shop",
            0,
            x.row.agreed_unit_price_cents,
          ),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO consignment_settlement_items(id,settlement_id,consignment_item_id,sold_quantity,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            uuid(),
            settlementId,
            x.row.id,
            x.quantity,
            x.row.agreed_unit_price_cents,
            line,
          ),
      );
      statements.push(
        db
          .prepare(
            "UPDATE consignment_items SET sold_quantity=sold_quantity+? WHERE id=?",
          )
          .bind(x.quantity, x.row.id),
      );
    }
    if (d.amountPaidCents)
      statements.push(
        db
          .prepare(
            "INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            uuid(),
            invoiceId,
            d.amountPaidCents,
            d.paymentMethod === "credit" ? "other" : d.paymentMethod,
            `${d.idempotencyKey}:payment`,
            p.id,
            stamp,
          ),
      );
    statements.push(
      db
        .prepare(
          "UPDATE consignments SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM consignment_items WHERE consignment_id=? AND sold_quantity+returned_quantity+damaged_quantity<issued_quantity) THEN 'settled' ELSE 'partially_settled' END WHERE id=?",
        )
        .bind(id, id),
    );
    await db.batch(statements);
    await audit(
      db,
      p.id,
      "consignment.settled",
      id,
      JSON.stringify({ invoiceId, settlementId }),
    );
    return c.json({ settlementId, invoiceId, invoiceNumber }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});

routes.post("/consignments/:id/returns", async (c) => {
  const denied = await guard(c, "consignments.return");
  if (denied) return denied;
  const p = current(c),
    db = c.env.DB,
    id = c.req.param("id"),
    d = await json(
      c,
      z.object({
        returnDate: z.string().date(),
        condition: z.enum(["saleable", "damaged", "expired"]),
        reason: z.string().max(500).default(""),
        receivedBy: safe,
        items: z
          .array(
            z.object({
              consignmentItemId: z.string(),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
        idempotencyKey: key,
      }),
    ),
    existing = await db
      .prepare("SELECT id FROM consignment_returns WHERE idempotency_key=?")
      .bind(d.idempotencyKey)
      .first();
  if (existing) return c.json(existing);
  const consignment = await db
    .prepare(
      "SELECT * FROM consignments WHERE id=? AND status IN('open','partially_settled') AND (?=1 OR rep_id=?)",
    )
    .bind(id, p.admin, p.id)
    .first<{ warehouse_id: string }>();
  if (!consignment) return c.json({ error: "Open consignment not found" }, 404);
  const source = [] as Array<{
    id: string;
    variant_id: string;
    remaining_quantity: number;
    quantity: number;
  }>;
  for (const item of d.items) {
    const row = await db
      .prepare(
        "SELECT id,variant_id,issued_quantity-sold_quantity-returned_quantity-damaged_quantity AS remaining_quantity FROM consignment_items WHERE id=? AND consignment_id=?",
      )
      .bind(item.consignmentItemId, id)
      .first<{ id: string; variant_id: string; remaining_quantity: number }>();
    if (!row || item.quantity > row.remaining_quantity)
      return c.json({ error: "Return exceeds remaining quantity" }, 409);
    source.push({ ...row, quantity: item.quantity });
  }
  const returnId = uuid(),
    stamp = now(),
    saleable = d.condition === "saleable",
    statements: D1PreparedStatement[] = [
      db
        .prepare(
          "INSERT INTO consignment_returns(id,consignment_id,return_date,condition,reason,received_by,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          returnId,
          id,
          d.returnDate,
          d.condition,
          d.reason,
          d.receivedBy,
          d.idempotencyKey,
          p.id,
          stamp,
        ),
    ];
  for (const item of source) {
    statements.push(
      db
        .prepare(
          "INSERT INTO consignment_return_items(id,return_id,consignment_item_id,quantity) VALUES(?,?,?,?)",
        )
        .bind(uuid(), returnId, item.id, item.quantity),
    );
    statements.push(
      db
        .prepare(
          `UPDATE consignment_items SET ${saleable ? "returned_quantity" : "damaged_quantity"}=${saleable ? "returned_quantity" : "damaged_quantity"}+? WHERE id=?`,
        )
        .bind(item.quantity, item.id),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          item.variant_id,
          null,
          saleable ? consignment.warehouse_id : null,
          item.quantity,
          saleable ? "consignment_return" : "consignment_damaged",
          returnId,
          stamp,
        ),
    );
    if (saleable)
      statements.push(
        db
          .prepare(
            "INSERT INTO stock_balances(warehouse_id,variant_id,quantity) VALUES(?,?,?) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET quantity=quantity+excluded.quantity",
          )
          .bind(consignment.warehouse_id, item.variant_id, item.quantity),
      );
  }
  statements.push(
    db
      .prepare(
        "UPDATE consignments SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM consignment_items WHERE consignment_id=? AND sold_quantity+returned_quantity+damaged_quantity<issued_quantity) THEN 'settled' ELSE 'partially_settled' END WHERE id=?",
      )
      .bind(id, id),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  await audit(
    db,
    p.id,
    "consignment.returned",
    id,
    JSON.stringify({ returnId, condition: d.condition }),
  );
  return c.json({ id: returnId }, 201);
});

export default routes;
