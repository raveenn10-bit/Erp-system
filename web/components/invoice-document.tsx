'use client';
// Presentation of the authoritative InvoiceModel. The same markup is used for
// the on-screen preview, the A4 PDF, A4 printing and the thermal receipt.
import { formatDate, lkr, paginate, type InvoiceModel } from '@/lib/invoice/model';

export const A4_PX = { width: 794, height: 1123 }; // 210×297 mm at 96 dpi

function Header({ m, compact }: { m: InvoiceModel; compact?: boolean }) {
  const contacts = [m.business.phone && `Tel ${m.business.phone}`, m.business.whatsapp && `WhatsApp ${m.business.whatsapp}`, m.business.email].filter(Boolean).join('  ·  ');
  return (
    <header className={`inv-head ${compact ? 'compact' : ''}`}>
      <div className="ninv-brand">
        <img src="/nugathalawa-logo.jpg" alt="" crossOrigin="anonymous" />
        <div>
          <h1>{m.business.name}</h1>
          {!compact && <p>{m.business.address}</p>}
          {!compact && contacts && <p>{contacts}</p>}
        </div>
      </div>
      <div className="ninv-title">
        <span>{m.status === 'cancelled' ? 'CANCELLED INVOICE' : 'SALES INVOICE'}</span>
        <b>{m.number}</b>
        {!compact && <dl>
          <dt>Date</dt><dd>{formatDate(m.date)}</dd>
          {m.dueDate && <><dt>Due</dt><dd>{formatDate(m.dueDate)}</dd></>}
        </dl>}
      </div>
    </header>
  );
}

