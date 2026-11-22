import { formatWhatsApp } from "./finance";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderPublicInvoiceHtml(data: {
  invoice: any;
  items: any[];
  showShopPrice: boolean;
  showCustomerWhatsapp: boolean;
}): string {
  const { invoice: i, items, showShopPrice, showCustomerWhatsapp } = data;
  const balanceCents = Math.max(0, i.total_cents - i.paid_cents);
  const totalDiscountCents = (i.item_discount_cents || 0) + (i.invoice_discount_cents || 0);
  const formattedCustomerPhone = formatWhatsApp(i.customer_whatsapp || i.whatsapp || "");
  const businessWa = (i.business_whatsapp || "").replace(/\D/g, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(i.number)} - ${escapeHtml(i.business_name)}</title>
  <style>
    :root {
      --primary: #1b4332;
      --primary-light: #2d6a4f;
      --text-main: #1f2937;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --bg: #f9fafb;
      --card-bg: #ffffff;
      --gold: #d97706;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding-bottom: 40px;
    }
    .action-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #111827;
      color: #fff;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
    }
    .action-title { font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }
    .action-btns { display: flex; gap: 10px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-primary { background: #10b981; color: #fff; }
    .btn-primary:hover { background: #059669; }
    .btn-secondary { background: #374151; color: #fff; }
    .btn-secondary:hover { background: #4b5563; }
    .page-wrap {
      max-width: 820px;
      margin: 24px auto;
      padding: 0 16px;
    }
    .invoice-card {
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
      padding: 36px 40px;
    }
    .brand-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .brand-name {
      font-size: 20px;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .brand-tagline {
      font-size: 12px;
      font-weight: 600;
      color: var(--gold);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .brand-contact {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .doc-badge {
      text-align: right;
    }
    .doc-badge h1 {
      font-size: 24px;
      font-weight: 800;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .doc-badge .inv-num {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-main);
      margin-top: 4px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 28px;
    }
    .meta-block {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .meta-block h3 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 4px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .meta-row b { color: var(--text-main); }
    .table-wrap {
      width: 100%;
      overflow-x: auto;
      margin-bottom: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 10px 12px;
      border-bottom: 2px solid var(--border);
    }
    th.num, td.num { text-align: right; }
    td {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #fafbfc; }
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 28px;
    }
    .totals-box {
      width: 320px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .tot-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 16px;
      font-size: 13px;
      border-bottom: 1px solid #f1f5f9;
    }
    .tot-row.grand {
      background: var(--primary);
      color: #fff;
      font-size: 15px;
      font-weight: 800;
      border-bottom: none;
    }
    .tot-row.grand b { color: #fff; }
    .tot-row.balance {
      background: #fef2f2;
      color: #991b1b;
      font-weight: 700;
    }
    .notes-box {
      background: #f8fafc;
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 14px 18px;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 28px;
    }
    .notes-box b { color: var(--text-main); }
    .sig-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 60px;
      margin-top: 45px;
      padding-top: 20px;
    }
    .sig-box {
      text-align: center;
      border-top: 1px solid #94a3b8;
      padding-top: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }
    .auth-footer {
      text-align: center;
      margin-top: 30px;
      font-size: 11px;
      color: #94a3b8;
    }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff !important; padding: 0 !important; }
      .page-wrap { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
      .invoice-card {
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
      }
      @page { size: A4 portrait; margin: 12mm; }
    }
    @media (max-width: 640px) {
      .invoice-card { padding: 20px 16px; }
      .brand-header { flex-direction: column; gap: 12px; }
      .doc-badge { text-align: left; }
      .meta-grid { grid-template-columns: 1fr; gap: 12px; }
      .totals-box { width: 100%; }
      .sig-section { gap: 30px; }
    }
  </style>
</head>
<body>
  <div class="action-bar no-print">
    <div class="action-title">Nugathalawa Ceylon Tea — Official Invoice</div>
    <div class="action-btns">
      ${businessWa ? `<a class="btn btn-secondary" href="https://wa.me/${businessWa}" target="_blank" rel="noopener">WhatsApp Us</a>` : ""}
      <button class="btn btn-primary" onclick="window.print()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
        Print / Save PDF
      </button>
    </div>
  </div>

  <div class="page-wrap">
    <div class="invoice-card">
      <header class="brand-header">
        <div>
          <div class="brand-name">${escapeHtml(i.business_name)}</div>
          <div class="brand-tagline">Pure Ceylon Tea · Premium Quality</div>
          <div class="brand-contact">
            ${escapeHtml(i.business_address)}<br>
            ${[i.business_phone ? `Tel: ${escapeHtml(i.business_phone)}` : "", i.business_whatsapp ? `WhatsApp: ${escapeHtml(i.business_whatsapp)}` : "", i.business_email ? escapeHtml(i.business_email) : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div class="doc-badge">
          <h1>Sales Invoice</h1>
          <div class="inv-num">${escapeHtml(i.number)}</div>
        </div>
      </header>

      <div class="meta-grid">
        <div class="meta-block">
          <h3>Bill To (Customer / Shop)</h3>
          <div class="meta-row"><span>Shop Name:</span> <b>${escapeHtml(i.shop_name)}</b></div>
          ${i.owner_name ? `<div class="meta-row"><span>Owner:</span> <b>${escapeHtml(i.owner_name)}</b></div>` : ""}
          ${i.customer_address ? `<div class="meta-row"><span>Address:</span> <span>${escapeHtml(i.customer_address)}</span></div>` : ""}
          ${showCustomerWhatsapp && formattedCustomerPhone ? `<div class="meta-row"><span>WhatsApp:</span> <b>${escapeHtml(formattedCustomerPhone)}</b></div>` : ""}
        </div>
        <div class="meta-block">
          <h3>Invoice Details</h3>
          <div class="meta-row"><span>Invoice Date:</span> <b>${escapeHtml(i.created_at ? i.created_at.slice(0, 10) : "")}</b></div>
          <div class="meta-row"><span>Payment Method:</span> <b style="text-transform: capitalize;">${escapeHtml(i.payment_method || "Cash")}</b></div>
          ${i.due_at ? `<div class="meta-row"><span>Due Date:</span> <b style="color: #b91c1c;">${escapeHtml(i.due_at)}</b></div>` : ""}
          <div class="meta-row"><span>Status:</span> <b>${balanceCents === 0 ? "Fully Paid" : i.paid_cents > 0 ? "Partially Paid" : "Payment Pending"}</b></div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product &amp; Variant</th>
              <th class="num">Qty</th>
              <th>Price Type</th>
              <th class="num">Unit Price</th>
              ${showShopPrice ? `<th class="num">Shop Price</th>` : ""}
              <th class="num">Discount</th>
              <th class="num">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><b>${escapeHtml(item.product_name)}</b> <span style="color:var(--text-muted);">(${escapeHtml(item.variant_label)})</span></td>
                <td class="num"><b>${item.quantity}</b> ${escapeHtml(item.unit || "unit")}</td>
                <td style="text-transform: capitalize;">${escapeHtml(item.price_type || "wholesale")}</td>
                <td class="num">${formatMoney(item.unit_price_cents)}</td>
                ${showShopPrice ? `<td class="num">${item.shop_price_cents ? formatMoney(item.shop_price_cents) : "—"}</td>` : ""}
                <td class="num">${item.item_discount_cents ? `- ${formatMoney(item.item_discount_cents)}` : "—"}</td>
                <td class="num"><b>${formatMoney(item.line_cents)}</b></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="totals-wrap">
        <div class="totals-box">
          <div class="tot-row"><span>Subtotal:</span> <b>${formatMoney(i.subtotal_cents || i.total_cents)}</b></div>
          ${totalDiscountCents > 0 ? `<div class="tot-row" style="color:#b91c1c;"><span>Total Discounts:</span> <b>- ${formatMoney(totalDiscountCents)}</b></div>` : ""}
          <div class="tot-row grand"><span>Grand Total:</span> <b>${formatMoney(i.total_cents)}</b></div>
          <div class="tot-row"><span>Amount Paid:</span> <b>${formatMoney(i.paid_cents || 0)}</b></div>
          <div class="tot-row balance"><span>Balance Due:</span> <b>${formatMoney(balanceCents)}</b></div>
        </div>
      </div>

      ${(i.notes || i.terms) ? `
        <div class="notes-box">
          ${i.notes ? `<p><b>Notes:</b> ${escapeHtml(i.notes)}</p>` : ""}
          ${i.terms ? `<p style="margin-top: 4px;"><b>Terms &amp; Conditions:</b> ${escapeHtml(i.terms)}</p>` : ""}
        </div>
      ` : ""}

      <div class="sig-section">
        <div class="sig-box">Issued By / Authorized Signature</div>
        <div class="sig-box">Received By / Customer Signature</div>
      </div>

      <div class="auth-footer">
        ✓ Verified Authenticity · Nugathalawa Ceylon Tea Export (Pvt) Ltd Official Invoice
      </div>
    </div>
  </div>
</body>
</html>`;
}
