import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

function setupTestDb() {
  const root = path.resolve(__dirname, '..');
  const migrationsDir = path.join(root, 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
  }

  const now = '2026-11-22T10:00:00Z';
  db.prepare('INSERT INTO users(id, name, email, password_hash, role_id, active, created_at) VALUES(?,?,?,?,?,?,?)').run('admin', 'Admin User', 'admin@example.lk', 'hash', 'admin', 1, now);
  db.prepare('INSERT INTO categories VALUES(?,?)').run('tea', 'Ceylon Tea');
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?)').run('p1', 'tea', 'Nugathalawa BOPF', 'TEA-BOPF', null, 1, now);
  db.prepare('INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('v1', 'p1', '200g pack', 'pack', 200, 45000, 35500, 25000, 10, 40000);
  db.prepare('INSERT INTO stock_balances VALUES(?,?,?)').run('main', 'v1', 100);
  db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('cust-1', 'Perera Stores', 'Sunil Perera', '0771234567', '0771234567', 'Main St, Colombo', 'Colombo', 'wholesale', 1000000, 45, 1, now);

  return { db, now };
}

describe('Customer Management & Credit Ledger', () => {
  it('correctly tracks credit invoice, payments, and outstanding balances chronologically', () => {
    const { db, now } = setupTestDb();

    // 1. Create a credit invoice for LKR 3,550 (355000 cents)
    const invSql = `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    db.prepare(invSql).run(
      'inv-1', 'INV-001', 'cust-1', 'admin', 'main',
      355000, 0, 'posted', '2026-12-30', 'key-inv-1',
      '2026-11-22T10:00:00Z', null, 355000, 0, 0, 'credit', '38 days', '', '', 'sale', null, '0771234567', 'tok-1'
    );

    // Initial check: outstanding = 355000, paid = 0
    let totals = db.prepare(`
      SELECT
        COALESCE(SUM(total_cents), 0) AS total_invoiced,
        COALESCE(SUM(paid_cents), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN status='posted' THEN total_cents - paid_cents ELSE 0 END), 0) AS outstanding
      FROM invoices WHERE customer_id='cust-1'
    `).get() as any;

    expect(totals.total_invoiced).toBe(355000);
    expect(totals.total_paid).toBe(0);
    expect(totals.outstanding).toBe(355000);

    // 2. Receive payment of LKR 1,000 (100000 cents)
    db.prepare(`UPDATE invoices SET paid_cents = paid_cents + 100000 WHERE id = 'inv-1'`).run();
    db.prepare(`
      INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes)
      VALUES(?,?,?,?,?,?,?,?)
    `).run('pay-1', 'inv-1', 100000, 'cash', 'key-pay-1', 'admin', '2026-11-22T11:00:00Z', 'First partial payment');

    totals = db.prepare(`
      SELECT
        COALESCE(SUM(total_cents), 0) AS total_invoiced,
        COALESCE(SUM(paid_cents), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN status='posted' THEN total_cents - paid_cents ELSE 0 END), 0) AS outstanding
      FROM invoices WHERE customer_id='cust-1'
    `).get() as any;

    expect(totals.outstanding).toBe(255000); // LKR 2,550
    expect(totals.total_paid).toBe(100000);

    // 3. Receive another payment of LKR 500 (50000 cents)
    db.prepare(`UPDATE invoices SET paid_cents = paid_cents + 50000 WHERE id = 'inv-1'`).run();
    db.prepare(`
      INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes)
      VALUES(?,?,?,?,?,?,?,?)
    `).run('pay-2', 'inv-1', 50000, 'bank', 'key-pay-2', 'admin', '2026-11-22T12:00:00Z', 'Second partial payment');

    totals = db.prepare(`
      SELECT
        COALESCE(SUM(total_cents), 0) AS total_invoiced,
        COALESCE(SUM(paid_cents), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN status='posted' THEN total_cents - paid_cents ELSE 0 END), 0) AS outstanding
      FROM invoices WHERE customer_id='cust-1'
    `).get() as any;

    expect(totals.outstanding).toBe(205000); // LKR 2,050
    expect(totals.total_paid).toBe(150000);

    // Verify chronological ledger reconstruction
    const invoices = db.prepare(`SELECT number, total_cents, created_at FROM invoices WHERE customer_id='cust-1'`).all() as any[];
    const payments = db.prepare(`SELECT p.amount_cents, p.created_at, p.method, i.number FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.customer_id='cust-1'`).all() as any[];

    const ledger: Array<{ date: string; debit: number; credit: number }> = [];
    for (const inv of invoices) {
      ledger.push({ date: inv.created_at, debit: inv.total_cents, credit: 0 });
    }
    for (const pay of payments) {
      ledger.push({ date: pay.created_at, debit: 0, credit: pay.amount_cents });
    }
    ledger.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0;
    const ledgerWithBalance = ledger.map(e => {
      runningBalance += e.debit - e.credit;
      return { ...e, balance: runningBalance };
    });

    expect(ledgerWithBalance[0].balance).toBe(355000); // after invoice
    expect(ledgerWithBalance[1].balance).toBe(255000); // after payment 1
    expect(ledgerWithBalance[2].balance).toBe(205000); // after payment 2
  });
});

describe('Expenses & Cashbook Module', () => {
  it('correctly records expenses and calculates net cashbook balance', () => {
    const { db, now } = setupTestDb();

    // Record an expense
    db.prepare(`
      INSERT INTO expenses(id,date,category,description,amount_cents,method,reference,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run('exp-1', '2026-11-22', 'fuel', 'Delivery van fuel', 150000, 'cash', 'REC-001', 'admin', now);

    const expense = db.prepare(`SELECT * FROM expenses WHERE id='exp-1'`).get() as any;
    expect(expense.category).toBe('fuel');
    expect(expense.amount_cents).toBe(150000);

    // Simulate payment collection of LKR 5,000 (500000 cents)
    const invSql = `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    db.prepare(invSql).run(
      'inv-2', 'INV-002', 'cust-1', 'admin', 'main',
      500000, 500000, 'posted', null, 'key-inv-2',
      '2026-11-22T10:00:00Z', null, 500000, 0, 0, 'cash', 'immediate', '', '', 'sale', null, '', 'tok-2'
    );
    db.prepare(`
      INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes)
      VALUES(?,?,?,?,?,?,?,?)
    `).run('pay-3', 'inv-2', 500000, 'cash', 'key-pay-3', 'admin', '2026-11-22T10:05:00Z', 'Full cash collection');

    // Calculate cashbook
    const collections = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments`).get() as any).total;
    const totalExpenses = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM expenses`).get() as any).total;
    const netCashflow = collections - totalExpenses;

    expect(collections).toBe(500000);
    expect(totalExpenses).toBe(150000);
    expect(netCashflow).toBe(350000); // LKR 3,500 surplus
  });
});

describe('Sales Returns & Credit Notes Module', () => {
  it('creates credit note, restocks inventory, and adjusts invoice paid amount', () => {
    const { db, now } = setupTestDb();

    // Initial stock of v1 is 100
    const initialStock = (db.prepare(`SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'`).get() as any).quantity;
    expect(initialStock).toBe(100);

    // Create posted invoice for 10 units of v1 (unit price 35500 => 355000 cents)
    const invSql = `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    db.prepare(invSql).run(
      'inv-ret', 'INV-RET-1', 'cust-1', 'admin', 'main',
      355000, 0, 'posted', '2026-12-30', 'key-inv-ret',
      now, null, 355000, 0, 0, 'credit', '', '', '', 'sale', null, '', 'tok-ret'
    );
    // Deduct stock for 10 units
    db.prepare(`UPDATE stock_balances SET quantity = quantity - 10 WHERE warehouse_id='main' AND variant_id='v1'`).run();

    expect((db.prepare(`SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'`).get() as any).quantity).toBe(90);

    // Customer returns 2 units (unit price 35500 => total 71000 cents credit)
    const creditNoteTotal = 2 * 35500;
    db.prepare(`
      INSERT INTO credit_notes(id,number,invoice_id,customer_id,reason,total_cents,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run('cn-1', 'CN-001', 'inv-ret', 'cust-1', 'Overordered, sealed undamaged', creditNoteTotal, 'posted', 'admin', now);

    db.prepare(`
      INSERT INTO credit_note_items(id,credit_note_id,variant_id,quantity,unit_price_cents,line_cents,restock)
      VALUES(?,?,?,?,?,?,?)
    `).run('cni-1', 'cn-1', 'v1', 2, 35500, creditNoteTotal, 1);

    // Restock the 2 units
    db.prepare(`
      INSERT INTO stock_balances VALUES('main', 'v1', 2)
      ON CONFLICT(warehouse_id, variant_id) DO UPDATE SET quantity = quantity + 2
    `).run();

    // Adjust invoice paid_cents to credit the invoice
    db.prepare(`UPDATE invoices SET paid_cents = MIN(total_cents, paid_cents + ?) WHERE id = 'inv-ret'`).run(creditNoteTotal);

    // Verify stock returned to 92
    const finalStock = (db.prepare(`SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'`).get() as any).quantity;
    expect(finalStock).toBe(92);

    // Verify invoice outstanding reduced by credit note amount
    const invoice = db.prepare(`SELECT total_cents, paid_cents FROM invoices WHERE id = 'inv-ret'`).get() as any;
    expect(invoice.total_cents - invoice.paid_cents).toBe(355000 - 71000); // 284000 cents
  });
});

