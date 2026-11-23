import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildInvoiceModel,
  lkr,
  sanitizeThermal,
  validatePhone,
  pdfFileName,
  type InvoiceDetail,
} from '../../web/lib/invoice-model';
import { buildA4InvoicePdf, buildThermalPdf } from '../../web/lib/invoice-pdf';

/** Isolated fixture mirroring INV-20261122-5FB8D237 — never touches any real database. */
function fixture(overrides: Partial<InvoiceDetail['invoice']> = {}, items?: InvoiceDetail['items']): InvoiceDetail {
  return {
    invoice: {
      id: 'inv-test-1',
      number: 'INV-20261122-5FB8D237',
      created_at: '2026-11-22T04:30:00.000Z',
      shop_name: 'T1',
      address: 'Galle',
      whatsapp: '0771234567',
      customer_whatsapp: null,
      business_name: 'Nugathalawa Ceylon Tea Export (Pvt) Ltd',
      business_address: 'Nugathalawa',
      business_phone: '0112345678',
      business_whatsapp: '',
      business_email: '',
      subtotal_cents: 27000,
      item_discount_cents: 0,
      invoice_discount_cents: 0,
      total_cents: 27000,
      paid_cents: 27000,
      due_at: null,
      payment_method: 'cash',
      payment_terms: 'cash',
      notes: '',
      terms: 'Goods once sold are not returnable.',
      status: 'posted',
      ...overrides,
    },
    items: items ?? [
      { id: 'l1', name: 'Test 1', label: '100g', quantity: 1, unit_price_cents: 27000, shop_price_cents: 0, item_discount_cents: 0, line_cents: 27000, price_type: 'wholesale' },
    ],
  };
}
const opts = { showShopPrice: false, showCustomerWhatsapp: true };

