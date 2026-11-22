"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { InvoicePreviewModal, InvoiceViewData } from "@/components/invoice-designer";

type Detail = {
  invoice: {
    id: string;
    number: string;
    created_at: string;
    shop_name: string;
    address: string;
    whatsapp: string;
    customer_phone?: string;
    customer_whatsapp?: string;
    share_token?: string;
    business_name: string;
    business_address: string;
    business_phone: string;
    business_whatsapp?: string;
    business_email?: string;
    rep_name?: string;
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
    sku?: string;
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
  initialTab = "a4",
}: {
  id: string;
  close: () => void;
  initialTab?: "a4" | "thermal";
}) {
  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<Detail>(`/invoices/${id}`),
  });

  if (detail.isLoading) {
    return (
      <div className="dialog-backdrop" onMouseDown={close}>
        <div className="dialog-card" style={{ padding: 40, textAlign: "center" }}>
          <div className="loader" />
          <p style={{ marginTop: 12, color: "#6b7280" }}>Loading invoice details...</p>
        </div>
      </div>
    );
  }

  if (detail.isError || !detail.data?.invoice) {
    return (
      <div className="dialog-backdrop" onMouseDown={close}>
        <div className="dialog-card" style={{ padding: 32, textAlign: "center" }}>
          <div className="error">Could not load invoice #{id}.</div>
          <button className="secondary" onClick={close} style={{ marginTop: 16 }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const { invoice, items } = detail.data;

  const invoiceViewData: InvoiceViewData = {
    number: invoice.number,
    invoiceDate: invoice.created_at ? invoice.created_at.slice(0, 10) : "",
    dueAt: invoice.due_at,
    shopName: invoice.shop_name,
    customerPhone: invoice.customer_phone || invoice.whatsapp || "",
    customerWhatsapp: invoice.customer_whatsapp || invoice.whatsapp || "",
    customerAddress: invoice.address,
    repName: invoice.rep_name,
    businessName: invoice.business_name || "Nugathalawa Ceylon Tea Export (Pvt) Ltd",
    businessAddress: invoice.business_address || "Na Sewana, Hamangalla, Narangoda, Sri Lanka",
    businessPhone: invoice.business_phone || "076 661 5492",
    businessWhatsapp: invoice.business_whatsapp || "076 696 5493",
    businessEmail: invoice.business_email,
    paymentMethod: invoice.payment_method || "cash",
    paymentTerms: invoice.payment_terms,
    notes: invoice.notes,
    terms: invoice.terms,
    subtotalCents: invoice.subtotal_cents,
    itemDiscountCents: invoice.item_discount_cents || 0,
    invoiceDiscountCents: invoice.invoice_discount_cents || 0,
    totalCents: invoice.total_cents,
    paidCents: invoice.paid_cents || 0,
    shareToken: invoice.share_token,
    items: items.map((x) => ({
      id: x.id,
      name: x.name,
      variantLabel: x.label,
      sku: x.sku,
      quantity: x.quantity,
      unitPriceCents: x.unit_price_cents,
      shopPriceCents: x.shop_price_cents,
      itemDiscountCents: x.item_discount_cents,
      lineCents: x.line_cents,
      priceType: x.price_type,
    })),
  };

  return (
    <InvoicePreviewModal
      data={invoiceViewData}
      invoiceId={invoice.id}
      onClose={close}
      initialTab={initialTab}
    />
  );
}