describe('Stock Transfers Between Warehouses', () => {
  it('transfers stock from main warehouse to rep van warehouse', () => {
    const { db, now } = setupTestDb();

    // Create a secondary warehouse (sales rep van)
    db.prepare(`INSERT INTO warehouses VALUES(?,?,?)`).run('van-1', 'Van Colombo South', 'admin');

    // Initial state: main has 100 of v1, van-1 has 0
    expect((db.prepare(`SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'`).get() as any).quantity).toBe(100);

    // Transfer 25 packs from main to van-1
    const qty = 25;
    db.prepare(`
      INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)
    `).run('mov-1', 'v1', 'main', 'van-1', qty, 'transfer', null, now);

    db.prepare(`UPDATE stock_balances SET quantity = quantity - ? WHERE warehouse_id = 'main' AND variant_id = 'v1'`).run(qty);
    db.prepare(`
      INSERT INTO stock_balances VALUES('van-1', 'v1', ?)
      ON CONFLICT(warehouse_id, variant_id) DO UPDATE SET quantity = quantity + excluded.quantity
    `).run(qty);

    const mainQty = (db.prepare(`SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'`).get() as any).quantity;
    const vanQty = (db.prepare(`SELECT quantity FROM stock_balances WHERE warehouse_id='van-1' AND variant_id='v1'`).get() as any).quantity;

    expect(mainQty).toBe(75);
    expect(vanQty).toBe(25);
  });
});
