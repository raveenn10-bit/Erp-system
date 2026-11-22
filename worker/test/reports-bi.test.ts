import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

function setupTestDb() {
  const root = path.resolve(__dirname, "..");
  const migrationsDir = path.join(root, "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
  }

  const now = "2026-11-20T08:00:00Z";
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
    "admin",
    "Admin User",
    "admin@example.lk",
    "hash",
    "admin",
    1,
    now
  );
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
    "rep-1",
    "Kasun Rep",
    "kasun@example.lk",
    "hash",
    "sales_rep",
    1,
    now
  );
  db.prepare("INSERT INTO categories VALUES(?,?)").run("tea", "Ceylon Tea");
  db.prepare("INSERT INTO products VALUES(?,?,?,?,?,?,?)").run(
    "p1",
    "tea",
    "Nugathalawa BOPF",
    "TEA-BOPF-200",
    null,
    1,
    now
  );
  db.prepare(
    "INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)"
  ).run("v1", "p1", "200g pack", "pack", 200, 45000, 35500, 25000, 10, 40000);
  db.prepare("INSERT INTO stock_balances VALUES(?,?,?)").run("main", "v1", 200);
  db.prepare("INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "cust-1",
    "Perera Stores",
    "Sunil Perera",
    "0771234567",
    "0771234567",
    "Colombo Rd",
    "Colombo",
    "wholesale",
    1000000,
    30,
    1,
    now
  );

  return { db };
}

describe("Advanced Business Intelligence & Accounting Reconciliation", () => {
  it("reconciles sales revenue, separate collections, customer ledger, and credit aging", () => {
    const { db } = setupTestDb();

    // 1. Create a credit invoice for LKR 3,550 on 2026-11-20
    const invDate1 = "2026-11-20";
    const invSql = `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    db.prepare(invSql).run(
      "inv-001",
      "INV-001",
      "cust-1",
      "rep-1",
      "main",
      355000, // LKR 3,550
      0,
      "posted",
      "2026-12-20",
      "key-inv-001",
      `${invDate1}T09:30:00Z`,
      null,
      355000,
      0,
      0,
      "credit",
      "30 days",
      "",
      "",
      "sale",
      null,
      "0771234567",
      "token-001"
    );

    db.prepare(`
      INSERT INTO invoice_items(id,invoice_id,variant_id,quantity,unit_price_cents,cost_cents,line_cents,price_type,item_discount_cents)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run("ii-1", "inv-001", "v1", 10, 35500, 25000, 355000, "wholesale", 0);

    // Initial check: Net revenue = LKR 3,550, Collections = 0, Balance = LKR 3,550
    let invRow = db
      .prepare("SELECT total_cents, paid_cents FROM invoices WHERE id='inv-001'")
      .get() as any;
    expect(invRow.total_cents).toBe(355000);
    expect(invRow.paid_cents).toBe(0);

    // 2. Record initial payment of LKR 1,000 on 2026-11-20
    db.prepare("UPDATE invoices SET paid_cents = 100000 WHERE id='inv-001'").run();
    db.prepare(`
      INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes)
      VALUES(?,?,?,?,?,?,?,?)
    `).run("pay-1", "inv-001", 100000, "cash", "key-pay-1", "rep-1", `${invDate1}T10:00:00Z`, "Initial deposit");

    // Outstanding must be LKR 2,550
    invRow = db
      .prepare("SELECT total_cents, paid_cents, total_cents - paid_cents AS balance FROM invoices WHERE id='inv-001'")
      .get() as any;
    expect(invRow.balance).toBe(255000);
    expect(invRow.paid_cents).toBe(100000);

    // Check Day 1 Daily Sales:
    // Net sales revenue = 355000, Total collections = 100000, Same day collections = 100000, Previous credit collections = 0
    const day1Sales = db.prepare(`
      SELECT COALESCE(SUM(total_cents), 0) AS sales_cents
      FROM invoices WHERE status='posted' AND substr(created_at,1,10)=?
    `).get(invDate1) as any;
    expect(day1Sales.sales_cents).toBe(355000);

    const day1Payments = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_collected
      FROM payments WHERE substr(created_at,1,10)=?
    `).get(invDate1) as any;
    expect(day1Payments.total_collected).toBe(100000);

    // 3. Record subsequent payment of LKR 500 on 2026-11-22 (2 days later)
    const payDate2 = "2026-11-22";
    db.prepare("UPDATE invoices SET paid_cents = 150000 WHERE id='inv-001'").run();
    db.prepare(`
      INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes)
      VALUES(?,?,?,?,?,?,?,?)
    `).run("pay-2", "inv-001", 50000, "bank", "key-pay-2", "admin", `${payDate2}T14:00:00Z`, "Part settlement");

    // Outstanding balance must now be LKR 2,050
    invRow = db
      .prepare("SELECT total_cents, paid_cents, total_cents - paid_cents AS balance FROM invoices WHERE id='inv-001'")
      .get() as any;
    expect(invRow.balance).toBe(205000);
    expect(invRow.paid_cents).toBe(150000);

    // Check Day 2 Daily Sales:
    // On Day 2, there was NO new invoice, so sales revenue = 0!
    const day2Sales = db.prepare(`
      SELECT COALESCE(SUM(total_cents), 0) AS sales_cents
      FROM invoices WHERE status='posted' AND substr(created_at,1,10)=?
    `).get(payDate2) as any;
    expect(day2Sales.sales_cents).toBe(0);

    // But Day 2 collections must show LKR 500
    const day2Payments = db.prepare(`
      SELECT
        COALESCE(SUM(p.amount_cents), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN substr(i.created_at,1,10)=? THEN p.amount_cents ELSE 0 END), 0) AS same_day_collected,
        COALESCE(SUM(CASE WHEN substr(i.created_at,1,10)<? THEN p.amount_cents ELSE 0 END), 0) AS prior_credit_collected
      FROM payments p
      JOIN invoices i ON i.id=p.invoice_id
      WHERE substr(p.created_at,1,10)=?
    `).get(payDate2, payDate2, payDate2) as any;

    expect(day2Payments.total_collected).toBe(50000);
    expect(day2Payments.same_day_collected).toBe(0);
    expect(day2Payments.prior_credit_collected).toBe(50000); // Correctly classified as prior credit collection!

    // 4. Verify P&L calculations
    // Gross Revenue = 355,000, COGS = 10 * 25,000 = 250,000
    // Gross profit = 105,000
    const pnl = db.prepare(`
      SELECT
        COALESCE(SUM(ii.line_cents), 0) AS net_sales,
        COALESCE(SUM(ii.cost_cents * ii.quantity), 0) AS cogs,
        COALESCE(SUM((ii.unit_price_cents - ii.cost_cents) * ii.quantity), 0) AS gross_profit
      FROM invoice_items ii
      JOIN invoices i ON i.id=ii.invoice_id
      WHERE i.status='posted'
    `).get() as any;

    expect(pnl.net_sales).toBe(355000);
    expect(pnl.cogs).toBe(250000);
    expect(pnl.gross_profit).toBe(105000);
  });
});