async function pdfInfo(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = Buffer.from(bytes).toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox \[([\d.\s]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  return { bytes, text, boxes, pages: Number(/\/Type \/Pages[^>]*\/Count (\d+)/.exec(text)?.[1] ?? 0) };
}

describe('invoice view-model (single source of truth)', () => {
  it('uses stored totals without recalculating', () => {
    const m = buildInvoiceModel(fixture(), opts);
    expect(m.number).toBe('INV-20261122-5FB8D237');
    expect(m.totalCents).toBe(27000);
    expect(m.paidCents).toBe(27000);
    expect(m.outstandingCents).toBe(0);
    expect(m.lines[0]).toMatchObject({ description: 'Test 1', pack: '100g', quantity: 1, unitCents: 27000, lineCents: 27000, priceType: 'Wholesale' });
    expect(m.dateLabel).toBe('22 Nov 2026');
    expect(m.timeLabel).toMatch(/10:00/); // Asia/Colombo
  });
  it('keeps the stored total even if lines would sum differently (no re-pricing)', () => {
    const m = buildInvoiceModel(fixture({ total_cents: 25000, invoice_discount_cents: 2000, paid_cents: 10000 }), opts);
    expect(m.totalCents).toBe(25000);
    expect(m.outstandingCents).toBe(15000);
  });
  it('formats LKR with plain ASCII spaces', () => {
    expect(lkr(27000)).toBe('LKR 270.00');
    expect(lkr(123456789)).toBe('LKR 1,234,567.89');
    expect(lkr(-500)).toBe('-LKR 5.00');
  });
  it('respects the hide-customer-WhatsApp setting', () => {
    expect(buildInvoiceModel(fixture(), opts).customer.whatsapp).toBe('+94 77 123 4567');
    expect(buildInvoiceModel(fixture(), { ...opts, showCustomerWhatsapp: false }).customer.whatsapp).toBe('');
  });
  it('builds a safe download filename', () => {
    expect(pdfFileName(buildInvoiceModel(fixture({ number: 'INV/../x' }), opts))).toBe('INV-x.pdf');
  });
});

describe('WhatsApp number validation', () => {
  it('accepts Sri Lankan mobiles in any common format', () => {
    for (const n of ['0771234567', '+94 77 123 4567', '94771234567', '771234567'])
      expect(validatePhone(n)).toMatchObject({ ok: true, normalized: '94771234567' });
  });
  it('rejects Sri Lankan landlines/short numbers and accepts international E.164', () => {
    expect(validatePhone('0112345678').ok).toBe(false);
    expect(validatePhone('12345').ok).toBe(false);
    expect(validatePhone('+44 7700 900123')).toMatchObject({ ok: true, normalized: '447700900123' });
  });
});

describe('thermal settings', () => {
  it('defaults and clamps unsafe values', () => {
    expect(sanitizeThermal(null)).toMatchObject({ paperWidthMm: 80, printableWidthMm: 72, copies: 1 });
    const s = sanitizeThermal({ paperWidthMm: 58, printableWidthMm: 90, fontSizePx: 99, copies: 50, marginMm: -3 });
    expect(s).toMatchObject({ paperWidthMm: 58, printableWidthMm: 58, fontSizePx: 18, copies: 5, marginMm: 0 });
    expect(sanitizeThermal('{bad json')).toMatchObject({ paperWidthMm: 80 });
  });
});

describe('PDF generation', () => {
  it('produces a valid single-page A4 portrait PDF', async () => {
    const blob = await buildA4InvoicePdf(buildInvoiceModel(fixture(), opts));
    const { bytes, text, boxes, pages } = await pdfInfo(blob);
    expect(blob.type).toBe('application/pdf');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pages).toBe(1);
    // A4 = 595.28 x 841.89 pt
    expect(boxes[0][2]).toBeCloseTo(595.28, 0);
    expect(boxes[0][3]).toBeCloseTo(841.89, 0);
    expect(bytes.length).toBeGreaterThan(2000);
    expect(text).toContain('INV-20261122-5FB8D237');
  });
  it('flows long invoices onto multiple A4 pages', async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({
      id: `l${i}`, name: `Nugathalawa Premium Ceylon Black Tea long description number ${i} with extra words to wrap`,
      label: '200g', quantity: i + 1, unit_price_cents: 52000, shop_price_cents: 0, item_discount_cents: i % 3 ? 0 : 1000,
      line_cents: 52000 * (i + 1) - (i % 3 ? 0 : 1000), price_type: i % 2 ? 'retail' : 'wholesale',
    }));
    const blob = await buildA4InvoicePdf(buildInvoiceModel(fixture({ total_cents: 999, paid_cents: 0, notes: 'Partial credit invoice', due_at: '2026-12-22' }, items), opts));
    const { pages, boxes } = await pdfInfo(blob);
    expect(pages).toBeGreaterThan(2);
    expect(boxes.every((b) => Math.round(b[2]) === 595 && Math.round(b[3]) === 842)).toBe(true);
  });
  it('produces 58mm, 80mm and custom-width receipts', async () => {
    for (const width of [58, 80, 100]) {
      const blob = await buildThermalPdf(buildInvoiceModel(fixture(), opts), sanitizeThermal({ paperWidthMm: width }));
      const { text, boxes } = await pdfInfo(blob);
      expect(text.startsWith('%PDF-')).toBe(true);
      expect(boxes[0][2]).toBeCloseTo((width / 25.4) * 72, 0);
      expect(boxes[0][3]).toBeGreaterThan(boxes[0][2]);
    }
  });
});

describe('print settings storage (isolated in-memory D1 schema)', () => {
  it('stores thermal settings in the existing system_settings table — no schema change needed', () => {
    const db = new DatabaseSync(':memory:');
    const dir = path.resolve(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const value = JSON.stringify(sanitizeThermal({ paperWidthMm: 58 }));
    db.prepare("INSERT INTO system_settings(key,value) VALUES('thermal_printer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
    const row = db.prepare("SELECT value FROM system_settings WHERE key='thermal_printer'").get() as { value: string };
    expect(sanitizeThermal(row.value).paperWidthMm).toBe(58);
  });
  it('sales reps can view invoices (print-settings guard) but not business settings', () => {
    const db = new DatabaseSync(':memory:');
    const dir = path.resolve(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const perms = (db.prepare("SELECT permission_key FROM role_permissions WHERE role_id='sales_rep'").all() as { permission_key: string }[]).map((r) => r.permission_key);
    expect(perms).toContain('invoices.view');
    expect(perms).not.toContain('settings.view');
    expect(perms).not.toContain('settings.edit');
  });
});
