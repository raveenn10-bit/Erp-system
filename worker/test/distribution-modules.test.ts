import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { dueDate, reminderDate, invoiceTotals, lineTotal, normalizeWhatsApp, formatWhatsApp } from '../src/finance';
import { renderPublicInvoiceHtml } from '../src/public-invoice';

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

  const now = '2026-11-22T00:00:00Z';
  db.prepare('INSERT INTO users(id, name, email, password_hash, role_id, active, created_at) VALUES(?,?,?,?,?,?,?)').run('admin', 'Admin', 'admin@example.lk', 'hash', 'admin', 1, now);
  db.prepare('INSERT INTO categories VALUES(?,?)').run('tea', 'Tea');
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?)').run('p1', 'tea', 'BOPF Tea', 'TEA-01', null, 1, now);
  db.prepare('INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('v1', 'p1', '100g', 'pack', 100, 20000, 16000, 12000, 10, 18000);
  db.prepare('INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('v2', 'p1', '250g', 'pack', 250, 45000, 38000, 30000, 10, 42000);
  db.prepare('INSERT INTO stock_balances VALUES(?,?,?)').run('main', 'v1', 100);
  db.prepare('INSERT INTO stock_balances VALUES(?,?,?)').run('main', 'v2', 50);
  db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('c1', 'City Grocery', 'Nimal', '0771234567', '0771234567', 'Kandy Road', 'Nugathalawa', 'wholesale', 250000, 30, 1, now);

  return { db, now };
}

describe('Module 1: Professional Invoice & Billing Upgrade', () => {
  it('correctly calculates integer cents for multi-product invoices with wholesale, retail, and shop pricing', () => {
    // 3 packs of v1 wholesale (16000 cents * 3 = 48000 cents)
    // 2 packs of v2 retail (45000 cents * 2 = 90000 cents)
    const line1Gross = lineTotal(16000, 3);
    const line2Gross = lineTotal(45000, 2);
    expect(line1Gross).toBe(48000);
    expect(line2Gross).toBe(90000);

    // Item discount on line1: 10% (1000 basis points) => 4800 cents
    // Item discount on line2: Fixed LKR 50.00 => 5000 cents
    const lines = [
      { unitPriceCents: 16000, quantity: 3, discount: { type: 'percent' as const, value: 1000 } },
      { unitPriceCents: 45000, quantity: 2, discount: { type: 'fixed' as const, value: 5000 } }
    ];
    // Invoice level discount: 5% (500 basis points) on subtotal after item discounts
    const totals = invoiceTotals(lines, { type: 'percent', value: 500 });

    expect(totals.subtotalCents).toBe(138000);
    expect(totals.itemDiscountCents).toBe(4800 + 5000); // 9800
    // After item discount: 138000 - 9800 = 128200
    // 5% invoice discount on 128200: 6410
    expect(totals.invoiceDiscountCents).toBe(6410);
    expect(totals.totalDiscountCents).toBe(9800 + 6410); // 16210
    expect(totals.totalCents).toBe(128200 - 6410); // 121790
  });

  it('validates due dates between 0 and 45 days and 14-day reminder calculation', () => {
    const today = '2026-11-22';
    expect(dueDate(today, 0)).toBe('2026-11-22');
    expect(dueDate(today, 30)).toBe('2026-12-22');
    expect(dueDate(today, 45)).toBe('2027-01-06');
    expect(() => dueDate(today, 46)).toThrow();
    expect(() => dueDate(today, -1)).toThrow();

    // 14-day reminder before 2026-12-22 is 2026-12-08
    expect(reminderDate('2026-12-22')).toBe('2026-12-08');
  });

  it('supports draft save, update, query, and deletion', () => {
    const { db, now } = setupTestDb();
    const draftPayload = JSON.stringify({
      customerId: 'c1',
      warehouseId: 'main',
      invoiceDate: '2026-11-22',
      items: [{ variantId: 'v1', quantity: 2, priceType: 'wholesale' }]
    });

    // Create draft
    db.prepare('INSERT INTO invoice_drafts(id,customer_id,rep_id,warehouse_id,invoice_date,due_at,payment_method,payment_terms,notes,terms,invoice_discount_type,invoice_discount_value,payload_json,created_at,updated_at,customer_whatsapp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'd1', 'c1', 'admin', 'main', '2026-11-22', '2026-12-22', 'credit', 'Net 30', 'Draft note', '', 'fixed', 0, draftPayload, now, now, '94771234567'
    );

    const saved = db.prepare('SELECT * FROM invoice_drafts WHERE id=?').get('d1') as any;
    expect(saved.id).toBe('d1');
    expect(saved.payment_method).toBe('credit');

    // Update draft
    db.prepare('UPDATE invoice_drafts SET notes=?, updated_at=? WHERE id=?').run('Updated note', '2026-11-22T01:00:00Z', 'd1');
    const updated = db.prepare('SELECT notes FROM invoice_drafts WHERE id=?').get('d1') as any;
    expect(updated.notes).toBe('Updated note');

    // Delete draft
    db.prepare('DELETE FROM invoice_drafts WHERE id=?').run('d1');
    const deleted = db.prepare('SELECT * FROM invoice_drafts WHERE id=?').get('d1');
    expect(deleted).toBeUndefined();
  });

  it('enforces immutability on finalized invoices and invoice items', () => {
    const { db, now } = setupTestDb();
    const invoiceSql = 'INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

    db.prepare(invoiceSql).run('inv-1', 'INV-001', 'c1', 'admin', 'main', 50000, 20000, 'posted', '2026-12-22', 'k-inv-1', now, null, 50000, 0, 0, 'cash', '', '', '', 'sale', null);
    db.prepare('INSERT INTO invoice_items VALUES(?,?,?,?,?,?,?,?,?,?)').run('ii-1', 'inv-1', 'v1', 2, 16000, 12000, 32000, 'wholesale', 0, 18000);

    // Attempting to modify invoice billing values should throw
    expect(() => db.prepare('UPDATE invoices SET total_cents = 40000 WHERE id=?').run('inv-1')).toThrow();
    expect(() => db.prepare('UPDATE invoices SET subtotal_cents = 40000 WHERE id=?').run('inv-1')).toThrow();
    expect(() => db.prepare('UPDATE invoices SET payment_method = "credit" WHERE id=?').run('inv-1')).toThrow();

    // Attempting to modify or delete invoice items should throw
    expect(() => db.prepare('UPDATE invoice_items SET quantity = 5 WHERE id=?').run('ii-1')).toThrow();
    expect(() => db.prepare('DELETE FROM invoice_items WHERE id=?').run('ii-1')).toThrow();
  });

  it('manages admin-controlled shop selling price visibility via system_settings', () => {
    const { db } = setupTestDb();
    const setting = db.prepare("SELECT value FROM system_settings WHERE key='invoice_show_shop_price'").get() as any;
    expect(setting.value).toBe('false');

    db.prepare("UPDATE system_settings SET value='true' WHERE key='invoice_show_shop_price'").run();
    const updatedSetting = db.prepare("SELECT value FROM system_settings WHERE key='invoice_show_shop_price'").get() as any;
    expect(updatedSetting.value).toBe('true');
  });
});

describe('Module 2: Free Issue / Free Sample Management', () => {
  it('deducts inventory without creating revenue or customer debt', () => {
    const { db, now } = setupTestDb();

    // Confirm a free issue note
    db.prepare('INSERT INTO free_issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'fi-1', 'FI-20261122-001', '2026-11-22', 'c1', 'admin', 'main', 'sample', 'Promo trial', 'Admin User', 'Shopkeeper', 'confirmed', 'fi-idem-1', now, now, null
    );
    db.prepare('INSERT INTO free_issue_items VALUES(?,?,?,?,?)').run('fii-1', 'fi-1', 'v1', 5, 12000);

    // Stock movement for free issue
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('sm-fi-1', 'v1', 'main', null, 5, 'free_issue', 'fi-1', now);
    db.prepare("UPDATE stock_balances SET quantity=quantity-5 WHERE warehouse_id='main' AND variant_id='v1'").run();

    // Verify stock balance was reduced from 100 to 95
    const stock = db.prepare("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'").get() as any;
    expect(stock.quantity).toBe(95);

    // Verify zero invoices or debt created
    const invoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE source_id='fi-1'").get() as any;
    expect(invoices.count).toBe(0);

    // Free issue items and headers are immutable
    expect(() => db.prepare("UPDATE free_issue_items SET quantity=10 WHERE id='fii-1'").run()).toThrow();
    expect(() => db.prepare("DELETE FROM free_issue_items WHERE id='fii-1'").run()).toThrow();
    expect(() => db.prepare("UPDATE free_issues SET customer_id='other' WHERE id='fi-1'").run()).toThrow();
  });

  it('prevents duplicate deductions for the same reference and variant', () => {
    const { db, now } = setupTestDb();

    db.prepare('INSERT INTO free_issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'fi-dup', 'FI-DUP-01', '2026-11-22', 'c1', 'admin', 'main', 'sample', '', 'Admin', 'Owner', 'confirmed', 'fi-dup-key', now, now, null
    );
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('sm-dup-1', 'v1', 'main', null, 2, 'free_issue', 'fi-dup', now);

    // Second stock movement for same free_issue and same variant should fail due to unique index stock_distribution_once
    expect(() => db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('sm-dup-2', 'v1', 'main', null, 2, 'free_issue', 'fi-dup', now)).toThrow();
  });
});

describe('Module 3: Consignment / Sale or Return', () => {
  it('handles consignment delivery, partial settlement, and returns with full stock tracking', () => {
    const { db, now } = setupTestDb();

    // 1. Issue consignment of 20 units of v1 (initial stock = 100)
    db.prepare('INSERT INTO consignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'con-1', 'CON-20261122-001', '2026-11-22', 'c1', 'admin', 'main', '2026-12-22', 'Trial batch', 'Rep Sunil', 'Shop Kamal', 'open', 'con-idem-1', now, null
    );
    db.prepare('INSERT INTO consignment_items VALUES(?,?,?,?,?,?,?,?)').run(
      'ci-1', 'con-1', 'v1', 20, 0, 0, 0, 17500
    );
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run(
      'sm-con-1', 'v1', 'main', null, 20, 'consignment_issue', 'con-1', now
    );
    db.prepare("UPDATE stock_balances SET quantity=quantity-20 WHERE warehouse_id='main' AND variant_id='v1'").run();

    // Stock reduced to 80
    const stockAfterIssue = db.prepare("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'").get() as any;
    expect(stockAfterIssue.quantity).toBe(80);

    // No invoices created yet
    const initialInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE source_id='con-1'").get() as any;
    expect(initialInvoices.count).toBe(0);

    // 2. Partial settlement: 12 units sold
    const invoiceSql = 'INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    const totalSoldCents = lineTotal(17500, 12); // 210,000 cents
    db.prepare(invoiceSql).run(
      'inv-con-1', 'INV-CON-001', 'c1', 'admin', 'main', totalSoldCents, totalSoldCents, 'posted', null, 'settle-inv-key-1', now, null, totalSoldCents, 0, 0, 'cash', 'Consignment settlement', '', '', 'consignment', 'con-1'
    );
    db.prepare('INSERT INTO consignment_settlements VALUES(?,?,?,?,?,?,?)').run(
      'cs-1', 'con-1', 'inv-con-1', '2026-11-22', 'settle-idem-1', 'admin', now
    );
    db.prepare('INSERT INTO consignment_settlement_items VALUES(?,?,?,?,?,?)').run(
      'csi-1', 'cs-1', 'ci-1', 12, 17500, totalSoldCents
    );
    db.prepare("UPDATE consignment_items SET sold_quantity=sold_quantity+12 WHERE id='ci-1'").run();

    // 3. Return 5 units saleable stock (warehouse stock should increase by 5)
    db.prepare('INSERT INTO consignment_returns VALUES(?,?,?,?,?,?,?,?,?)').run(
      'cr-1', 'con-1', '2026-11-22', 'saleable', 'Unsold balance', 'Rep Sunil', 'ret-idem-1', 'admin', now
    );
    db.prepare('INSERT INTO consignment_return_items VALUES(?,?,?,?)').run('cri-1', 'cr-1', 'ci-1', 5);
    db.prepare("UPDATE consignment_items SET returned_quantity=returned_quantity+5 WHERE id='ci-1'").run();
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('sm-ret-1', 'v1', null, 'main', 5, 'consignment_return', 'cr-1', now);
    db.prepare("UPDATE stock_balances SET quantity=quantity+5 WHERE warehouse_id='main' AND variant_id='v1'").run();

    // Warehouse stock should now be 80 + 5 = 85
    const stockAfterReturn = db.prepare("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'").get() as any;
    expect(stockAfterReturn.quantity).toBe(85);

    // 4. Return 3 units damaged stock (warehouse stock should NOT increase)
    db.prepare('INSERT INTO consignment_returns VALUES(?,?,?,?,?,?,?,?,?)').run(
      'cr-2', 'con-1', '2026-11-22', 'damaged', 'Crushed box', 'Rep Sunil', 'ret-idem-2', 'admin', now
    );
    db.prepare('INSERT INTO consignment_return_items VALUES(?,?,?,?)').run('cri-2', 'cr-2', 'ci-1', 3);
    db.prepare("UPDATE consignment_items SET damaged_quantity=damaged_quantity+3 WHERE id='ci-1'").run();
    db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)').run('sm-dmg-1', 'v1', null, null, 3, 'consignment_damaged', 'cr-2', now);

    // Warehouse stock remains 85 (damaged goods are not returned to saleable inventory)
    const stockAfterDamage = db.prepare("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v1'").get() as any;
    expect(stockAfterDamage.quantity).toBe(85);

    // 5. Verification of total quantities: 12 sold + 5 returned + 3 damaged = 20 issued (0 remaining)
    const item = db.prepare("SELECT issued_quantity, sold_quantity, returned_quantity, damaged_quantity, (issued_quantity - sold_quantity - returned_quantity - damaged_quantity) AS remaining_quantity FROM consignment_items WHERE id='ci-1'").get() as any;
    expect(item.issued_quantity).toBe(20);
    expect(item.sold_quantity).toBe(12);
    expect(item.returned_quantity).toBe(5);
    expect(item.damaged_quantity).toBe(3);
    expect(item.remaining_quantity).toBe(0);

    // Exceeding issued quantity throws
    expect(() => db.prepare("UPDATE consignment_items SET sold_quantity=sold_quantity+1 WHERE id='ci-1'").run()).toThrow();
  });
});

