"use client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileDown,
  MessageCircle,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api, formatWhatsApp, idempotency, money, normalizeWhatsApp } from "@/lib/api";
import { isNative, printDocumentSheet, publicOrigin, savePdfDoc, toast } from "@/lib/native";

export type Product = {
  variant_id: string;
  name: string;
  label: string;
  unit: string;
  wholesale_cents: number;
  retail_cents: number;
  shop_price_cents: number;
};
export type Customer = {
  id: string;
  shop_name: string;
  address?: string;
  phone?: string;
  credit_days: number;
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
type ActiveRoute={id:string;route_name:string;route_date:string;registration_number:string;stock_warehouse_id:string;status:string};
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const cents = (value: number) =>
  Math.max(0, Math.round((Number(value) || 0) * 100));
const percent = (base: number, value: number) =>
  Math.round((base * Math.min(Math.max(value, 0), 100)) / 100);
const warehouses = (stocks: Stock[]) => [
  ...new Map(stocks.map((s) => [s.warehouse_id, s.warehouse])).entries(),
];

/** After a sale/issue was saved offline (PENDING SYNC), clear the form like a normal post. */
function resetLinesOffline(setLines: (f: (l: Line[]) => Line[]) => void) {
  setLines((l) => l.slice(0, 1).map((x) => ({ ...x, variantId: "", quantity: 1 })));
}

export function BillingSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["billing-settings"],
    queryFn: () => api<Record<string, string>>("/billing/settings"),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!settings.data) return <div className="loader" />;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await api("/billing/settings", {
        method: "PATCH",
        body: JSON.stringify({
          showShopPrice: d.get("showShopPrice") === "on",
          defaultTerms: String(d.get("defaultTerms") || ""),
        }),
      });
      await client.invalidateQueries({ queryKey: ["billing-settings"] });
      setMessage("Billing settings saved.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} key={settings.data.invoice_show_shop_price}>
      <div className="form-grid">
        <label className="check-field">
          <input
            type="checkbox"
            name="showShopPrice"
            defaultChecked={settings.data.invoice_show_shop_price === "true"}
          />
          <span>Show Shop Selling Price on printed invoices</span>
        </label>
        <label className="span-2">
          Default invoice terms
          <textarea
            name="defaultTerms"
            defaultValue={settings.data.invoice_default_terms}
          />
        </label>
      </div>
      {message && <p className="muted">{message}</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          Save billing settings
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
    }),
    activeRoutes = useQuery({queryKey:["daily-routes"],queryFn:()=>api<ActiveRoute[]>("/daily-routes")});
  const [customerId, setCustomer] = useState(""),
    [routeId,setRouteId]=useState(""),
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
  const routeDetail=useQuery({queryKey:["route-detail",routeId],queryFn:()=>api<any>(`/daily-routes/${routeId}`),enabled:!!routeId});
  const routeCustomerIds=useMemo(()=>new Set((routeDetail.data?.shops||[]).map((x:any)=>x.customer_id)),[routeDetail.data]);
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
      warehouseId,
      routeId: routeId || undefined,
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
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
      const origin = publicOrigin();
      const invoiceLink = result.shareToken
        ? `${origin}/view/invoice/${result.shareToken}`
        : `${origin}/dashboard`;

      const message = `Hello,\n\nYour invoice from Nugathalawa Ceylon Tea Export (Pvt) Ltd is ready.\n\nInvoice No: ${result.number}\nShop: ${shopName}\nTotal: ${totalStr}\nPaid: ${paidStr}\nBalance: ${balanceStr}\n\nView / Download Invoice:\n${invoiceLink}\n\nThank you!`;

      // Android app: don't send the public link (that page renders unstyled on the
      // production Worker). The invoice sheet opens next with "Send PDF on WhatsApp".
      if (!isNative()) {
        window.open(
          `https://wa.me/${normNumber}?text=${encodeURIComponent(message)}`,
          "_blank",
          "noopener,noreferrer"
        );
      }

      onPosted(result.id);
    } catch (e) {
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
    await savePdfDoc(pdf, `DRAFT-INVOICE-${invoiceDate}.pdf`);
  }

  function loadDraft(d: any) {
    const p = JSON.parse(d.payload_json);
    setDraftId(d.id);
    setCustomer(p.customerId);
    setWarehouse(p.warehouseId);
    setRouteId(p.routeId||"");
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
            Daily route (optional)
            <select value={routeId} onChange={(e)=>{const id=e.target.value;setRouteId(id);const route=activeRoutes.data?.find(r=>r.id===id);if(route)setWarehouse(route.stock_warehouse_id)}}>
              <option value="">Non-route invoice</option>
              {(activeRoutes.data||[]).filter(r=>r.status==="In Progress").map(r=><option key={r.id} value={r.id}>{r.route_name} · {r.registration_number}</option>)}
            </select>
          </label>
          <label>
            Customer / Shop
            <select
              value={customerId}
              onChange={(e) => setCustomer(e.target.value)}
              required
            >
              <option value="">Select a shop</option>
              {(routeId?customers.filter(c=>routeCustomerIds.has(c.id)):customers).map((c) => (
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
              disabled={!!routeId}
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
        {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
        <div className="form-actions">
          <button
            className="secondary"
            disabled={busy || !customerId}
            onClick={saveDraft}
          >
            <FileDown size={16} />
            Save draft
          </button>
          <button
            className="primary"
            disabled={busy || !customerId || !lines.some((x) => x.variantId)}
            onClick={post}
          >
            Finalize invoice
          </button>
          {draftId && (
            <button className="secondary" onClick={() => setDraftId(null)}>
              <RotateCcw size={16} />
              New invoice
            </button>
          )}
        </div>
      </div>
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
    }),activeRoutes=useQuery({queryKey:["daily-routes"],queryFn:()=>api<ActiveRoute[]>("/daily-routes")}),
    [customerId, setCustomer] = useState(""),
    [routeId,setRouteId]=useState(""),
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
  const routeDetail=useQuery({queryKey:["route-detail",routeId],queryFn:()=>api<any>(`/daily-routes/${routeId}`),enabled:!!routeId});
  const routeCustomerIds=useMemo(()=>new Set((routeDetail.data?.shops||[]).map((x:any)=>x.customer_id)),[routeDetail.data]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await api<{ id: string }>("/free-issues", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          warehouseId,
          routeId: routeId || undefined,
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
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
            <label>Daily route (optional)<select value={routeId} onChange={e=>{const id=e.target.value;setRouteId(id);const route=activeRoutes.data?.find(r=>r.id===id);if(route)setWarehouse(route.stock_warehouse_id)}}><option value="">Non-route issue</option>{(activeRoutes.data||[]).filter(r=>r.status==="In Progress").map(r=><option key={r.id} value={r.id}>{r.route_name} · {r.registration_number}</option>)}</select></label>
            <label>
              Shop
              <select
                required
                value={customerId}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Select shop</option>
                {(routeId?customers.filter(c=>routeCustomerIds.has(c.id)):customers).map((c) => (
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
                disabled={!!routeId}
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
          {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
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
    }),activeRoutes=useQuery({queryKey:["daily-routes"],queryFn:()=>api<ActiveRoute[]>("/daily-routes")}),
    [selected, setSelected] = useState<string | null>(null),
    detail = useQuery({
      queryKey: ["consignment", selected],
      queryFn: () => api<any>(`/consignments/${selected}`),
      enabled: !!selected,
    }),
    [customerId, setCustomer] = useState(""),
    [routeId,setRouteId]=useState(""),
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
  const routeDetailForIssue=useQuery({queryKey:["route-detail",routeId],queryFn:()=>api<any>(`/daily-routes/${routeId}`),enabled:!!routeId});
  const routeCustomerIds=useMemo(()=>new Set((routeDetailForIssue.data?.shops||[]).map((x:any)=>x.customer_id)),[routeDetailForIssue.data]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api<{ id: string }>("/consignments", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          warehouseId,
          routeId: routeId || undefined,
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
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
      if ((e as Error)?.name === "OfflineQueuedError") { toast((e as Error).message); resetLinesOffline(setLines); } else { setError((e as Error).message); toast((e as Error).message); }
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
            <label>Daily route (optional)<select value={routeId} onChange={e=>{const id=e.target.value;setRouteId(id);const route=activeRoutes.data?.find(r=>r.id===id);if(route)setWarehouse(route.stock_warehouse_id)}}><option value="">Non-route consignment</option>{(activeRoutes.data||[]).filter(r=>r.status==="In Progress").map(r=><option key={r.id} value={r.id}>{r.route_name} · {r.registration_number}</option>)}</select></label>
            <label>
              Shop
              <select
                required
                value={customerId}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Select shop</option>
                {(routeId?customers.filter(c=>routeCustomerIds.has(c.id)):customers).map((c) => (
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
                disabled={!!routeId}
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
          {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
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
              {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
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
              {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
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
  await savePdfDoc(pdf, `${data.record.reference_number}-${thermal ? "80mm" : "A4"}.pdf`);
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
      <button className="secondary" onClick={(e) => printDocumentSheet(e.currentTarget, title)}>
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
