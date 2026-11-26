import { parseFreeNote, FREE_PREFIX } from '../free-issue';
// The single authoritative invoice model. Preview, A4 PDF, A4 print, thermal
// receipt and WhatsApp share text are all produced from this object, so their
// numbers can never disagree. Every amount comes from the server (integer
// cents); nothing here recalculates or invents financial values.

export type InvoiceDetail = {
  invoice: {
    id: string; number: string; created_at: string;
    shop_name: string; address: string; whatsapp: string; customer_whatsapp?: string; share_token?: string;
    business_name: string; business_address: string; business_phone: string; business_whatsapp?: string; business_email?: string;
    subtotal_cents: number; item_discount_cents: number; invoice_discount_cents: number; total_cents: number; paid_cents: number;
    due_at: string | null; payment_method: string; payment_terms: string; notes: string; terms: string; status: string;
    customer_id?: string; warehouse_id?: string; owner_name?: string; rep_name?: string;
  };
  items: Array<{
    id: string; name: string; label: string; quantity: number;
    unit_price_cents: number; shop_price_cents: number; item_discount_cents: number; line_cents: number; price_type: string;
    variant_id?: string;
  }>;
};

export type InvoiceLine = {
  no: number; product: string; pack: string; qty: number;
  unit: number; shopPrice: number | null; discount: number; total: number;
  /** Free issue packets included in qty (their value is excluded from discount). */
  freeQty?: number;
};

export type FreeIssueRow = { size: string; qty: number; items: string[] };

export type InvoiceModel = {
  number: string; date: string; dueDate: string | null; status: string;
  business: { name: string; address: string; phone: string; whatsapp: string; email: string };
  customer: { name: string; address: string; whatsapp: string };
  paymentMethod: string; paymentTerms: string; notes: string; terms: string;
  lines: InvoiceLine[];
  showShopPrice: boolean; showCustomerWhatsapp: boolean;
  subtotal: number; itemDiscount: number; invoiceDiscount: number; total: number; paid: number; outstanding: number;
  /** Value of free issue packets (shown separately, not as a discount). */
  freeValue: number; freeCount: number;
  /** Free issue summary for the box under the table: 50g / 100g / 200g always, plus any other pack. */
  freeIssue: FreeIssueRow[];
  /** Names printed under the two signature lines. */
  repName: string; ownerName: string;
  shareToken?: string;
};

const SL_TZ = 'Asia/Colombo';
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { timeZone: SL_TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

/** LKR with thousands separators, e.g. "Rs 12,450.00" (prefix optional). */
export function lkr(cents: number, prefix = true): string {
  const s = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(cents) / 100);
  return `${cents < 0 ? '-' : ''}${prefix ? 'Rs ' : ''}${s}`;
}

