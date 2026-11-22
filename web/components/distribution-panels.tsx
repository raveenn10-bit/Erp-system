"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  FileDown,
  MessageCircle,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { api, formatWhatsApp, idempotency, money, normalizeWhatsApp } from "@/lib/api";
import { InvoicePreviewModal, InvoiceViewData } from "./invoice-designer";
import { saveThermalSettings } from "@/lib/thermal-printer";

export type Product = {
  variant_id: string;
  name: string;
  label: string;
  unit: string;
  sku?: string;
  wholesale_cents: number;
  retail_cents: number;
  shop_price_cents: number;
};
export type Customer = {
  id: string;
  shop_name: string;
  address?: string;
  phone?: string;
  whatsapp?: string;
  credit_days: number;
  owner_name?: string;
  credit_limit_cents?: number;
};
export type Stock = {
  warehouse_id: string;
  warehouse: string;
  variant_id: string;
  quantity: number;
};
type Line = {
  variantId: string;
  quantity: number;
  priceType: "wholesale" | "retail" | "shop";
  discountType: "fixed" | "percent";
  discountValue: number;
};
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const cents = (value: number) =>
  Math.max(0, Math.round((Number(value) || 0) * 100));
const percent = (base: number, value: number) =>
  Math.round((base * Math.min(Math.max(value, 0), 100)) / 100);
const warehouses = (stocks: Stock[]) => [
  ...new Map(stocks.map((s) => [s.warehouse_id, s.warehouse])).entries(),
];