function Table({ m, lines }: { m: InvoiceModel; lines: InvoiceModel['lines'] }) {
  if (!lines.length) return null;
  return (
    <table className="ninv-table">
      <thead>
        <tr>
          <th className="n">#</th><th>Product</th><th>Pack size</th><th className="r">Qty</th><th className="r">Unit price</th>
          {m.showShopPrice && <th className="r">Shop price</th>}
          <th className="r">Discount</th><th className="r">Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map(l => (
          <tr key={l.no}>
            <td className="n">{l.no}</td><td className="p">{l.product}{l.freeQty ? <span className="ninv-free">incl. {l.freeQty} FREE</span> : null}</td><td>{l.pack}</td>
            <td className="r">{l.qty}</td><td className="r">{lkr(l.unit, false)}</td>
            {m.showShopPrice && <td className="r">{l.shopPrice ? lkr(l.shopPrice, false) : '—'}</td>}
            <td className="r">{l.discount ? lkr(-l.discount, false) : '—'}</td><td className="r b">{lkr(l.total, false)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Free Issue  50g – / 100g – / 200g –" box, like the printed bill book. */
function FreeIssueBox({ m }: { m: InvoiceModel }) {
  return (
    <div className="ninv-freebox">
      <div className="ninv-freebox-head">Free Issue · නොමිලේ</div>
      {m.freeIssue.map(r => (
        <div className="ninv-freebox-row" key={r.size}>
          <span className="sz">{r.size}</span>
          <span className="dots" />
          <b>{r.qty ? `${r.qty} pcs` : '–'}</b>
        </div>
      ))}
    </div>
  );
}

function Signatures({ m }: { m: InvoiceModel }) {
  return (
    <section className="ninv-sign">
      <div><i /><span>Customer signature · ගනුදෙනුකරු</span><small>{m.ownerName ? `${m.ownerName} · ` : ''}{m.customer.name}</small></div>
      <div><i /><span>S/R signature · විකුණුම් නියෝජිත</span><small>{m.repName || 'Sales representative'}</small></div>
    </section>
  );
}

function Totals({ m }: { m: InvoiceModel }) {
  return (
    <section className="ninv-bottom">
      <div className="ninv-notes">
        {m.paymentTerms && <p><b>Payment terms</b>{m.paymentTerms}</p>}
        {m.notes && <p><b>Notes</b>{m.notes}</p>}
        {m.terms && <p><b>Terms &amp; conditions</b>{m.terms}</p>}
      </div>
      <dl className="ninv-totals">
        <dt>Subtotal</dt><dd>{lkr(m.subtotal)}</dd>
        {m.freeCount > 0 && <><dt>Free issue ({m.freeCount} pcs)</dt><dd>FREE</dd></>}
        {m.itemDiscount > 0 && <><dt>Item discounts</dt><dd>{lkr(-m.itemDiscount)}</dd></>}
        {m.invoiceDiscount > 0 && <><dt>Invoice discount</dt><dd>{lkr(-m.invoiceDiscount)}</dd></>}
        <dt className="grand">Grand total</dt><dd className="grand">{lkr(m.total)}</dd>
        <dt>Paid</dt><dd>{lkr(m.paid)}</dd>
        <dt className="due">Outstanding balance</dt><dd className="due">{lkr(m.outstanding)}</dd>
      </dl>
    </section>
  );
}

/** Paginated A4 invoice. Each `.ninv-page` is exactly one printed/PDF page. */
export function InvoiceA4({ m }: { m: InvoiceModel }) {
  const pages = paginate(m.lines);
  return (
    <div className="ninv-doc">
      {pages.map((lines, p) => {
        const last = p === pages.length - 1;
        return (
          <article className="ninv-page" key={p}>
            <div className="ninv-band" />
            <Header m={m} compact={p > 0} />
            {p === 0 && (
              <section className="ninv-parties">
                <div>
                  <span>Bill to</span>
                  <b>{m.customer.name}</b>
                  {m.customer.address && <p>{m.customer.address}</p>}
                  {m.showCustomerWhatsapp && m.customer.whatsapp && <p>WhatsApp {m.customer.whatsapp}</p>}
                </div>
                <div>
                  <span>Payment</span>
                  <b>{m.paymentMethod || '—'}</b>
                  <p>Paid {lkr(m.paid)} of {lkr(m.total)}</p>
                  {m.dueDate && <p>Balance due by {formatDate(m.dueDate)}</p>}
                </div>
              </section>
            )}
            <Table m={m} lines={lines} />
            {!last && <p className="ninv-cont">Continued on next page…</p>}
            {last && <>
              <FreeIssueBox m={m} />
              <Totals m={m} />
              <Signatures m={m} />
            </>}
            <footer className="ninv-foot">
              <span>Thank you for your business · ස්තුතියි</span>
              <span>{m.number} · Page {p + 1} of {pages.length}</span>
            </footer>
          </article>
        );
      })}
    </div>
  );
}

/** Black-and-white receipt rendered at the printer's dot width (58mm=384, 80mm=576). */
export function InvoiceReceipt({ m, spec }: { m: InvoiceModel; spec: { dots: number; fontPx: number; marginDots: number; showLogo: boolean } }) {
  const { dots } = spec;
  const fs = spec.fontPx;
  return (
    <div className="rcpt" style={{ width: dots, fontSize: fs, paddingLeft: spec.marginDots, paddingRight: spec.marginDots }}>
      {spec.showLogo && <div className="rcpt-c"><img src="/nugathalawa-logo.jpg" alt="" style={{ display: 'block', margin: '0 auto', width: Math.round(dots * 0.32), height: Math.round(dots * 0.32), borderRadius: '50%', filter: 'grayscale(1) contrast(1.4)' }} /></div>}
      <div className="rcpt-c rcpt-b" style={{ fontSize: fs * 1.15 }}>{m.business.name}</div>
      {m.business.address && <div className="rcpt-c">{m.business.address}</div>}
      {m.business.phone && <div className="rcpt-c">Tel {m.business.phone}</div>}
      <div className="rcpt-hr" />
      <div className="rcpt-c rcpt-b">SALES RECEIPT</div>
      <div className="rcpt-row"><span>Invoice</span><span>{m.number}</span></div>
      <div className="rcpt-row"><span>Date</span><span>{formatDate(m.date)}</span></div>
      <div className="rcpt-row"><span>Customer</span><span className="rcpt-rt">{m.customer.name}</span></div>
      {m.paymentMethod && <div className="rcpt-row"><span>Payment</span><span>{m.paymentMethod}</span></div>}
      <div className="rcpt-hr" />
      {m.lines.map(l => (
        <div key={l.no} className="rcpt-item">
          <div className="rcpt-b">{l.product} {l.pack && `· ${l.pack}`}</div>
          <div className="rcpt-row"><span>{l.qty - (l.freeQty || 0)} × {lkr(l.unit, false)}{l.discount ? `  (-${lkr(l.discount, false)})` : ''}</span><span className="rcpt-b">{lkr(l.total, false)}</span></div>
          {l.freeQty ? <div className="rcpt-row"><span>+ {l.freeQty} FREE ISSUE</span><span className="rcpt-b">FREE</span></div> : null}
        </div>
      ))}
      <div className="rcpt-hr" />
      <div className="rcpt-b">FREE ISSUE</div>
      {m.freeIssue.map(r => <div key={r.size} className="rcpt-row"><span>{r.size}</span><span className="rcpt-b">{r.qty ? `${r.qty} pcs` : '-'}</span></div>)}
      <div className="rcpt-hr" />
      <div className="rcpt-row"><span>Subtotal</span><span>{lkr(m.subtotal, false)}</span></div>
      {m.freeCount > 0 && <div className="rcpt-row"><span>Free issue</span><span>{m.freeCount} pcs FREE</span></div>}
      {m.itemDiscount + m.invoiceDiscount > 0 && <div className="rcpt-row"><span>Discounts</span><span>{lkr(-(m.itemDiscount + m.invoiceDiscount), false)}</span></div>}
      <div className="rcpt-row rcpt-b rcpt-big" style={{ fontSize: fs * 1.25 }}><span>TOTAL</span><span>{lkr(m.total)}</span></div>
      <div className="rcpt-row"><span>Paid</span><span>{lkr(m.paid, false)}</span></div>
      <div className="rcpt-row rcpt-b"><span>Balance</span><span>{lkr(m.outstanding, false)}</span></div>
      {m.dueDate && <div className="rcpt-row"><span>Due</span><span>{formatDate(m.dueDate)}</span></div>}
      <div className="rcpt-hr" />
      <div className="rcpt-sign"><div><i />Customer signature</div><div><i />S/R signature</div></div>
      {(m.ownerName || m.repName) && <div className="rcpt-sign rcpt-names"><div>{m.ownerName}</div><div>{m.repName}</div></div>}
      <div className="rcpt-c" style={{ marginTop: fs * 0.6 }}>Thank you! · ස්තුතියි</div>
    </div>
  );
}
