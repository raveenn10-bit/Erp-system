"use client";
import { useQuery } from "@tanstack/react-query";
import { Download, MessageCircle, Printer, ReceiptText, X } from "lucide-react";
import { api, money } from "@/lib/api";

type Detail = {
  invoice: {
    id: string;
    number: string;
    created_at: string;
    shop_name: string;
    address: string;
    whatsapp: string;
    business_name: string;
    business_address: string;
    business_phone: string;
    business_whatsapp?: string;
    business_email?: string;
    subtotal_cents: number;
    item_discount_cents: number;
    invoice_discount_cents: number;
    total_cents: number;
    paid_cents: number;
    due_at: string | null;
    payment_method: string;
    payment_terms: string;
    notes: string;
    terms: string;
    status: string;
  };
  items: Array<{
    id: string;
    name: string;
    label: string;
    quantity: number;
    unit_price_cents: number;
    shop_price_cents: number;
    item_discount_cents: number;
    line_cents: number;
    price_type: string;
  }>;
};

export function InvoiceActions({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<Detail>(`/invoices/${id}`),
  });
  const settings = useQuery({
    queryKey: ["billing-settings"],
    queryFn: () => api<Record<string, string>>("/billing/settings"),
  });
  const data = detail.data,
    showShop = settings.data?.invoice_show_shop_price === "true";
  async function download(thermal = false) {
    if (!data) return;
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: thermal ? [80, 220] : "a4" }),
      i = data.invoice,
      pageWidth = thermal ? 80 : 210,
      left = thermal ? 5 : 15,
      right = thermal ? 75 : 195;
    let y = thermal ? 9 : 15;
    pdf.setTextColor(0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(thermal ? 11 : 16);
    pdf.text(i.business_name, pageWidth / 2, y, { align: "center" });
    y += thermal ? 5 : 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(thermal ? 7 : 9);
    for (const text of [
      i.business_address,
      [i.business_phone, i.business_whatsapp, i.business_email]
        .filter(Boolean)
        .join(" · "),
    ]) {
      for (const line of pdf.splitTextToSize(text || "", right - left)) {
        pdf.text(line, pageWidth / 2, y, { align: "center" });
        y += 4;
      }
    }
    pdf.line(left, y, right, y);
    y += 7;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(thermal ? 10 : 14);
    pdf.text(thermal ? "SALES RECEIPT" : "SALES INVOICE", pageWidth / 2, y, {
      align: "center",
    });
    y += 7;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(thermal ? 8 : 9);
    for (const text of [
      `Invoice: ${i.number}`,
      `Date: ${i.created_at.slice(0, 10)}`,
      `Customer: ${i.shop_name}`,
      i.address ? `Address: ${i.address}` : "",
      `Payment: ${i.payment_method}`,
    ].filter(Boolean)) {
      for (const line of pdf.splitTextToSize(text, right - left)) {
        pdf.text(line, left, y);
        y += 4;
      }
    }
    y += 2;
    pdf.line(left, y, right, y);
    y += 5;
    for (const item of data.items) {
      pdf.setFont("helvetica", "bold");
      for (const line of pdf.splitTextToSize(
        `${item.name} · ${item.label}`,
        thermal ? 48 : 80,
      )) {
        pdf.text(line, left, y);
        y += 4;
      }
      pdf.setFont("helvetica", "normal");
      pdf.text(
        `${item.quantity} × ${(item.unit_price_cents / 100).toFixed(2)}  ${(item.line_cents / 100).toFixed(2)}`,
        right,
        y,
        { align: "right" },
      );
      if (showShop && item.shop_price_cents)
        pdf.text(
          `Shop price: ${(item.shop_price_cents / 100).toFixed(2)}`,
          left,
          y,
        );
      y += 5;
      if (item.item_discount_cents) {
        pdf.text(
          `Item discount: -${(item.item_discount_cents / 100).toFixed(2)}`,
          right,
          y,
          { align: "right" },
        );
        y += 4;
      }
      if (y > (thermal ? 190 : 255)) {
        pdf.addPage();
        y = 15;
      }
    }
    pdf.line(left, y, right, y);
    y += 6;
    const totals: [
      [string, number],
      [string, number],
      [string, number],
      [string, number],
      [string, number],
      [string, number],
    ] = [
      ["Subtotal", i.subtotal_cents],
      ["Item discounts", -i.item_discount_cents],
      ["Invoice discount", -i.invoice_discount_cents],
      ["Grand total", i.total_cents],
      ["Paid", i.paid_cents],
      ["Outstanding", i.total_cents - i.paid_cents],
    ];
    for (const [label, value] of totals) {
      if (label === "Grand total") pdf.setFont("helvetica", "bold");
      pdf.text(label, left, y);
      pdf.text((value / 100).toFixed(2), right, y, { align: "right" });
      pdf.setFont("helvetica", "normal");
      y += 5;
    }
    if (i.due_at) {
      pdf.text(`Due date: ${i.due_at}`, left, y);
      y += 5;
    }
    if (!thermal) {
      y = Math.max(y + 15, 235);
      pdf.line(15, y, 80, y);
      pdf.line(130, y, 195, y);
      pdf.text("Issued By / Authorized Signature", 15, y + 5);
      pdf.text("Received By / Customer Signature", 130, y + 5);
      y += 16;
      if (i.terms) {
        pdf.setFontSize(8);
        pdf.text(pdf.splitTextToSize(`Terms: ${i.terms}`, 180), 15, y);
      }
    } else {
      y += 12;
      pdf.line(5, y, 34, y);
      pdf.line(46, y, 75, y);
      pdf.setFontSize(6);
      pdf.text("Issued By", 19.5, y + 4, { align: "center" });
      pdf.text("Received By", 60.5, y + 4, { align: "center" });
    }
    pdf.save(`${i.number}-${thermal ? "80mm" : "A4"}.pdf`);
  }
  function share() {
    if (!data) return;
    const i = data.invoice,
      phone = (i.whatsapp || i.business_whatsapp || "")
        .replace(/\D/g, "")
        .replace(/^0/, "94"),
      message = `*${i.business_name}*\n*Invoice:* ${i.number}\n*Customer:* ${i.shop_name}\n*Total:* ${money(i.total_cents)}\n*Paid:* ${money(i.paid_cents)}\n*Outstanding:* ${money(i.total_cents - i.paid_cents)}${i.due_at ? `\n*Due:* ${i.due_at}` : ""}`;
    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div
        className="dialog-card document-sheet invoice-sheet"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="secondary document-close" onClick={close}>
          <X size={16} />
          Close
        </button>
        {detail.isLoading ? (
          <div className="loader" />
        ) : detail.isError ? (
          <div className="error">Could not load invoice.</div>
        ) : (
          data && (
            <>
              <header className="invoice-doc-head">
                <h2>{data.invoice.business_name}</h2>
                <p>{data.invoice.business_address}</p>
                <p>
                  {[
                    data.invoice.business_phone,
                    data.invoice.business_whatsapp,
                    data.invoice.business_email,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <strong>SALES INVOICE</strong>
              </header>
              <div className="invoice-meta">
                <div>
                  <b>Invoice</b>
                  <span>{data.invoice.number}</span>
                  <b>Date</b>
                  <span>{data.invoice.created_at.slice(0, 10)}</span>
                </div>
                <div>
                  <b>Bill to</b>
                  <span>{data.invoice.shop_name}</span>
                  <span>{data.invoice.address}</span>
                  <span>Payment: {data.invoice.payment_method}</span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Price type</th>
                      <th>Unit</th>
                      {showShop && <th>Shop price</th>}
                      <th>Discount</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((x) => (
                      <tr key={x.id}>
                        <td>
                          {x.name} · {x.label}
                        </td>
                        <td>{x.quantity}</td>
                        <td>{x.price_type}</td>
                        <td>{money(x.unit_price_cents)}</td>
                        {showShop && (
                          <td>
                            {x.shop_price_cents
                              ? money(x.shop_price_cents)
                              : "—"}
                          </td>
                        )}
                        <td>{money(x.item_discount_cents)}</td>
                        <td>{money(x.line_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="invoice-doc-totals">
                <span>Subtotal</span>
                <b>{money(data.invoice.subtotal_cents)}</b>
                <span>Total discount</span>
                <b>
                  -{" "}
                  {money(
                    data.invoice.item_discount_cents +
                      data.invoice.invoice_discount_cents,
                  )}
                </b>
                <span>Grand total</span>
                <b>{money(data.invoice.total_cents)}</b>
                <span>Paid</span>
                <b>{money(data.invoice.paid_cents)}</b>
                <span>Outstanding</span>
                <b>
                  {money(data.invoice.total_cents - data.invoice.paid_cents)}
                </b>
                {data.invoice.due_at && (
                  <>
                    <span>Due date</span>
                    <b>{data.invoice.due_at}</b>
                  </>
                )}
              </div>
              {data.invoice.notes && (
                <p>
                  <b>Notes:</b> {data.invoice.notes}
                </p>
              )}
              {data.invoice.terms && (
                <p className="invoice-terms">
                  <b>Terms:</b> {data.invoice.terms}
                </p>
              )}
              <div className="signature-grid">
                <span>Issued By / Authorized Signature</span>
                <span>Received By / Customer Signature</span>
              </div>
              <div className="form-actions">
                <button className="primary" onClick={() => download(false)}>
                  <Download size={16} />
                  A4 PDF
                </button>
                <button className="secondary" onClick={() => download(true)}>
                  <ReceiptText size={16} />
                  80mm receipt
                </button>
                <button className="secondary" onClick={() => window.print()}>
                  <Printer size={16} />
                  Print
                </button>
                <button className="secondary" onClick={share}>
                  <MessageCircle size={16} />
                  WhatsApp
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
