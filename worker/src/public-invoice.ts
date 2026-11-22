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
  const businessWa = (i.business_whatsapp || "0766965493").replace(/\D/g, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(i.number)} - ${escapeHtml(i.business_name || "Nugathalawa Ceylon Tea Export")}</title>
  <style>
    :root {
      --primary: #16a34a;
      --primary-dark: #15803d;
      --primary-lime: #84cc16;
      --gradient-brand: linear-gradient(90deg, #74c044 0%, #16a34a 100%);
      --bg-page: #f1f5f9;
      --text-main: #1f2937;
      --text-muted: #6b7280;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg-page);
      color: var(--text-main);
      line-height: 1.5;
    }

    /* Top Sticky Action Bar */
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
    .action-title { font-size: 14px; font-weight: 600; }
    .action-btns { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-green { background: #16a34a; color: #fff; }
    .btn-green:hover { background: #15803d; }
    .btn-dark { background: #374151; color: #fff; }
    .btn-dark:hover { background: #4b5563; }
    .btn-blue { background: #0284c7; color: #fff; }
    .btn-blue:hover { background: #0369a1; }

    /* A4 Document Canvas Container */
    .document-viewport {
      padding: 24px 16px 48px;
      display: flex;
      justify-content: center;
    }

    .a4-card {
      width: 210mm;
      min-height: 297mm;
      background: #ffffff;
      padding: 16mm 18mm 16mm 18mm;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
    }

    /* Header */
    .inv-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .brand-group {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .brand-title {
      font-size: 19px;
      font-weight: 800;
      color: #111827;
      line-height: 1.2;
    }
    .brand-tagline {
      font-size: 10.5px;
      font-weight: 700;
      color: #16a34a;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 2px;
    }
    .brand-sub {
      font-size: 10.5px;
      color: #6b7280;
      margin-top: 4px;
      line-height: 1.35;
    }

    .inv-heading-group {
      text-align: right;
    }
    .inv-main-heading {
      font-size: 34px;
      font-weight: 900;
      color: #16a34a;
      letter-spacing: 2px;
      line-height: 1;
    }
    .inv-meta-list {
      margin-top: 10px;
      font-size: 11.5px;
      line-height: 1.6;
      color: #374151;
    }

    /* Customer Info Block */
    .customer-block {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding: 10px 0 14px;
      border-top: 1px solid #f0fdf4;
      margin-bottom: 12px;
    }
    .inv-to-label {
      font-size: 12px;
      font-weight: 700;
      color: #16a34a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .customer-name {
      font-size: 17px;
      font-weight: 800;
      color: #111827;
      margin-top: 2px;
    }
    .customer-details {
      font-size: 11px;
      color: #4b5563;
      margin-top: 4px;
      line-height: 1.45;
    }

    /* Product Table */
    table.product-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
      margin-bottom: 18px;
    }
    table.product-table thead tr {
      background: var(--gradient-brand);
      color: #ffffff;
    }
    table.product-table th {
      padding: 9px 12px;
      font-weight: 700;
    }
    table.product-table th.left { text-align: left; }
    table.product-table th.right { text-align: right; }
    table.product-table th.center { text-align: center; }

    table.product-table tbody tr {
      border-bottom: 1px solid #f0fdf4;
    }
    table.product-table tbody tr:nth-child(even) {
      background: #f4fbf5;
    }
    table.product-table td {
      padding: 8px 12px;
      vertical-align: middle;
    }
    table.product-table td.right { text-align: right; }
    table.product-table td.center { text-align: center; }

    /* Summary Grid */
    .summary-grid {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 24px;
      align-items: flex-start;
      margin-top: 10px;
    }
    .contact-badges-wrap {
      position: relative;
      min-height: 140px;
    }
    .contact-badge-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      color: #4b5563;
      margin-bottom: 8px;
      position: relative;
      z-index: 1;
    }
    .badge-icon {
      width: 22px;
      height: 22px;
      background: #16a34a;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 11px;
      flex-shrink: 0;
    }

    /* Totals Box */
    .totals-box {
      font-size: 12px;
      line-height: 1.8;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      color: #4b5563;
    }
    .highlight-total-bar {
      background: var(--gradient-brand);
      color: #ffffff;
      padding: 8px 14px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 8px 0 12px;
      font-size: 14px;
      font-weight: 800;
    }
    .payment-info-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 11px;
    }
    .payment-info-title {
      font-weight: 700;
      color: #16a34a;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    /* Footer */
    .inv-footer {
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px solid #e5e7eb;
    }
    .terms-block {
      margin-bottom: 20px;
      font-size: 9.5px;
      color: #6b7280;
    }
    .signatures-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 16px;
      padding-top: 24px;
    }
    .signature-item {
      text-align: center;
      border-top: 1px dashed #9ca3af;
      padding-top: 6px;
      font-size: 10.5px;
      color: #4b5563;
      font-weight: 600;
    }

    /* Print CSS */
    @media print {
      @page {
        size: A4 portrait;
        margin: 0;
      }
      body {
        background: #ffffff;
        margin: 0;
      }
      .action-bar { display: none !important; }
      .document-viewport { padding: 0 !important; }
      .a4-card {
        box-shadow: none !important;
        width: 210mm !important;
        min-height: 297mm !important;
        padding: 15mm !important;
        page-break-after: avoid;
      }
    }
  </style>
</head>
<body>

  <!-- Top Action Navigation -->
  <div class="action-bar">
    <div class="action-title">
      ${escapeHtml(i.business_name || "Nugathalawa Ceylon Tea Export (Pvt) Ltd")} · Invoice #${escapeHtml(i.number)}
    </div>
    <div class="action-btns">
      <button class="btn btn-green" onclick="window.print()">
        🖨️ Print / Save PDF (A4)
      </button>
      <a class="btn btn-blue" href="https://wa.me/${businessWa}?text=Hello%20regarding%20invoice%20${encodeURIComponent(i.number)}" target="_blank" rel="noopener">
        💬 WhatsApp Inquiries
      </a>
    </div>
  </div>

  <!-- A4 Invoice Preview Container -->
  <div class="document-viewport">
    <div class="a4-card">

      <div>
        <!-- Header -->
        <header class="inv-header">
          <div class="brand-group">
            <svg width="52" height="52" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="leafG" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#15803d" />
                  <stop offset="50%" stop-color="#22c55e" />
                  <stop offset="100%" stop-color="#84cc16" />
                </linearGradient>
              </defs>
              <path d="M12 52C16 36 28 20 52 12C50 32 38 48 16 52Z" fill="url(#leafG)" />
              <path d="M20 48C24 38 32 28 46 22C44 34 36 44 24 48Z" fill="#84cc16" opacity="0.9" />
              <path d="M14 52C26 40 38 30 52 12" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.8" />
              <circle cx="44" cy="20" r="2.5" fill="#ffffff" opacity="0.9" />
            </svg>
            <div>
              <h1 class="brand-title">${escapeHtml(i.business_name || "Nugathalawa Ceylon Tea Export (Pvt) Ltd")}</h1>
              <div class="brand-tagline">Pure Ceylon Tea & Spices</div>
              <div class="brand-sub">
                ${escapeHtml(i.business_address || "Na Sewana, Hamangalla, Narangoda, Sri Lanka")}<br>
                P: ${escapeHtml(i.business_phone || "076 661 5492")} | W: ${escapeHtml(i.business_whatsapp || "076 696 5493")}
              </div>
            </div>
          </div>

          <div class="inv-heading-group">
            <div class="inv-main-heading">INVOICE</div>
            <div class="inv-meta-list">
              <div><b>Invoice No :</b> #${escapeHtml(i.number)}</div>
              <div><b>Invoice Date :</b> ${escapeHtml(i.created_at ? i.created_at.slice(0, 10) : "")}</div>
              ${i.due_at ? `<div><b style="color: #16a34a;">Due Date :</b> ${escapeHtml(i.due_at)}</div>` : ""}
            </div>
          </div>
        </header>

        <!-- Customer / Shop -->
        <div class="customer-block">
          <div>
            <div class="inv-to-label">Invoice to</div>
            <div class="customer-name">${escapeHtml(i.shop_name || "Valued Customer")}</div>
            <div class="customer-details">
              ${i.customer_phone ? `<div><b>P :</b> ${escapeHtml(i.customer_phone)}</div>` : ""}
              ${showCustomerWhatsapp && formattedCustomerPhone ? `<div><b style="color: #16a34a;">W :</b> ${escapeHtml(formattedCustomerPhone)}</div>` : ""}
              ${i.customer_address ? `<div><b>A :</b> ${escapeHtml(i.customer_address)}</div>` : ""}
            </div>
          </div>
        </div>

        <!-- Product Table -->
        <table class="product-table">
          <thead>
            <tr>
              <th class="left" style="border-top-left-radius: 6px; border-bottom-left-radius: 6px;">Product Description</th>
              <th class="right">Price</th>
              <th class="center">Qty.</th>
              ${showShopPrice ? '<th class="right">Shop Price</th>' : ""}
              <th class="right" style="border-top-right-radius: 6px; border-bottom-right-radius: 6px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (item) => `
              <tr>
                <td>
                  <div style="font-weight: 600; color: #111827;">${escapeHtml(item.product_name || item.name)}</div>
                  ${item.variant_label ? `<div style="font-size: 10px; color: #6b7280;">Pack Size: ${escapeHtml(item.variant_label)}</div>` : ""}
                </td>
                <td class="right">${formatMoney(item.unit_price_cents)}</td>
                <td class="center" style="font-weight: 600;">${item.quantity}</td>
                ${showShopPrice ? `<td class="right" style="color: #6b7280;">${item.shop_price_cents ? formatMoney(item.shop_price_cents) : "—"}</td>` : ""}
                <td class="right" style="font-weight: 700;">
                  ${formatMoney(item.line_cents)}
                  ${item.item_discount_cents ? `<div style="font-size: 9.5px; color: #dc2626; font-weight: normal;">- ${formatMoney(item.item_discount_cents)}</div>` : ""}
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>

        <!-- Summary & Totals -->
        <div class="summary-grid">
          <!-- Left: Contact badges & SVG Swoosh -->
          <div class="contact-badges-wrap">
            <div class="contact-badge-item">
              <span class="badge-icon">📞</span>
              <span>${escapeHtml(i.business_phone || "076 661 5492")}</span>
            </div>
            <div class="contact-badge-item">
              <span class="badge-icon">💬</span>
              <span>WhatsApp: ${escapeHtml(i.business_whatsapp || "076 696 5493")}</span>
            </div>
            <div class="contact-badge-item">
              <span class="badge-icon">📍</span>
              <span>${escapeHtml(i.business_address || "Na Sewana, Hamangalla, Narangoda, Sri Lanka")}</span>
            </div>

            <!-- Bottom Left Organic Green Curved Leaf Graphic matching Reference -->
            <svg width="220" height="140" viewBox="0 0 220 140" fill="none" xmlns="http://www.w3.org/2000/svg" style="position: absolute; bottom: 0; left: 0; pointer-events: none; z-index: 0;">
              <defs>
                <linearGradient id="s1" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#15803d" stop-opacity="0.95" />
                  <stop offset="60%" stop-color="#22c55e" stop-opacity="0.85" />
                  <stop offset="100%" stop-color="#84cc16" stop-opacity="0.4" />
                </linearGradient>
                <linearGradient id="s2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#84cc16" stop-opacity="0.8" />
                  <stop offset="100%" stop-color="#4ade80" stop-opacity="0.2" />
                </linearGradient>
              </defs>
              <path d="M0 140C40 130 90 100 130 60C170 20 200 0 220 0C160 30 90 70 0 110V140Z" fill="url(#s2)" />
              <path d="M0 140C50 140 100 120 140 80C175 45 195 20 200 0C150 40 80 85 0 95V140Z" fill="url(#s1)" />
            </svg>
          </div>

          <!-- Right: Totals Breakdown -->
          <div class="totals-box">
            <div class="total-row">
              <span>Subtotal</span>
              <b>${formatMoney(i.subtotal_cents)}</b>
            </div>
            ${
              totalDiscountCents > 0
                ? `<div class="total-row" style="color: #dc2626;">
                    <span>Discounts</span>
                    <b>- ${formatMoney(totalDiscountCents)}</b>
                  </div>`
                : ""
            }

            <div class="highlight-total-bar">
              <span>TOTAL</span>
              <span style="font-size: 16px;">${formatMoney(i.total_cents)}</span>
            </div>

            <div class="payment-info-card">
              <div class="payment-info-title">Payment Info:</div>
              <div style="display: flex; justify-content: space-between; margin: 2px 0;">
                <span style="color: #6b7280;">Method:</span>
                <b style="text-transform: capitalize;">${escapeHtml(i.payment_method)}</b>
              </div>
              <div style="display: flex; justify-content: space-between; margin: 2px 0;">
                <span style="color: #6b7280;">Paid Amount:</span>
                <b style="color: #16a34a;">${formatMoney(i.paid_cents || 0)}</b>
              </div>
              <div style="display: flex; justify-content: space-between; margin: 2px 0;">
                <span style="color: #6b7280;">Balance Due:</span>
                <b style="color: ${balanceCents > 0 ? "#dc2626" : "#16a34a"};">${formatMoney(balanceCents)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer: Terms & Dual Signatures -->
      <footer class="inv-footer">
        ${
          i.terms
            ? `<div class="terms-block">
                <div style="font-size: 11px; font-weight: 700; color: #16a34a; margin-bottom: 3px;">Terms & Conditions</div>
                <p>${escapeHtml(i.terms)}</p>
              </div>`
            : ""
        }
        <div class="signatures-row">
          <div class="signature-item">Issued By / Authorized Signature</div>
          <div class="signature-item">Received By / Customer Signature</div>
        </div>
      </footer>

    </div>
  </div>

</body>
</html>`;
}