export function BillingSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["billing-settings"],
    queryFn: () => api<Record<string, string>>("/billing/settings"),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paperWidth, setPaperWidth] = useState<string>("58mm");

  useEffect(() => {
    if (settings.data?.thermal_paper_width) {
      setPaperWidth(settings.data.thermal_paper_width);
    }
  }, [settings.data]);

  if (!settings.data) return <div className="loader" />;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        showShopPrice: d.get("showShopPrice") === "on",
        showCustomerWhatsapp: d.get("showCustomerWhatsapp") === "on",
        defaultTerms: String(d.get("defaultTerms") || ""),
        accentColor: String(d.get("accentColor") || "#16a34a"),
        thermalPrinterName: String(d.get("thermalPrinterName") || "Bluetooth Thermal POS"),
        thermalPaperWidth: String(d.get("thermalPaperWidth") || "58mm") as any,
        thermalCustomWidthMm: Number(d.get("thermalCustomWidthMm") || 58),
        thermalFontSize: String(d.get("thermalFontSize") || "normal") as any,
        thermalTextDensity: String(d.get("thermalTextDensity") || "normal") as any,
        thermalShowLogo: d.get("thermalShowLogo") === "on",
        thermalShowQr: d.get("thermalShowQr") === "on",
        thermalAutoCut: d.get("thermalAutoCut") === "on",
        thermalCopies: Number(d.get("thermalCopies") || 1),
        thermalDefaultMode: String(d.get("thermalDefaultMode") || "browser") as any,
        whatsappTemplate: String(d.get("whatsappTemplate") || ""),
      };

      await api("/billing/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      // Also persist to local thermal printer cache
      saveThermalSettings({
        printerName: payload.thermalPrinterName,
        paperWidth: payload.thermalPaperWidth,
        customWidthMm: payload.thermalCustomWidthMm,
        fontSize: payload.thermalFontSize,
        textDensity: payload.thermalTextDensity,
        showLogo: payload.thermalShowLogo,
        showQr: payload.thermalShowQr,
        autoCut: payload.thermalAutoCut,
        copies: payload.thermalCopies,
        defaultMode: payload.thermalDefaultMode,
      });

      await client.invalidateQueries({ queryKey: ["billing-settings"] });
      setMessage("Invoice & Printing settings saved successfully.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = settings.data;

  return (
    <form onSubmit={save} key={s.invoice_show_shop_price || "settings"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Section 1: A4 Professional Invoice Options */}
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h4 style={{ margin: "0 0 12px", color: "#16a34a", fontSize: 14, fontWeight: 700 }}>
            A4 Professional Invoice Layout
          </h4>
          <div className="form-grid">
            <label className="check-field">
              <input
                type="checkbox"
                name="showShopPrice"
                defaultChecked={s.invoice_show_shop_price === "true"}
              />
              <span>Show Shop Selling Price column</span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                name="showCustomerWhatsapp"
                defaultChecked={s.invoice_show_customer_whatsapp !== "false"}
              />
              <span>Display Customer WhatsApp number</span>
            </label>
            <label>
              Primary Accent Color
              <select name="accentColor" defaultValue={s.invoice_accent_color || "#16a34a"}>
                <option value="#16a34a">Ceylon Tea Emerald (#16a34a)</option>
                <option value="#15803d">Deep Forest Green (#15803d)</option>
                <option value="#65a30d">Lime Tea Green (#65a30d)</option>
                <option value="#0284c7">Sapphire Blue (#0284c7)</option>
              </select>
            </label>
            <label className="span-2">
              Default Invoice Terms & Conditions
              <textarea
                name="defaultTerms"
                rows={2}
                defaultValue={s.invoice_default_terms}
              />
            </label>
          </div>
        </div>

        {/* Section 2: Bluetooth & POS Thermal Receipt Options */}
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h4 style={{ margin: "0 0 12px", color: "#16a34a", fontSize: 14, fontWeight: 700 }}>
            Bluetooth & Thermal Receipt Settings (කුඩා බිල්පත)
          </h4>
          <div className="form-grid">
            <label>
              Printer Profile Name
              <input
                type="text"
                name="thermalPrinterName"
                defaultValue={s.thermal_printer_name || "Bluetooth Thermal POS"}
              />
            </label>
            <label>
              Paper Width Preset
              <select
                name="thermalPaperWidth"
                value={paperWidth}
                onChange={(e) => setPaperWidth(e.target.value)}
              >
                <option value="58mm">58mm (Portable / Handheld Bluetooth)</option>
                <option value="80mm">80mm (Desktop POS Receipt)</option>
                <option value="custom">Custom Width</option>
              </select>
            </label>

            {paperWidth === "custom" && (
              <label>
                Custom Width (mm)
                <input
                  type="number"
                  name="thermalCustomWidthMm"
                  min="40"
                  max="120"
                  defaultValue={Number(s.thermal_custom_width_mm || 58)}
                />
              </label>
            )}

            <label>
              Font Size
              <select name="thermalFontSize" defaultValue={s.thermal_font_size || "normal"}>
                <option value="small">Small (Compact)</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
              </select>
            </label>

            <label>
              Text Density
              <select name="thermalTextDensity" defaultValue={s.thermal_text_density || "normal"}>
                <option value="normal">Normal</option>
                <option value="high">High Contrast (Bold / Double-Strike)</option>
              </select>
            </label>

            <label>
              Default Print Mode
              <select name="thermalDefaultMode" defaultValue={s.thermal_default_mode || "browser"}>
                <option value="browser">Browser Print Fallback (Universal)</option>
                <option value="bluetooth">Web Bluetooth API (Direct)</option>
              </select>
            </label>

            <label>
              Number of Copies
              <select name="thermalCopies" defaultValue={s.thermal_copies || "1"}>
                <option value="1">1 Copy</option>
                <option value="2">2 Copies (Customer + Office)</option>
              </select>
            </label>

            <div className="span-2" style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "6px 0" }}>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="thermalShowLogo"
                  defaultChecked={s.thermal_show_logo !== "false"}
                />
                <span>Print Leaf Logo on receipt</span>
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="thermalShowQr"
                  defaultChecked={s.thermal_show_qr !== "false"}
                />
                <span>Print Verification Link on receipt</span>
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="thermalAutoCut"
                  defaultChecked={s.thermal_auto_cut === "true"}
                />
                <span>Auto Paper Cut (ESC/POS)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Section 3: WhatsApp Invoice Message Template */}
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h4 style={{ margin: "0 0 12px", color: "#16a34a", fontSize: 14, fontWeight: 700 }}>
            WhatsApp Invoice Message Template
          </h4>
          <label className="span-2">
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Available placeholders: <code>{"{invoice_number}"}</code>, <code>{"{shop_name}"}</code>, <code>{"{total}"}</code>, <code>{"{paid}"}</code>, <code>{"{balance}"}</code>, <code>{"{invoice_link}"}</code>
            </span>
            <textarea
              name="whatsappTemplate"
              rows={4}
              defaultValue={
                s.whatsapp_invoice_template ||
                "Hello,\n\nYour invoice from Nugathalawa Ceylon Tea Export (Pvt) Ltd is ready.\n\nInvoice No: {invoice_number}\nShop: {shop_name}\nTotal: LKR {total}\nPaid: LKR {paid}\nBalance: LKR {balance}\n\nView / Download Invoice:\n{invoice_link}\n\nThank you!"
              }
              style={{ marginTop: 6 }}
            />
          </label>
        </div>
      </div>

      {message && (
        <p
          style={{
            marginTop: 12,
            padding: "8px 14px",
            borderRadius: 6,
            background: message.includes("success") ? "#f0fdf4" : "#fef2f2",
            color: message.includes("success") ? "#166534" : "#b91c1c",
            fontSize: 13,
          }}
        >
          {message}
        </p>
      )}

      <div className="form-actions" style={{ marginTop: 16 }}>
        <button className="primary" disabled={busy} style={{ background: "#16a34a" }}>
          Save Invoice & Printing Settings
        </button>
      </div>
    </form>
  );
}

function ProductLines({
  lines,
  setLines,
  products,
  mode = "billing",
}: {
  lines: Line[];
  setLines: (x: Line[]) => void;
  products: Product[];
  mode?: "billing" | "quantity" | "consignment";
}) {
  return (
    <div className="line-editor">
      <div className="line-editor-head">
        <strong>Products</strong>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setLines([
              ...lines,
              {
                variantId: "",
                quantity: 1,
                priceType: "wholesale",
                discountType: "fixed",
                discountValue: 0,
              },
            ])
          }
        >
          <Plus size={15} />
          Add product
        </button>
      </div>
      {lines.map((line, index) => {
        const product = products.find((p) => p.variant_id === line.variantId);
        return (
          <div className="line-row" key={index}>
            <label>
              Product / Pack
              <select
                value={line.variantId}
                required
                onChange={(e) =>
                  setLines(
                    lines.map((x, i) =>
                      i === index ? { ...x, variantId: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="">Select product</option>
                {products.map((p) => (
                  <option key={p.variant_id} value={p.variant_id}>
                    {p.name} · {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Qty
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) =>
                  setLines(
                    lines.map((x, i) =>
                      i === index
                        ? { ...x, quantity: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
            </label>
            {mode === "billing" && (
              <>
                <label>
                  Price
                  <select
                    value={line.priceType}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, i) =>
                          i === index
                            ? {
                                ...x,
                                priceType: e.target.value as Line["priceType"],
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="wholesale">Wholesale</option>
                    <option value="retail">Retail / MRP</option>
                    <option value="shop">Shop selling</option>
                  </select>
                </label>
                <label>
                  Item discount
                  <select
                    value={line.discountType}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, i) =>
                          i === index
                            ? {
                                ...x,
                                discountType: e.target
                                  .value as Line["discountType"],
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="fixed">LKR</option>
                    <option value="percent">%</option>
                  </select>
                </label>
                <label>
                  Value
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.discountValue}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, i) =>
                          i === index
                            ? { ...x, discountValue: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              </>
            )}
            {mode === "consignment" && (
              <label>
                Agreed unit price (LKR)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.discountValue}
                  onChange={(e) =>
                    setLines(
                      lines.map((x, i) =>
                        i === index
                          ? { ...x, discountValue: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
              </label>
            )}
            <div className="line-summary">
              {product
                ? `${product.name} · ${product.label}`
                : "Select a product"}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove line"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
            >
              <Trash2 size={17} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function BillingPanel({
  customers,
  products,
  stocks,
  onPosted,
}: {
  customers: Customer[];
  products: Product[];
  stocks: Stock[];
  onPosted: (id: string) => void;
}) {
  const client = useQueryClient(),
    drafts = useQuery({
      queryKey: ["invoice-drafts"],
      queryFn: () => api<any[]>("/invoice-drafts"),
    }),
    settings = useQuery({
      queryKey: ["billing-settings"],
      queryFn: () => api<Record<string, string>>("/billing/settings"),
    });
  const [customerId, setCustomer] = useState(""),
    [customerWhatsapp, setCustomerWhatsapp] = useState(""),
    [showLivePreview, setShowLivePreview] = useState(false),
    [warehouseId, setWarehouse] = useState("main"),
    [invoiceDate, setInvoiceDate] = useState(today()),
    [lines, setLines] = useState<Line[]>([
      {
        variantId: "",
        quantity: 1,
        priceType: "wholesale",
        discountType: "fixed",
        discountValue: 0,
      },
    ]),
    [invoiceDiscountType, setInvoiceDiscountType] = useState<
      "fixed" | "percent"
    >("fixed"),
    [invoiceDiscountValue, setInvoiceDiscountValue] = useState(0),
    [amountPaid, setAmountPaid] = useState(0),
    [paymentMethod, setPaymentMethod] = useState("cash"),
    [paymentTerms, setPaymentTerms] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [notes, setNotes] = useState(""),
    [terms, setTerms] = useState(""),
    [draftId, setDraftId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const totals = useMemo(() => {
    let subtotal = 0,
      itemDiscount = 0;
    for (const line of lines) {
      const p = products.find((x) => x.variant_id === line.variantId);
      if (!p) continue;
      const unit =
        line.priceType === "retail"
          ? p.retail_cents
          : line.priceType === "shop"
            ? p.shop_price_cents
            : p.wholesale_cents;
      const gross = unit * line.quantity;
      subtotal += gross;
      itemDiscount +=
        line.discountType === "percent"
          ? percent(gross, line.discountValue)
          : Math.min(gross, cents(line.discountValue));
    }
    const afterItems = Math.max(0, subtotal - itemDiscount),
      invoiceDiscount =
        invoiceDiscountType === "percent"
          ? percent(afterItems, invoiceDiscountValue)
          : Math.min(afterItems, cents(invoiceDiscountValue));
    return {
      subtotal,
      itemDiscount,
      invoiceDiscount,
      total: afterItems - invoiceDiscount,
    };
  }, [lines, products, invoiceDiscountType, invoiceDiscountValue]);
  function payload(includePayment = true) {
    return {
      customerId,
      customerWhatsapp: customerWhatsapp ? normalizeWhatsApp(customerWhatsapp) : undefined,
      warehouseId,
      invoiceDate,
      items: lines
        .filter((x) => x.variantId)
        .map((x) => ({
          variantId: x.variantId,
          quantity: x.quantity,
          priceType: x.priceType,
          discount:
            x.discountValue > 0
              ? {
                  type: x.discountType,
                  value:
                    x.discountType === "percent"
                      ? Math.round(x.discountValue * 100)
                      : cents(x.discountValue),
                }
              : undefined,
        })),
      invoiceDiscount:
        invoiceDiscountValue > 0
          ? {
              type: invoiceDiscountType,
              value:
                invoiceDiscountType === "percent"
                  ? Math.round(invoiceDiscountValue * 100)
                  : cents(invoiceDiscountValue),
            }
          : undefined,
      paymentMethod,
      paymentTerms,
      dueAt: dueAt || null,
      notes,
      terms: terms || settings.data?.invoice_default_terms || "",
      ...(includePayment
        ? {
            amountPaidCents: cents(amountPaid),
            idempotencyKey: idempotency(),
            draftId: draftId || undefined,
          }
        : {}),
    };
  }
  async function saveDraft() {
    setBusy(true);
    setError("");
    try {
      await api(draftId ? `/invoice-drafts/${draftId}` : "/invoice-drafts", {
        method: draftId ? "PATCH" : "POST",
        body: JSON.stringify(payload(false)),
      });
      await client.invalidateQueries({ queryKey: ["invoice-drafts"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function post() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/billing/invoices", {
        method: "POST",
        body: JSON.stringify(payload(true)),
      });
      await client.invalidateQueries();
      onPosted(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function postAndSendWhatsApp() {
    setBusy(true);
    setError("");
    try {
      const normNumber = normalizeWhatsApp(customerWhatsapp);
      if (!normNumber) {
        throw new Error("Please enter a valid Customer WhatsApp number (e.g. 077 123 4567)");
      }
      const p = payload(true);
      const result = await api<{
        id: string;
        number: string;
        totalCents: number;
        paidCents: number;
        dueAt: string | null;
        shareToken: string;
      }>("/billing/invoices", {
        method: "POST",
        body: JSON.stringify(p),
      });
      await client.invalidateQueries();

      const cust = customers.find((x) => x.id === customerId);
      const shopName = cust?.shop_name || "Valued Customer";
      const totalStr = money(result.totalCents);
      const paidStr = money(result.paidCents);
      const balanceStr = money(Math.max(0, result.totalCents - result.paidCents));
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const invoiceLink = result.shareToken
        ? `${origin}/view/invoice/${result.shareToken}`
        : `${origin}/dashboard`;

      const message = `Hello,\n\nYour invoice from Nugathalawa Ceylon Tea Export (Pvt) Ltd is ready.\n\nInvoice No: ${result.number}\nShop: ${shopName}\nTotal: ${totalStr}\nPaid: ${paidStr}\nBalance: ${balanceStr}\n\nView / Download Invoice:\n${invoiceLink}\n\nThank you!`;

      window.open(
        `https://wa.me/${normNumber}?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener,noreferrer"
      );

      onPosted(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadDraftPdf() {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const cust = customers.find((x) => x.id === customerId);
    let y = 15;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("NUGATHALAWA CEYLON TEA EXPORT (PVT) LTD", 105, y, { align: "center" });
    y += 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text("Na Sewana, Hamangalla, Narangoda, Sri Lanka", 105, y, { align: "center" });
    y += 5;
    pdf.text("Tel: 076 661 5492 · WhatsApp: 076 696 5493", 105, y, { align: "center" });
    y += 6;
    pdf.line(15, y, 195, y);
    y += 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("SALES INVOICE (DRAFT PREVIEW)", 105, y, { align: "center" });
    y += 8;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Date: ${invoiceDate}`, 15, y);
    pdf.text(`Customer: ${cust?.shop_name || "Not selected"}`, 15, y + 5);
    if (customerWhatsapp) {
      pdf.text(`WhatsApp: ${formatWhatsApp(customerWhatsapp)}`, 15, y + 10);
      y += 5;
    }
    y += 10;
    pdf.line(15, y, 195, y);
    y += 6;
    for (const l of lines.filter((x) => x.variantId)) {
      const p = products.find((x) => x.variant_id === l.variantId);
      if (!p) continue;
      const unit = l.priceType === "retail" ? p.retail_cents : l.priceType === "shop" ? p.shop_price_cents : p.wholesale_cents;
      const lineTotalVal = (unit * l.quantity) / 100;
      pdf.setFont("helvetica", "bold");
      pdf.text(`${p.name} · ${p.label}`, 15, y);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${l.quantity} × ${(unit / 100).toFixed(2)}  ${lineTotalVal.toFixed(2)}`, 195, y, { align: "right" });
      y += 6;
    }
    pdf.line(15, y, 195, y);
    y += 8;
    pdf.text(`Subtotal: ${(totals.subtotal / 100).toFixed(2)}`, 195, y, { align: "right" });
    y += 5;
    pdf.setFont("helvetica", "bold");
    pdf.text(`Grand Total: ${(totals.total / 100).toFixed(2)}`, 195, y, { align: "right" });
    pdf.save(`DRAFT-INVOICE-${invoiceDate}.pdf`);
  }

  function loadDraft(d: any) {
    const p = JSON.parse(d.payload_json);
    setDraftId(d.id);
    setCustomer(p.customerId);
    if (p.customerWhatsapp || d.customer_whatsapp) {
      setCustomerWhatsapp(p.customerWhatsapp || d.customer_whatsapp || "");
    }
    setWarehouse(p.warehouseId);
    setInvoiceDate(p.invoiceDate);
    setLines(
      (p.items || []).map((x: any) => ({
        ...x,
        discountType: x.discount?.type || "fixed",
        discountValue: x.discount
          ? x.discount.type === "percent"
            ? x.discount.value / 100
            : x.discount.value / 100
          : 0,
      })),
    );
    setPaymentMethod(p.paymentMethod);
    setPaymentTerms(p.paymentTerms || "");
    setDueAt(p.dueAt || "");
    setNotes(p.notes || "");
    setTerms(p.terms || "");
    setInvoiceDiscountType(p.invoiceDiscount?.type || "fixed");
    setInvoiceDiscountValue(
      p.invoiceDiscount
        ? p.invoiceDiscount.type === "percent"
          ? p.invoiceDiscount.value / 100
          : p.invoiceDiscount.value / 100
        : 0,
    );
  }

  const selectedCust = customers.find((x) => x.id === customerId);
  const draftInvoiceData: InvoiceViewData = {
    number: draftId ? `DRAFT-${draftId.slice(0, 6)}` : `INV-PREVIEW`,
    invoiceDate: invoiceDate || today(),
    dueAt: dueAt || null,
    shopName: selectedCust?.shop_name || "Valued Customer",
    customerPhone: selectedCust?.phone,
    customerWhatsapp: customerWhatsapp || selectedCust?.whatsapp,
    customerAddress: selectedCust?.address,
    businessName: "Nugathalawa Ceylon Tea Export (Pvt) Ltd",
    businessAddress: "Na Sewana, Hamangalla, Narangoda, Sri Lanka",
    businessPhone: "076 661 5492",
    businessWhatsapp: "076 696 5493",
    paymentMethod,
    paymentTerms,
    notes,
    terms: terms || settings.data?.invoice_default_terms,
    subtotalCents: totals.subtotal,
    itemDiscountCents: totals.itemDiscount,
    invoiceDiscountCents: totals.invoiceDiscount,
    totalCents: totals.total,
    paidCents: cents(amountPaid),
    items: lines
      .filter((l) => l.variantId)
      .map((l) => {
        const p = products.find((x) => x.variant_id === l.variantId);
        const unit =
          l.priceType === "retail"
            ? p?.retail_cents || 0
            : l.priceType === "shop"
              ? p?.shop_price_cents || 0
              : p?.wholesale_cents || 0;
        const gross = unit * l.quantity;
        const itemDisc =
          l.discountType === "percent"
            ? percent(gross, l.discountValue)
            : Math.min(gross, cents(l.discountValue));
        return {
          name: p?.name || "Product",
          variantLabel: p?.label,
          sku: p?.sku,
          quantity: l.quantity,
          unitPriceCents: unit,
          shopPriceCents: p?.shop_price_cents,
          itemDiscountCents: itemDisc,
          lineCents: gross - itemDisc,
          priceType: l.priceType,
        };
      }),
  };

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>Professional invoice</h3>
            <span className="muted">
              Live totals are recalculated and validated again by the server.
            </span>
          </div>
          {draftId && <span className="badge">Editing draft</span>}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-grid">
          <label>
            Customer / Shop
            <select
              value={customerId}
              onChange={(e) => {
                const id = e.target.value;
                setCustomer(id);
                const c = customers.find((x) => x.id === id);
                if (c) {
                  setCustomerWhatsapp(c.whatsapp || c.phone || "");
                }
              }}
              required
            >
              <option value="">Select a shop</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shop_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer WhatsApp Number
            <input
              type="tel"
              value={customerWhatsapp}
              onChange={(e) => setCustomerWhatsapp(e.target.value)}
              placeholder="077 123 4567 or +94771234567"
            />
          </label>
          <label>
            Stock location
            <select
              value={warehouseId}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              {warehouses(stocks).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
              {!stocks.length && <option value="main">Main warehouse</option>}
            </select>
          </label>
          <label>
            Invoice date
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </label>
          <label>
            Payment method
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="credit">Credit sale</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <ProductLines lines={lines} setLines={setLines} products={products} />
        <div className="form-grid">
          <label>
            Invoice discount type
            <select
              value={invoiceDiscountType}
              onChange={(e) => setInvoiceDiscountType(e.target.value as any)}
            >
              <option value="fixed">Fixed LKR</option>
              <option value="percent">Percentage</option>
            </select>
          </label>
          <label>
            Invoice discount
            <input
              type="number"
              min="0"
              step="0.01"
              value={invoiceDiscountValue}
              onChange={(e) => setInvoiceDiscountValue(Number(e.target.value))}
            />
          </label>
          <label>
            Amount paid (LKR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => setAmountPaid(Number(e.target.value))}
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <label>
            Payment terms
            <input
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="30 days / cash on delivery"
            />
          </label>
          <label>
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="span-2">
            Terms & conditions
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={settings.data?.invoice_default_terms}
            />
          </label>
        </div>
        <div className="invoice-preview">
          <div>
            <span>Subtotal</span>
            <strong>{money(totals.subtotal)}</strong>
          </div>
          <div>
            <span>Item discounts</span>
            <strong>- {money(totals.itemDiscount)}</strong>
          </div>
          <div>
            <span>Invoice discount</span>
            <strong>- {money(totals.invoiceDiscount)}</strong>
          </div>
          <div className="grand">
            <span>Grand total</span>
            <strong>{money(totals.total)}</strong>
          </div>
          <div>
            <span>Outstanding</span>
            <strong>
              {money(Math.max(0, totals.total - cents(amountPaid)))}
            </strong>
          </div>
        </div>
        <div className="form-actions" style={{ flexWrap: "wrap", gap: "8px" }}>
          <button
            type="button"
            className="secondary"
            disabled={!customerId || !lines.some((x) => x.variantId)}
            onClick={() => setShowLivePreview(true)}
            style={{ color: "#16a34a", borderColor: "#86efac", fontWeight: 600 }}
          >
            <Eye size={16} />
            Preview Invoice / බිල්පත පෙරදසුන
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !customerId}
            onClick={saveDraft}
          >
            <FileDown size={16} />
            Save Draft
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !customerId || !lines.some((x) => x.variantId)}
            onClick={post}
          >
            <Check size={16} />
            Finalize Invoice
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !customerId || !lines.some((x) => x.variantId)}
            onClick={postAndSendWhatsApp}
            style={{ background: "#16a34a", color: "#fff" }}
          >
            <MessageCircle size={16} />
            Save & Send WhatsApp
          </button>
          {draftId && (
            <button className="secondary" onClick={() => setDraftId(null)}>
              <RotateCcw size={16} />
              New Invoice
            </button>
          )}
        </div>
      </div>

      {showLivePreview && (
        <InvoicePreviewModal
          data={draftInvoiceData}
          onClose={() => setShowLivePreview(false)}
        />
      )}
      {!!drafts.data?.length && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <h3>Saved drafts</h3>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Shop</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {drafts.data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.invoice_date}</td>
                    <td>{d.shop_name}</td>
                    <td>{d.updated_at.slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => loadDraft(d)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

type Issue = {
  id: string;
  reference_number: string;
  issue_date: string;
  shop_name: string;
  rep_name: string;
  total_quantity: number;
  reason: string;
  status: string;
};
export function FreeIssuePanel({
  customers,
  products,
  stocks,
}: {
  customers: Customer[];
  products: Product[];
  stocks: Stock[];
}) {
  const client = useQueryClient(),
    history = useQuery({
      queryKey: ["free-issues"],
      queryFn: () => api<Issue[]>("/free-issues"),
    }),
    [customerId, setCustomer] = useState(""),
    [warehouseId, setWarehouse] = useState("main"),
    [reason, setReason] = useState("sample"),
    [notes, setNotes] = useState(""),
    [issuedBy, setIssuedBy] = useState(""),
    [receivedBy, setReceivedBy] = useState(""),
    [lines, setLines] = useState<Line[]>([
      {
        variantId: "",
        quantity: 1,
        priceType: "wholesale",
        discountType: "fixed",
        discountValue: 0,
      },
    ]),
    [error, setError] = useState(""),
    [documentId, setDocumentId] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await api<{ id: string }>("/free-issues", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          warehouseId,
          issueDate: today(),
          reason,
          notes,
          issuedBy,
          receivedBy,
          items: lines
            .filter((x) => x.variantId)
            .map((x) => ({ variantId: x.variantId, quantity: x.quantity })),
          idempotencyKey: idempotency(),
          status: "confirmed",
        }),
      });
      await client.invalidateQueries({ queryKey: ["free-issues"] });
      setDocumentId(result.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      {documentId && (
        <DistributionDocument
          kind="free"
          id={documentId}
          close={() => setDocumentId(null)}
        />
      )}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>Create Free Issue Note</h3>
            <span className="muted">
              LKR 0 customer charge. Confirming deducts stock only.
            </span>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <form onSubmit={create}>
          <div className="form-grid">
            <label>
              Shop
              <select
                required
                value={customerId}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Select shop</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shop_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stock location
              <select
                value={warehouseId}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                {warehouses(stocks).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {["sample", "promotion", "trial", "replacement", "other"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Issued by
              <input
                required
                value={issuedBy}
                onChange={(e) => setIssuedBy(e.target.value)}
              />
            </label>
            <label>
              Received by
              <input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
              />
            </label>
            <label>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          <ProductLines
            mode="quantity"
            lines={lines}
            setLines={setLines}
            products={products}
          />
          <div className="form-actions">
            <button className="primary">Confirm free issue</button>
          </div>
        </form>
      </div>
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Free issue history</h3>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Date</th>
                <th>Shop</th>
                <th>Rep</th>
                <th>Qty</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((x) => (
                <tr key={x.id}>
                  <td>
                    <button
                      className="link-button"
                      onClick={() => setDocumentId(x.id)}
                    >
                      {x.reference_number}
                    </button>
                  </td>
                  <td>{x.issue_date}</td>
                  <td>{x.shop_name}</td>
                  <td>{x.rep_name}</td>
                  <td>{x.total_quantity}</td>
                  <td>{x.reason}</td>
                  <td>
                    <span className="badge">{x.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

type Consignment = {
  id: string;
  reference_number: string;
  issue_date: string;
  shop_name: string;
  issued_quantity: number;
  sold_quantity: number;
  returned_quantity: number;
  damaged_quantity: number;
  remaining_quantity: number;
  status: string;
};
export function ConsignmentPanel({
  customers,
  products,
  stocks,
  onInvoice,
}: {
  customers: Customer[];
  products: Product[];
  stocks: Stock[];
  onInvoice: (id: string) => void;
}) {
  const client = useQueryClient(),
    history = useQuery({
      queryKey: ["consignments"],
      queryFn: () => api<Consignment[]>("/consignments"),
    }),
    [selected, setSelected] = useState<string | null>(null),
    detail = useQuery({
      queryKey: ["consignment", selected],
      queryFn: () => api<any>(`/consignments/${selected}`),
      enabled: !!selected,
    }),
    [customerId, setCustomer] = useState(""),
    [warehouseId, setWarehouse] = useState("main"),
    [expected, setExpected] = useState(""),
    [notes, setNotes] = useState(""),
    [issuedBy, setIssuedBy] = useState(""),
    [receivedBy, setReceivedBy] = useState(""),
    [lines, setLines] = useState<Line[]>([
      {
        variantId: "",
        quantity: 1,
        priceType: "wholesale",
        discountType: "fixed",
        discountValue: 0,
      },
    ]),
    [error, setError] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api<{ id: string }>("/consignments", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          warehouseId,
          issueDate: today(),
          expectedSettlementDate: expected || null,
          notes,
          issuedBy,
          receivedBy,
          items: lines
            .filter((x) => x.variantId)
            .map((x) => ({
              variantId: x.variantId,
              quantity: x.quantity,
              agreedUnitPriceCents: cents(x.discountValue),
            })),
          idempotencyKey: idempotency(),
        }),
      });
      await client.invalidateQueries({ queryKey: ["consignments"] });
      setSelected(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function settle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const d = Object.fromEntries(new FormData(e.currentTarget));
    const item = detail.data.items.find((x: any) => x.id === d.itemId);
    try {
      const r = await api<{ invoiceId: string }>(
        `/consignments/${selected}/settlements`,
        {
          method: "POST",
          body: JSON.stringify({
            settlementDate: today(),
            items: [
              { consignmentItemId: d.itemId, quantity: Number(d.quantity) },
            ],
            amountPaidCents: cents(Number(d.amountPaid)),
            paymentMethod: d.paymentMethod,
            paymentTerms: "Consignment settlement",
            notes: "",
            terms: "",
            idempotencyKey: idempotency(),
          }),
        },
      );
      await client.invalidateQueries();
      onInvoice(r.invoiceId);
    } catch (e) {
      setError((e as Error).message);
    }
    void item;
  }
  async function returned(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/consignments/${selected}/returns`, {
        method: "POST",
        body: JSON.stringify({
          returnDate: today(),
          condition: d.condition,
          reason: d.reason,
          receivedBy: d.receivedBy,
          items: [
            { consignmentItemId: d.itemId, quantity: Number(d.quantity) },
          ],
          idempotencyKey: idempotency(),
        }),
      });
      await client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      {selected && detail.data && (
        <ConsignmentDocument
          data={detail.data}
          close={() => setSelected(null)}
        />
      )}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>Consignment / Sale or Return</h3>
            <span className="muted">
              Stock is held at the shop without immediate revenue or debt.
            </span>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <form onSubmit={create}>
          <div className="form-grid">
            <label>
              Shop
              <select
                required
                value={customerId}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Select shop</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shop_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stock location
              <select
                value={warehouseId}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                {warehouses(stocks).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expected settlement
              <input
                type="date"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </label>
            <label>
              Issued / handed over by
              <input
                required
                value={issuedBy}
                onChange={(e) => setIssuedBy(e.target.value)}
              />
            </label>
            <label>
              Received by
              <input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
              />
            </label>
            <label>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          <ProductLines
            mode="consignment"
            lines={lines}
            setLines={setLines}
            products={products}
          />
          <div className="form-actions">
            <button className="primary">Create delivery note</button>
          </div>
        </form>
      </div>
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Consignment tracking</h3>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Shop</th>
                <th>Issued</th>
                <th>Sold</th>
                <th>Returned</th>
                <th>Damaged</th>
                <th>Remaining</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((x) => (
                <tr key={x.id}>
                  <td>
                    <button
                      className="link-button"
                      onClick={() => setSelected(x.id)}
                    >
                      {x.reference_number}
                    </button>
                  </td>
                  <td>{x.shop_name}</td>
                  <td>{x.issued_quantity}</td>
                  <td>{x.sold_quantity}</td>
                  <td>{x.returned_quantity}</td>
                  <td>{x.damaged_quantity}</td>
                  <td>{x.remaining_quantity}</td>
                  <td>
                    <span className="badge">{x.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selected && detail.data && (
        <div className="distribution-actions">
          <div className="panel">
            <h3>Settle sold quantity</h3>
            <form onSubmit={settle}>
              <label>
                Product
                <select name="itemId">
                  {detail.data.items
                    .filter((x: any) => x.remaining_quantity > 0)
                    .map((x: any) => (
                      <option value={x.id} key={x.id}>
                        {x.name} · {x.label} ({x.remaining_quantity} remaining)
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Sold quantity
                <input name="quantity" type="number" min="1" required />
              </label>
              <label>
                Amount paid (LKR)
                <input
                  name="amountPaid"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
              </label>
              <label>
                Payment method
                <select name="paymentMethod">
                  <option value="credit">Credit</option>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="primary">Generate sales invoice</button>
              </div>
            </form>
          </div>
          <div className="panel">
            <h3>Return consignment stock</h3>
            <form onSubmit={returned}>
              <label>
                Product
                <select name="itemId">
                  {detail.data.items
                    .filter((x: any) => x.remaining_quantity > 0)
                    .map((x: any) => (
                      <option value={x.id} key={x.id}>
                        {x.name} · {x.label} ({x.remaining_quantity} remaining)
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantity
                <input name="quantity" type="number" min="1" required />
              </label>
              <label>
                Condition
                <select name="condition">
                  <option value="saleable">Saleable</option>
                  <option value="damaged">Damaged</option>
                  <option value="expired">Expired</option>
                </select>
              </label>
              <label>
                Return reason
                <input name="reason" />
              </label>
              <label>
                Received by
                <input name="receivedBy" required />
              </label>
              <div className="form-actions">
                <button className="primary">Record return</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function docText(data: any, title: string) {
  const r = data.record;
  return `${r.business_name}\n${title}\nReference: ${r.reference_number}\nDate: ${r.issue_date || r.return_date || r.settlement_date}\nShop: ${r.shop_name}\n${data.items.map((x: any) => `${x.name} ${x.label} × ${x.quantity || x.issued_quantity || x.sold_quantity}`).join("\n")}`;
}
async function pdfDocument(data: any, title: string, thermal = false) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: thermal ? [80, 200] : "a4" });
  const width = thermal ? 70 : 180;
  let y = 12;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(thermal ? 11 : 16);
  pdf.text(data.record.business_name, thermal ? 40 : 105, y, {
    align: "center",
  });
  y += 8;
  pdf.setFontSize(thermal ? 10 : 14);
  pdf.text(title, thermal ? 40 : 105, y, { align: "center" });
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const lines = pdf.splitTextToSize(
    docText(data, "").split("\n").slice(2).join("\n"),
    width,
  );
  pdf.text(lines, thermal ? 5 : 15, y);
  y += lines.length * 5 + 8;
  pdf.line(thermal ? 5 : 15, y, thermal ? 75 : 195, y);
  y += 12;
  pdf.text("Issued / Handed Over By", thermal ? 5 : 15, y);
  if (!thermal) pdf.text("Received By", 130, y);
  y += 14;
  pdf.line(thermal ? 5 : 15, y, thermal ? 70 : 75, y);
  if (!thermal) pdf.line(130, y, 195, y);
  pdf.save(`${data.record.reference_number}-${thermal ? "80mm" : "A4"}.pdf`);
}
function shareDoc(data: any, title: string) {
  const phone = String(
    data.record.whatsapp || data.record.business_whatsapp || "",
  )
    .replace(/\D/g, "")
    .replace(/^0/, "94");
  window.open(
    `https://wa.me/${phone}?text=${encodeURIComponent(docText(data, title))}`,
    "_blank",
    "noopener,noreferrer",
  );
}
function DocumentActions({ data, title }: { data: any; title: string }) {
  return (
    <div className="form-actions">
      <button className="primary" onClick={() => pdfDocument(data, title)}>
        <FileDown size={16} />
        A4 PDF
      </button>
      <button
        className="secondary"
        onClick={() => pdfDocument(data, title, true)}
      >
        <Printer size={16} />
        80mm
      </button>
      <button className="secondary" onClick={() => window.print()}>
        <Printer size={16} />
        Print
      </button>
      <button className="secondary" onClick={() => shareDoc(data, title)}>
        <MessageCircle size={16} />
        WhatsApp
      </button>
    </div>
  );
}
function DistributionDocument({
  kind,
  id,
  close,
}: {
  kind: "free";
  id: string;
  close: () => void;
}) {
  const detail = useQuery({
    queryKey: [kind, id],
    queryFn: () => api<any>(`/free-issues/${id}`),
  });
  if (!detail.data) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div
        className="dialog-card document-sheet"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="secondary document-close" onClick={close}>
          Close
        </button>
        <h2>{detail.data.record.business_name}</h2>
        <h3>FREE ISSUE NOTE</h3>
        <pre>{docText(detail.data, "FREE ISSUE NOTE")}</pre>
        <div className="signature-grid">
          <span>Issued By / Authorized Signature</span>
          <span>Received By / Customer Signature</span>
        </div>
        <DocumentActions data={detail.data} title="FREE ISSUE NOTE" />
      </div>
    </div>
  );
}
function ConsignmentDocument({
  data,
  close,
}: {
  data: any;
  close: () => void;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div
        className="dialog-card document-sheet"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="secondary document-close" onClick={close}>
          Close
        </button>
        <h2>{data.record.business_name}</h2>
        <h3>CONSIGNMENT DELIVERY NOTE</h3>
        <pre>{docText(data, "CONSIGNMENT DELIVERY NOTE")}</pre>
        <div className="signature-grid">
          <span>Issued / Handed Over By</span>
          <span>Received By</span>
        </div>
        <DocumentActions data={data} title="CONSIGNMENT DELIVERY NOTE" />
      </div>
    </div>
  );
}
