"use client";
import { amount, lkr, type InvoiceModel, type ThermalSettings } from "@/lib/invoice-model";

/** A4 commercial invoice — used for the on-screen preview and for A4 printing. */
export function InvoiceDocument({ model }: { model: InvoiceModel }) {
  const b = model.business;
  const status = model.cancelled
    ? "Cancelled"
    : model.outstandingCents > 0
      ? model.paidCents > 0
        ? "Partially paid"
        : "Unpaid"
      : "Paid";
  return (
    <article className="inv-a4" aria-label={`Invoice ${model.number}`}>
      <div className="inv-topbar" aria-hidden="true" />
      <header className="inv-head">
        <div className="inv-brand">
          <img src="/nugathalawa-logo.jpg" alt="" className="inv-logo" />
          <div>
            <h1>{b.name}</h1>
            {b.address && <p>{b.address}</p>}
            {(b.phone || b.whatsapp) && (
              <p>
                {b.phone && <>Tel: {b.phone}</>}
                {b.phone && b.whatsapp && <>&nbsp;&nbsp;</>}
                {b.whatsapp && <>WhatsApp: {b.whatsapp}</>}
              </p>
            )}
            {b.email && <p>{b.email}</p>}
          </div>
        </div>
        <div className="inv-title">
          <h2 className={model.cancelled ? "cancelled" : ""}>
            {model.cancelled ? "CANCELLED" : "INVOICE"}
          </h2>
          <dl>
            <dt>Invoice No</dt>
            <dd>{model.number}</dd>
            <dt>Invoice Date</dt>
            <dd>
              {model.dateLabel}
              {model.timeLabel && `, ${model.timeLabel}`}
            </dd>
            {model.dueDate && (
              <>
                <dt>Due Date</dt>
                <dd>{model.dueDate}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="inv-parties">
        <div>
          <span className="inv-label">Invoice to</span>
          <strong className="inv-shop">{model.customer.shopName}</strong>
          {model.customer.address && <p>{model.customer.address}</p>}
          {model.customer.whatsapp && <p>WhatsApp: {model.customer.whatsapp}</p>}
        </div>
        <div>
          <span className="inv-label">Payment</span>
          <dl className="inv-kv">
            <dt>Method</dt>
            <dd>{model.paymentMethod || "—"}</dd>
            <dt>Terms</dt>
            <dd>{model.paymentTerms || "—"}</dd>
            <dt>Status</dt>
            <dd>{status}</dd>
          </dl>
        </div>
      </section>

      <table className="inv-table">
        <thead>
          <tr>
            <th className="c-no">#</th>
            <th className="c-desc">Product Description</th>
            <th className="c-type">Type</th>
            <th className="num">Qty</th>
            <th className="num">Unit Price</th>
            <th className="num">Discount</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l, i) => (
            <tr key={l.id}>
              <td className="c-no">{i + 1}</td>
              <td className="c-desc">
                <b>{l.description}</b>
                <span className="inv-pack"> — {l.pack}</span>
                {model.showShopPrice && l.shopPriceCents > 0 && (
                  <small>Shop price: {lkr(l.shopPriceCents)}</small>
                )}
              </td>
              <td className="c-type">{l.priceType || "—"}</td>
              <td className="num">{l.quantity}</td>
              <td className="num">{amount(l.unitCents)}</td>
              <td className="num muted-cell">{l.discountCents ? `−${amount(l.discountCents)}` : "—"}</td>
              <td className="num strong">{amount(l.lineCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="inv-bottom">
        <div className="inv-notes">
          {model.notes && (
            <>
              <span className="inv-label">Notes</span>
              <p>{model.notes}</p>
            </>
          )}
        </div>
        <div className="inv-totals">
          <div>
            <span>Subtotal</span>
            <b>{lkr(model.subtotalCents)}</b>
          </div>
          {model.itemDiscountCents > 0 && (
            <div>
              <span>Item discounts</span>
              <b>−{lkr(model.itemDiscountCents)}</b>
            </div>
          )}
          {model.invoiceDiscountCents > 0 && (
            <div>
              <span>Invoice discount</span>
              <b>−{lkr(model.invoiceDiscountCents)}</b>
            </div>
          )}
          <div className="inv-grand">
            <span>GRAND TOTAL</span>
            <b>{lkr(model.totalCents)}</b>
          </div>
          <div>
            <span>Amount paid</span>
            <b>{lkr(model.paidCents)}</b>
          </div>
          <div className={`inv-out ${model.outstandingCents > 0 ? "due" : "clear"}`}>
            <span>Outstanding balance</span>
            <b>{lkr(model.outstandingCents)}</b>
          </div>
        </div>
      </section>

      {model.terms && (
        <section className="inv-terms">
          <span className="inv-label">Terms &amp; Conditions</span>
          <p>{model.terms}</p>
        </section>
      )}

      <section className="inv-signs">
        <span>Issued By / Authorized Signature</span>
        <span>Received By / Customer Signature</span>
      </section>

      <footer className="inv-foot">
        <span className="inv-leaf" aria-hidden="true" />
        <p>Thank you for your business · {b.name}</p>
      </footer>
    </article>
  );
}

/** High-contrast thermal receipt for 58mm / 80mm / custom roll printers. */
export function ThermalReceipt({
  model,
  settings,
}: {
  model: InvoiceModel;
  settings: ThermalSettings;
}) {
  const style = {
    width: `${settings.printableWidthMm}mm`,
    fontSize: `${settings.fontSizePx}px`,
  } as React.CSSProperties;
  const row = (label: string, value: string, strong = false) => (
    <div className={`rc-row${strong ? " strong" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div className="receipt" style={style}>
      <div className="rc-center">
        {settings.showLogo && <img src="/nugathalawa-logo.jpg" alt="" className="rc-logo" />}
        <div className="rc-biz">{model.business.name}</div>
        {model.business.address && <div>{model.business.address}</div>}
        {model.business.phone && <div>Tel: {model.business.phone}</div>}
      </div>
      <hr />
      <div className="rc-center strong">{model.cancelled ? "CANCELLED RECEIPT" : "SALES RECEIPT"}</div>
      <div>Invoice: {model.number}</div>
      <div>
        Date: {model.dateLabel}
        {model.timeLabel && ` ${model.timeLabel}`}
      </div>
      <div>Customer: {model.customer.shopName}</div>
      <hr />
      {model.lines.map((l) => (
        <div key={l.id} className="rc-item">
          <div className="strong">
            {l.description} {l.pack}
          </div>
          {row(`${l.quantity} x ${amount(l.unitCents)}`, amount(l.lineCents))}
          {l.discountCents > 0 && row("Discount", `-${amount(l.discountCents)}`)}
        </div>
      ))}
      <hr />
      {row("Subtotal", lkr(model.subtotalCents))}
      {model.itemDiscountCents > 0 && row("Item discounts", `-${lkr(model.itemDiscountCents)}`)}
      {model.invoiceDiscountCents > 0 && row("Invoice discount", `-${lkr(model.invoiceDiscountCents)}`)}
      {row("TOTAL", lkr(model.totalCents), true)}
      {row("Paid", lkr(model.paidCents))}
      {row("Balance", lkr(model.outstandingCents), true)}
      {model.paymentMethod && <div>Payment: {model.paymentMethod}</div>}
      <div className="rc-signs">
        <span>Issued by</span>
        <span>Received by</span>
      </div>
      <div className="rc-center">Thank you!</div>
    </div>
  );
}