describe('Module: Invoice WhatsApp Sharing & Public Invoice Verification', () => {
  it('stores customer WhatsApp and unique share token with each invoice', () => {
    const { db, now } = setupTestDb();
    const token = 'test-share-token-12345';
    const wa = '94771234567';

    db.prepare(`INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'inv-wa-1', 'INV-WA-001', 'c1', 'admin', 'main', 20000, 20000, 'posted', null, 'idem-wa-1', now, null, 20000, 0, 0, 'cash', '', '', '', 'sale', null, wa, token
    );

    const saved = db.prepare('SELECT customer_whatsapp, share_token FROM invoices WHERE id=?').get('inv-wa-1') as any;
    expect(saved.customer_whatsapp).toBe('94771234567');
    expect(saved.share_token).toBe(token);

    // Enforces unique share_token
    expect(() => {
      db.prepare(`INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        'inv-wa-2', 'INV-WA-002', 'c1', 'admin', 'main', 20000, 20000, 'posted', null, 'idem-wa-2', now, null, 20000, 0, 0, 'cash', '', '', '', 'sale', null, wa, token
      );
    }).toThrow();
  });

  it('allows authorized users to update WhatsApp recipient on a posted invoice without violating immutability', () => {
    const { db, now } = setupTestDb();
    const token = 'test-token-update';
    db.prepare(`INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'inv-wa-up', 'INV-WA-UP', 'c1', 'admin', 'main', 20000, 20000, 'posted', null, 'idem-wa-up', now, null, 20000, 0, 0, 'cash', '', '', '', 'sale', null, '94771234567', token
    );

    // Update customer_whatsapp directly (allowed by immutability triggers)
    db.prepare('UPDATE invoices SET customer_whatsapp=? WHERE id=?').run('94766615492', 'inv-wa-up');
    const updated = db.prepare('SELECT customer_whatsapp FROM invoices WHERE id=?').get('inv-wa-up') as any;
    expect(updated.customer_whatsapp).toBe('94766615492');

    // Audit log can be recorded
    db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)').run('aud-1', 'admin', 'invoice.whatsapp_updated', 'inv-wa-up', 'Old: 94771234567, New: 94766615492', now);
    const auditRow = db.prepare('SELECT * FROM audit_logs WHERE id=?').get('aud-1') as any;
    expect(auditRow.action).toBe('invoice.whatsapp_updated');
  });

  it('renders complete, accessible public invoice HTML with branding, customer details, and print capability', () => {
    const mockInvoice = {
      id: 'inv-test-html',
      number: 'INV-20261122-001',
      created_at: '2026-11-22T00:00:00Z',
      shop_name: 'Perera Supermarket',
      owner_name: 'Nimal Perera',
      customer_address: 'No 45, Main Street, Narangoda',
      customer_whatsapp: '94771234567',
      business_name: 'Nugathalawa Ceylon Tea Export (Pvt) Ltd',
      business_address: 'Na Sewana, Hamangalla, Narangoda, Sri Lanka',
      business_phone: '076 661 5492',
      business_whatsapp: '076 696 5493',
      business_email: 'sanjeewakumara7080@gmail.com',
      subtotal_cents: 38000,
      total_cents: 38000,
      paid_cents: 10000,
      due_at: '2026-12-22',
      payment_method: 'credit',
      notes: 'Please pay within 30 days',
      terms: 'All teas are pure Ceylon tea.',
    };

    const mockItems = [
      {
        product_name: 'Nugathalawa Pure Ceylon BOPF Tea',
        variant_label: '200g Packet',
        unit: 'packet',
        quantity: 1,
        price_type: 'wholesale',
        unit_price_cents: 38000,
        item_discount_cents: 0,
        shop_price_cents: 42000,
        line_cents: 38000,
      },
    ];

    const html = renderPublicInvoiceHtml({
      invoice: mockInvoice,
      items: mockItems,
      showShopPrice: true,
      showCustomerWhatsapp: true,
    });

    expect(html).toContain('Nugathalawa Ceylon Tea Export (Pvt) Ltd');
    expect(html).toContain('INV-20261122-001');
    expect(html).toContain('Perera Supermarket');
    expect(html).toContain('+94 77 123 4567');
    expect(html).toContain('Print / Save PDF');
    expect(html).toContain('Issued By / Authorized Signature');
    expect(html).toContain('Received By / Customer Signature');
  });
});
