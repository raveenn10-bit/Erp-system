import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

describe('SQLite constraint and migration integrity', () => {
  it('applies all migrations and enforces ERP constraints', () => {
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

    const now = '2026-11-22T00:00:00Z';
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('admin', 'Admin', 'admin@example.lk', 'hash', 'admin', 1, now);
    db.prepare('INSERT INTO categories VALUES(?,?)').run('tea', 'Tea');
    db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?)').run('p', 'tea', 'Tea', 'T50', null, 1, now);
    db.prepare('INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('v', 'p', '50g', 'pack', 50, 15000, 10000, 7000, 10, 12000);
    db.prepare('INSERT INTO stock_balances VALUES(?,?,?)').run('main', 'v', 5);
    db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('c', 'Shop', 'Owner', '', '', '', '', 'wholesale', 100000, 30, 1, now);

    function rejects(fn: () => void) {
      expect(fn).toThrow();
    }

    // Negative stock rejected
    rejects(() => db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('m', 'v', 'main', null, 6, 'sale', 'invoice', now));
    rejects(() => db.prepare('UPDATE stock_balances SET quantity=-1').run());

    const invoiceSql = 'INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

    // Credit limit exceeded rejected
    rejects(() => db.prepare(invoiceSql).run('bad', 'SD-1', 'c', 'admin', 'main', 100001, 0, 'posted', '2026-12-22', 'k1', now, null, 100001, 0, 0, 'credit', '', '', '', 'sale', null));

    // Valid invoice
    db.prepare(invoiceSql).run('inv', 'SD-2', 'c', 'admin', 'main', 10000, 4000, 'posted', '2026-12-22', 'k2', now, null, 10000, 0, 0, 'cash', '', '', '', 'sale', null);
    db.prepare('INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run('pay', 'inv', 4000, 'cash', 'pay-key', 'admin', now);

    // Overpayment rejected
    rejects(() => db.prepare('INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run('pay2', 'inv', 1, 'cash', 'pay-key-2', 'admin', now));

    // Invoice immutability trigger
    rejects(() => db.prepare('UPDATE invoices SET total_cents=1 WHERE id=?').run('inv'));

    // Duplicate idempotency key rejected
    rejects(() => db.prepare(invoiceSql).run('dup', 'SD-3', 'c', 'admin', 'main', 10000, 0, 'posted', null, 'k2', now, null, 10000, 0, 0, 'credit', '', '', '', 'sale', null));

    // Free issue: stock movement separate from revenue/debt, idempotent per variant
    db.prepare('INSERT INTO free_issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('fi', 'FI-1', '2026-11-22', 'c', 'admin', 'main', 'sample', '', 'Admin', 'Owner', 'confirmed', 'fi-key', now, now, null);
    db.prepare('INSERT INTO free_issue_items VALUES(?,?,?,?,?)').run('fii', 'fi', 'v', 2, 7000);
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('fm', 'v', 'main', null, 2, 'free_issue', 'fi', now);
    db.prepare("UPDATE stock_balances SET quantity=quantity-2 WHERE warehouse_id='main' AND variant_id='v'").run();

    const stockRow = db.prepare("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v'").get() as { quantity: number };
    expect(stockRow.quantity).toBe(3);

    const invoiceCount = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE source_id='fi'").get() as { count: number };
    expect(invoiceCount.count).toBe(0);

    rejects(() => db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('fm2', 'v', 'main', null, 1, 'free_issue', 'fi', now));

    // Consignment issue is not a sale; settlement cannot exceed issued stock
    db.prepare('INSERT INTO consignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('co', 'CON-1', '2026-11-22', 'c', 'admin', 'main', '2026-12-22', '', 'Admin', 'Owner', 'open', 'co-key', now, null);
    db.prepare('INSERT INTO consignment_items VALUES(?,?,?,?,?,?,?,?)').run('ci', 'co', 'v', 2, 0, 0, 0, 10000);
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('cm', 'v', 'main', null, 2, 'consignment_issue', 'co', now);
    db.prepare("UPDATE stock_balances SET quantity=quantity-2 WHERE warehouse_id='main' AND variant_id='v'").run();

    const conInvoiceCount = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE source_id='co'").get() as { count: number };
    expect(conInvoiceCount.count).toBe(0);

    rejects(() => db.prepare("UPDATE consignment_items SET sold_quantity=3 WHERE id='ci'").run());
    db.prepare("UPDATE consignment_items SET sold_quantity=1 WHERE id='ci'").run();
    db.prepare("UPDATE consignment_items SET returned_quantity=1 WHERE id='ci'").run();
    rejects(() => db.prepare("UPDATE consignment_items SET damaged_quantity=1 WHERE id='ci'").run());
  });
});