export function toInvoiceModel(d: InvoiceDetail, settings?: Record<string, string>): InvoiceModel {
  const i = d.invoice;
  const showShopPrice = settings?.invoice_show_shop_price === 'true';
  return {
    number: i.number, date: i.created_at, dueDate: i.due_at, status: i.status,
    business: {
      name: i.business_name || 'Nugathalawa Ceylon Tea Export (Pvt) Ltd',
      address: i.business_address || '', phone: i.business_phone || '', whatsapp: i.business_whatsapp || '', email: i.business_email || '',
    },
    customer: { name: i.shop_name, address: i.address || '', whatsapp: i.customer_whatsapp || i.whatsapp || '' },
    paymentMethod: i.payment_method ? i.payment_method[0].toUpperCase() + i.payment_method.slice(1) : '', paymentTerms: i.payment_terms || '', notes: (i.notes || '').split('\n').filter(l => !l.startsWith(FREE_PREFIX)).join('\n'), terms: i.terms || '',
    ...(() => {
      const freeMap = parseFreeNote(i.notes || '');
      let freeValue = 0, freeCount = 0;
      const lines = d.items.map((x, n) => {
        const fq = Math.min(freeMap.get(`${x.name} · ${x.label}`) || 0, x.quantity);
        const fv = Math.min(fq * x.unit_price_cents, x.item_discount_cents);
        freeValue += fv; freeCount += fq;
        return {
          no: n + 1, product: x.name, pack: x.label, qty: x.quantity, unit: x.unit_price_cents,
          shopPrice: showShopPrice && x.shop_price_cents ? x.shop_price_cents : null,
          discount: x.item_discount_cents - fv, total: x.line_cents, freeQty: fq || undefined,
        };
      });
      return { lines, freeValue, freeCount, freeIssue: freeIssueRows(lines), subtotal: i.subtotal_cents - freeValue, itemDiscount: i.item_discount_cents - freeValue };
    })(),
    showShopPrice, showCustomerWhatsapp: settings?.invoice_show_customer_whatsapp !== 'false',
    invoiceDiscount: i.invoice_discount_cents,
    total: i.total_cents, paid: i.paid_cents, outstanding: Math.max(0, i.total_cents - i.paid_cents),
    shareToken: i.share_token,
    repName: i.rep_name || '', ownerName: i.owner_name || '',
  };
}

const packGrams = (l: InvoiceLine) => Number((`${l.pack} ${l.product}`.match(/(\d+)\s*g\b/i) || [])[1]) || 0;
/** Free packets grouped by pack size, like the printed bill book (50g / 100g / 200g). */
export function freeIssueRows(lines: InvoiceLine[]): FreeIssueRow[] {
  const rows = new Map<string, FreeIssueRow>([50, 100, 200].map(g => [`${g}g`, { size: `${g}g`, qty: 0, items: [] }]));
  for (const l of lines) {
    if (!l.freeQty) continue;
    const g = packGrams(l), size = [50, 100, 200].includes(g) ? `${g}g` : [l.pack, l.product].filter(Boolean).join(' · ');
    const row = rows.get(size) || { size, qty: 0, items: [] };
    row.qty += l.freeQty; row.items.push(l.product);
    rows.set(size, row);
  }
  return [...rows.values()];
}

/**
 * Splits lines into A4 pages. Units approximate table-row heights; long product
 * names wrap to two rows. The totals/signature block always stays together on
 * the final page. Capacities are tuned for the 794×1123 px page in
 * components/invoice-document.tsx.
 */
export function paginate(lines: InvoiceLine[], cap = { first: 17, middle: 27, totalsBlock: 12 }): InvoiceLine[][] {
  const weight = (l: InvoiceLine) => (`${l.product} ${l.pack}`.length > 42 ? 2 : 1);
  const pages: InvoiceLine[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const limit = pages.length === 1 ? cap.first : cap.middle;
    if (used + weight(l) > limit && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(l); used += weight(l);
  }
  const lastLimit = pages.length === 1 ? cap.first : cap.middle;
  if (used + cap.totalsBlock > lastLimit) pages.push([]); // totals on their own final page
  return pages;
}

export function whatsappMessage(m: InvoiceModel, link?: string): string {
  return [
    `Hello ${m.customer.name},`, '',
    `Your invoice from ${m.business.name} is attached.`, '',
    `Invoice No: ${m.number}`, `Date: ${formatDate(m.date)}`,
    `Total: ${lkr(m.total)}`, `Paid: ${lkr(m.paid)}`, `Balance: ${lkr(m.outstanding)}`,
    m.dueDate ? `Due date: ${formatDate(m.dueDate)}` : null,
    link ? '' : null, link ? `Online copy: ${link}` : null, '', 'Thank you!',
  ].filter((x): x is string => x !== null).join('\n');
}

export const pdfFileName = (m: InvoiceModel, kind: 'A4' | 'receipt') =>
  `${m.number.replace(/[^A-Za-z0-9-]+/g, '_')}_${kind === 'A4' ? 'Invoice' : 'Receipt'}.pdf`;
