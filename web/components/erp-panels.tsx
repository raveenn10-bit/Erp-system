"use client";
import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, ArrowLeft, Building2, CreditCard, FileText, Gift, PackageCheck,
  AlertTriangle, CheckCircle, TrendingUp, TrendingDown, Download,
  Wallet, ReceiptText, RotateCcw, Plus, Minus, ChevronRight,
  History, User, Phone, MapPin, Calendar, DollarSign,
} from "lucide-react";
import { api, idempotency, money } from "@/lib/api";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
type AccountSummary = {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  creditLimit: number;
  availableCredit: number;
};
type LedgerEntry = {
  date: string;
  type: string;
  ref: string;
  debit: number;
  credit: number;
  balance: number;
  note: string;
};
type CustomerAccount = {
  customer: Record<string, unknown>;
  summary: AccountSummary;
  ledger: LedgerEntry[];
  invoices: Array<{id:string;number:string;total_cents:number;paid_cents:number;status:string;due_at:string|null;created_at:string}>;
  payments: Array<{id:string;amount_cents:number;method:string;notes:string;created_at:string;invoice_number:string}>;
  freeIssues: Array<{id:string;created_at:string;items:string;notes:string}>;
  consignments: Array<{id:string;created_at:string;status:string;items:string}>;
  creditNotes: Array<{id:string;number:string;total_cents:number;reason:string;created_at:string}>;
};
type Expense = {
  id: string;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  method: string;
  reference: string;
  created_by_name: string;
};
type Invoice = {
  id: string;
  number: string;
  total_cents: number;
  paid_cents: number;
  status: string;
  shop_name?: string;
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function Badge({ text, variant = "default" }: { text: string; variant?: "default"|"success"|"danger"|"warning" }) {
  const colors: Record<string, string> = {
    default: "var(--surface-raised)",
    success: "var(--success-soft)",
    danger: "var(--danger-soft)",
    warning: "var(--warning-soft)",
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 10px",
      borderRadius: 99, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      background: colors[variant], color: "inherit",
    }}>{text}</span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "24px 0 10px", fontWeight: 700, fontSize: 14, color: "var(--brand-primary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div style={{
      background: alert ? "var(--danger-soft)" : "var(--surface-raised)",
      border: `1.5px solid ${alert ? "var(--danger-line)" : "var(--border)"}`,
      borderRadius: 12, padding: "14px 18px", minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: alert ? "var(--danger)" : "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: alert ? "var(--danger)" : "var(--brand-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER ACCOUNT MODAL
// ═══════════════════════════════════════════════════════════════
export function CustomerAccountModal({
  customerId,
  onClose,
  onViewInvoice,
}: {
  customerId: string;
  onClose: () => void;
  onViewInvoice: (id: string) => void;
}) {
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<"ledger"|"invoices"|"payments"|"freeissues"|"consignments">("ledger");
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payNotes, setPayNotes] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [flash, setFlash] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("");
  const [editCreditDays, setEditCreditDays] = useState("");

  const account = useQuery<CustomerAccount>({
    queryKey: ["customer-account", customerId],
    queryFn: () => api(`/customers/${customerId}/account`),
    enabled: !!customerId,
  });

  const data = account.data;
  const c = data?.customer as any;

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 4000);
  }

  async function recordPayment() {
    if (!payInvoiceId || !payAmount) return;
    setPayLoading(true);
    try {
      await api("/payments", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: payInvoiceId,
          amountCents: Math.round(Number(payAmount) * 100),
          method: payMethod,
          notes: payNotes,
          idempotencyKey: idempotency(),
        }),
      });
      showFlash("Payment recorded ✓");
      setPayAmount(""); setPayNotes(""); setPayInvoiceId("");
      await client.invalidateQueries();
    } catch (e) {
      showFlash((e as Error).message);
    }
    setPayLoading(false);
  }

  async function saveCustomerEdit() {
    try {
      await api(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({
          whatsapp: editWhatsapp || undefined,
          creditLimitCents: editCreditLimit ? Math.round(Number(editCreditLimit) * 100) : undefined,
          creditDays: editCreditDays ? Number(editCreditDays) : undefined,
        }),
      });
      showFlash("Customer updated ✓");
      setEditMode(false);
      await client.invalidateQueries();
    } catch (e) {
      showFlash((e as Error).message);
    }
  }

  function downloadStatement() {
    if (!data) return;
    const lines = [`Customer Statement — ${c?.shop_name}`, `Generated: ${new Date().toLocaleDateString()}`, ""];
    lines.push(`Total Invoiced: ${money(data.summary.totalInvoiced)}`);
    lines.push(`Total Paid: ${money(data.summary.totalPaid)}`);
    lines.push(`Outstanding: ${money(data.summary.outstanding)}`);
    lines.push(`Overdue: ${money(data.summary.overdue)}`);
    lines.push("");
    lines.push("Date,Type,Reference,Debit,Credit,Balance,Note");
    for (const e of data.ledger) {
      lines.push(`"${e.date.slice(0,10)}","${e.type}","${e.ref}","${money(e.debit)}","${money(e.credit)}","${money(e.balance)}","${e.note}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `statement-${c?.shop_name}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div data-overlay style={{
      position: "fixed", inset: 0, zIndex: 1200,
      background: "rgba(10,30,30,0.55)", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        background: "var(--surface)", borderRadius: 18, width: "100%", maxWidth: 900,
        maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 24px", borderBottom: "1.5px solid var(--border)", background: "var(--surface-raised)" }}>
          <Building2 size={22} style={{ color: "var(--brand-primary)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{c?.shop_name || "Customer Account"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{c?.owner_name} · {c?.type}</div>
          </div>
          <button className="secondary" style={{ gap: 6 }} onClick={downloadStatement}>
            <Download size={15} /> Statement
          </button>
          <button className="secondary" onClick={() => { setEditMode(!editMode); setEditWhatsapp(c?.whatsapp||""); setEditCreditLimit(((c?.credit_limit_cents||0)/100).toFixed(0)); setEditCreditDays(c?.credit_days||"0"); }}>
            {editMode ? "Cancel" : "Edit"}
          </button>
          <button className="secondary" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>

        {flash && (
          <div style={{ background: flash.includes("✓") ? "var(--success-soft)" : "var(--danger-soft)", color: flash.includes("✓") ? "var(--success-strong)" : "var(--danger-strong)", padding: "10px 24px", fontSize: 13, fontWeight: 600 }}>{flash}</div>
        )}

        {account.isLoading && <div style={{ padding: 40, textAlign: "center" }}><div className="loader" /></div>}

        {data && (
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {/* Edit panel */}
            {editMode && (
              <div className="resp-grid" style={{ background: "var(--surface-raised)", border: "1.5px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
                <label>WhatsApp<input value={editWhatsapp} onChange={e => setEditWhatsapp(e.target.value)} placeholder="+94771234567" style={{ display: "block", marginTop: 4 }} /></label>
                <label>Credit Limit (LKR)<input type="number" value={editCreditLimit} onChange={e => setEditCreditLimit(e.target.value)} min="0" style={{ display: "block", marginTop: 4 }} /></label>
                <label>Credit Days (max 45)<input type="number" value={editCreditDays} onChange={e => setEditCreditDays(e.target.value)} min="0" max="45" style={{ display: "block", marginTop: 4 }} /></label>
                <button className="primary" onClick={saveCustomerEdit}>Save</button>
              </div>
            )}

            {/* Contact info */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
              {[
                { icon: <Phone size={13} />, val: c?.phone || "—" },
                { icon: <MessageCircle size={13} />, val: c?.whatsapp || "—" },
                { icon: <MapPin size={13} />, val: c?.address || "—" },
                { icon: <Calendar size={13} />, val: `Credit: ${c?.credit_days} days` },
              ].map((item, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}>
                  {item.icon} {item.val}
                </span>
              ))}
            </div>

            {/* Summary stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
              <StatCard label="Total invoiced" value={money(data.summary.totalInvoiced)} />
              <StatCard label="Total paid" value={money(data.summary.totalPaid)} />
              <StatCard label="Outstanding" value={money(data.summary.outstanding)} alert={data.summary.outstanding > 0} />
              <StatCard label="Overdue" value={money(data.summary.overdue)} alert={data.summary.overdue > 0} />
              <StatCard label="Credit limit" value={money(data.summary.creditLimit)} />
              <StatCard label="Available credit" value={money(data.summary.availableCredit)} />
            </div>

            {/* Quick payment */}
            {data.summary.outstanding > 0 && (
              <div style={{ background: "var(--success-soft)", border: "1.5px solid var(--success-line)", borderRadius: 12, padding: 16, marginBottom: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--success-strong)" }}>⚡ Receive Payment</div>
                <div className="resp-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <label style={{ fontSize: 12 }}>Invoice
                    <select value={payInvoiceId} onChange={e => setPayInvoiceId(e.target.value)} style={{ display: "block", marginTop: 4 }}>
                      <option value="">Select invoice</option>
                      {data.invoices.filter(i => i.status === "posted" && i.total_cents > i.paid_cents).map(i => (
                        <option key={i.id} value={i.id}>{i.number} — {money(i.total_cents - i.paid_cents)} due</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}>Amount (LKR)
                    <input type="number" step="0.01" min="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} style={{ display: "block", marginTop: 4 }} />
                  </label>
                  <label style={{ fontSize: 12 }}>Method
                    <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ display: "block", marginTop: 4 }}>
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}>Notes
                    <input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Optional" style={{ display: "block", marginTop: 4 }} />
                  </label>
                  <button className="primary" disabled={payLoading || !payInvoiceId || !payAmount} onClick={recordPayment}>
                    {payLoading ? "…" : "Record"}
                  </button>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1.5px solid var(--border)", marginBottom: 16 }}>
              {([
                ["ledger", "Ledger", <History size={13} />],
                ["invoices", `Invoices (${data.invoices.length})`, <FileText size={13} />],
                ["payments", `Payments (${data.payments.length})`, <CreditCard size={13} />],
                ["freeissues", `Free Issues (${data.freeIssues.length})`, <Gift size={13} />],
                ["consignments", `Consignments (${data.consignments.length})`, <PackageCheck size={13} />],
              ] as const).map(([k, label, icon]) => (
                <button
                  key={k}
                  onClick={() => setActiveTab(k as typeof activeTab)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 14px", border: "none", background: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: activeTab === k ? 700 : 500,
                    color: activeTab === k ? "var(--brand-primary)" : "var(--muted)",
                    borderBottom: activeTab === k ? "2.5px solid var(--brand-primary)" : "2.5px solid transparent",
                    marginBottom: -1.5,
                  }}
                >{icon} {label}</button>
              ))}
            </div>

            {/* Ledger tab */}
            {activeTab === "ledger" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr>
                    <th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Note</th>
                  </tr></thead>
                  <tbody>
                    {data.ledger.map((e, i) => (
                      <tr key={i}>
                        <td>{e.date.slice(0, 10)}</td>
                        <td><Badge text={e.type} variant={e.type === "payment" || e.type === "credit_note" ? "success" : "default"} /></td>
                        <td><strong>{e.ref}</strong></td>
                        <td style={{ color: e.debit ? "var(--danger)" : "inherit" }}>{e.debit ? money(e.debit) : "—"}</td>
                        <td style={{ color: e.credit ? "var(--success)" : "inherit" }}>{e.credit ? money(e.credit) : "—"}</td>
                        <td style={{ fontWeight: 700, color: e.balance > 0 ? "var(--danger)" : "var(--success)" }}>{money(e.balance)}</td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>{e.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.ledger.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No transactions yet.</div>}
              </div>
            )}

            {/* Invoices tab */}
            {activeTab === "invoices" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Invoice</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {data.invoices.map(inv => (
                      <tr key={inv.id}>
                        <td><strong>{inv.number}</strong></td>
                        <td>{money(inv.total_cents)}</td>
                        <td>{money(inv.paid_cents)}</td>
                        <td style={{ color: inv.total_cents > inv.paid_cents ? "var(--danger)" : "inherit" }}>{money(inv.total_cents - inv.paid_cents)}</td>
                        <td>{inv.due_at || "—"}</td>
                        <td><Badge text={inv.status} variant={inv.status === "posted" && inv.total_cents > inv.paid_cents ? "warning" : "success"} /></td>
                        <td><button className="secondary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => { onViewInvoice(inv.id); onClose(); }}>View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.invoices.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No invoices found.</div>}
              </div>
            )}

            {/* Payments tab */}
            {activeTab === "payments" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Notes</th></tr></thead>
                  <tbody>
                    {data.payments.map(p => (
                      <tr key={p.id}>
                        <td>{p.created_at.slice(0, 10)}</td>
                        <td>{p.invoice_number}</td>
                        <td style={{ color: "var(--success)", fontWeight: 700 }}>{money(p.amount_cents)}</td>
                        <td><Badge text={p.method} /></td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.payments.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No payments recorded.</div>}
              </div>
            )}

            {/* Free Issues tab */}
            {activeTab === "freeissues" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Items</th><th>Notes</th></tr></thead>
                  <tbody>
                    {data.freeIssues.map(f => (
                      <tr key={f.id}>
                        <td>{f.created_at.slice(0, 10)}</td>
                        <td style={{ fontSize: 12 }}>{f.items}</td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>{f.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.freeIssues.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No free issues recorded.</div>}
              </div>
            )}

            {/* Consignments tab */}
            {activeTab === "consignments" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Items</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.consignments.map(con => (
                      <tr key={con.id}>
                        <td>{con.created_at.slice(0, 10)}</td>
                        <td style={{ fontSize: 12 }}>{con.items}</td>
                        <td><Badge text={con.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.consignments.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No consignments found.</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// helper import for MessageCircle (not in imports above)
function MessageCircle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPENSES PANEL
// ═══════════════════════════════════════════════════════════════
const EXPENSE_CATEGORIES = [
  "transport","fuel","salaries","utilities","marketing","maintenance","office","general","other",
];

export function ExpensesPanel({ isAdmin }: { isAdmin: boolean }) {
  const client = useQueryClient();
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: "general",
    description: "",
    amount: "",
    method: "cash",
    reference: "",
  });

  const expenses = useQuery<Expense[]>({
    queryKey: ["expenses", from, to],
    queryFn: () => api(`/expenses?from=${from}&to=${to}`),
  });
  const cashbook = useQuery<{ collectionsCents: number; expensesCents: number; netCents: number }>({
    queryKey: ["cashbook", from, to],
    queryFn: () => api(`/cashbook?from=${from}&to=${to}`),
  });

  function showFlash(msg: string) { setFlash(msg); setTimeout(() => setFlash(""), 4000); }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || !form.description) return;
    setLoading(true);
    try {
      await api("/expenses", {
        method: "POST",
        body: JSON.stringify({
          date: form.date,
          category: form.category,
          description: form.description,
          amountCents: Math.round(Number(form.amount) * 100),
          method: form.method,
          reference: form.reference,
        }),
      });
      showFlash("Expense recorded ✓");
      setForm(f => ({ ...f, description: "", amount: "", reference: "" }));
      await client.invalidateQueries();
    } catch (err) {
      showFlash((err as Error).message);
    }
    setLoading(false);
  }

  async function deleteExpense(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      await api(`/expenses/${id}`, { method: "DELETE" });
      showFlash("Deleted ✓");
      await client.invalidateQueries();
    } catch (err) {
      showFlash((err as Error).message);
    }
  }

  function exportCSV() {
    const rows = expenses.data || [];
    if (!rows.length) return;
    const lines = ["Date,Category,Description,Amount,Method,Reference,Recorded By"];
    for (const e of rows) {
      lines.push(`"${e.date}","${e.category}","${e.description}","${money(e.amount_cents)}","${e.method}","${e.reference}","${e.created_by_name}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `expenses-${from}-${to}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const totalExpenses = (expenses.data || []).reduce((s, e) => s + e.amount_cents, 0);

  return (
    <>
      {flash && (
        <div style={{ background: flash.includes("✓") ? "var(--success-soft)" : "var(--danger-soft)", color: flash.includes("✓") ? "var(--success-strong)" : "var(--danger-strong)", padding: "10px 20px", borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>{flash}</div>
      )}

      {/* Cashbook summary */}
      {cashbook.data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "var(--success-soft)", border: "1.5px solid var(--success-line)", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--success-strong)", textTransform: "uppercase", marginBottom: 4 }}>Collections (inflow)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--success)" }}>{money(cashbook.data.collectionsCents)}</div>
          </div>
          <div style={{ background: "var(--danger-soft)", border: "1.5px solid var(--danger-line)", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger-strong)", textTransform: "uppercase", marginBottom: 4 }}>Expenses (outflow)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--danger)" }}>{money(cashbook.data.expensesCents)}</div>
          </div>
          <div style={{ background: cashbook.data.netCents >= 0 ? "var(--success-soft)" : "var(--danger-soft)", border: `1.5px solid ${cashbook.data.netCents >= 0 ? "var(--success-line)" : "var(--danger-line)"}`, borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: cashbook.data.netCents >= 0 ? "var(--success-strong)" : "var(--danger-strong)", textTransform: "uppercase", marginBottom: 4 }}>Net cashflow</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: cashbook.data.netCents >= 0 ? "var(--success)" : "var(--danger)" }}>{money(Math.abs(cashbook.data.netCents))}{cashbook.data.netCents < 0 ? " deficit" : " surplus"}</div>
          </div>
        </div>
      )}

      {/* Date filter */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="form-grid" style={{ gap: 12 }}>
          <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button className="secondary" style={{ display: "flex", alignItems: "center", gap: 6 }} disabled={!expenses.data?.length} onClick={exportCSV}>
              <Download size={15} /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Expenses table */}
      <div className="panel">
        <div className="panel-head">
          <h3>Expenses — {money(totalExpenses)}</h3>
          <span className="muted" style={{ fontSize: 12 }}>{expenses.data?.length || 0} records</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Reference</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {(expenses.data || []).map(e => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td><Badge text={e.category} /></td>
                  <td>{e.description}</td>
                  <td style={{ color: "var(--danger)", fontWeight: 700 }}>{money(e.amount_cents)}</td>
                  <td><Badge text={e.method} /></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{e.reference || "—"}</td>
                  {isAdmin && <td><button className="secondary" style={{ padding: "4px 8px", fontSize: 11, color: "var(--danger)" }} onClick={() => deleteExpense(e.id)}>Delete</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!expenses.data?.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No expenses in this date range.</div>}
        </div>
      </div>

      {/* Add expense form */}
      <div className="panel form-panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><h3>Record expense</h3><Plus size={18} style={{ color: "var(--brand-secondary)" }} /></div>
        <form onSubmit={addExpense}>
          <div className="form-grid">
            <label>Date<input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required /></label>
            <label>Category
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c[0].toUpperCase()+c.slice(1)}</option>)}
              </select>
            </label>
            <label>Description<input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required placeholder="Fuel for delivery van" /></label>
            <label>Amount (LKR)<input type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></label>
            <label>Payment method
              <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Reference / Receipt No.<input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="REC-001" /></label>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={loading}>{loading ? "Saving…" : "Record expense"}</button>
          </div>
        </form>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// CREDIT NOTES (SALES RETURNS) PANEL
// ═══════════════════════════════════════════════════════════════
export function CreditNotesPanel({
  invoices,
  products,
}: {
  invoices: Invoice[];
  products: Array<{ variant_id: string; name: string; label: string; wholesale_cents: number; retail_cents: number }>;
}) {
  const client = useQueryClient();
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(false);
  const [selInvoice, setSelInvoice] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState([{ variantId: "", quantity: 1, unitPriceCents: 0, restock: true }]);

  const creditNotes = useQuery<Array<{id:string;number:string;total_cents:number;reason:string;status:string;shop_name:string;created_at:string}>>({
    queryKey: ["credit-notes"],
    queryFn: () => api("/credit-notes"),
  });

  function showFlash(msg: string) { setFlash(msg); setTimeout(() => setFlash(""), 4000); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter(i => i.variantId && i.quantity > 0);
    if (!validItems.length) return showFlash("Add at least one return item");
    setLoading(true);
    try {
      const res = await api<{ id: string; number: string }>("/credit-notes", {
        method: "POST",
        body: JSON.stringify({ invoiceId: selInvoice, reason, items: validItems }),
      });
      showFlash(`Credit note ${res.number} created ✓`);
      setSelInvoice(""); setReason(""); setItems([{ variantId: "", quantity: 1, unitPriceCents: 0, restock: true }]);
      await client.invalidateQueries();
    } catch (err) {
      showFlash((err as Error).message);
    }
    setLoading(false);
  }

  function pickPrice(variantId: string) {
    const p = products.find(p => p.variant_id === variantId);
    return p?.wholesale_cents || 0;
  }

  return (
    <>
      {flash && (
        <div style={{ background: flash.includes("✓") ? "var(--success-soft)" : "var(--danger-soft)", color: flash.includes("✓") ? "var(--success-strong)" : "var(--danger-strong)", padding: "10px 20px", borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>{flash}</div>
      )}

      {/* List */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h3>Credit notes</h3><span className="muted" style={{ fontSize: 12 }}>{creditNotes.data?.length || 0} total</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Number</th><th>Shop</th><th>Reason</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {(creditNotes.data || []).map(cn => (
                <tr key={cn.id}>
                  <td><strong>{cn.number}</strong></td>
                  <td>{cn.shop_name}</td>
                  <td style={{ fontSize: 12 }}>{cn.reason}</td>
                  <td style={{ color: "var(--success)", fontWeight: 700 }}>{money(cn.total_cents)}</td>
                  <td><Badge text={cn.status} variant="success" /></td>
                  <td style={{ fontSize: 12 }}>{cn.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!creditNotes.data?.length && <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No credit notes issued.</div>}
        </div>
      </div>

      {/* Create form */}
      <div className="panel form-panel">
        <div className="panel-head"><h3>Issue credit note (sales return)</h3><RotateCcw size={18} style={{ color: "var(--brand-secondary)" }} /></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>Original invoice
              <select value={selInvoice} onChange={e => setSelInvoice(e.target.value)} required>
                <option value="">Select invoice</option>
                {invoices.filter(i => i.status === "posted").map(i => (
                  <option key={i.id} value={i.id}>{i.number}{i.shop_name ? ` — ${i.shop_name}` : ""}</option>
                ))}
              </select>
            </label>
            <label>Reason for return<input value={reason} onChange={e => setReason(e.target.value)} required placeholder="Damaged goods / Wrong item / Quality issue" /></label>
          </div>
          <div style={{ margin: "16px 0 8px", fontWeight: 700, fontSize: 13 }}>Return items</div>
          {items.map((item, i) => (
            <div key={i} className="resp-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto auto", gap: 10, marginBottom: 10, alignItems: "end" }}>
              <label style={{ fontSize: 12 }}>Product
                <select value={item.variantId} onChange={e => {
                  const vid = e.target.value;
                  setItems(items.map((it, j) => j === i ? { ...it, variantId: vid, unitPriceCents: pickPrice(vid) } : it));
                }} required>
                  <option value="">Select product</option>
                  {products.map(p => <option key={p.variant_id} value={p.variant_id}>{p.name} · {p.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>Qty<input type="number" min="1" value={item.quantity} onChange={e => setItems(items.map((it, j) => j === i ? { ...it, quantity: Number(e.target.value) } : it))} /></label>
              <label style={{ fontSize: 12 }}>Unit price (LKR)<input type="number" step="0.01" min="0" value={(item.unitPriceCents / 100).toFixed(2)} onChange={e => setItems(items.map((it, j) => j === i ? { ...it, unitPriceCents: Math.round(Number(e.target.value) * 100) } : it))} /></label>
              <label style={{ fontSize: 12 }}>Restock?
                <input type="checkbox" checked={item.restock} onChange={e => setItems(items.map((it, j) => j === i ? { ...it, restock: e.target.checked } : it))} style={{ marginTop: 8, width: "auto" }} />
              </label>
              {items.length > 1 && <button type="button" className="secondary" style={{ padding: "4px 8px", alignSelf: "flex-end" }} onClick={() => setItems(items.filter((_, j) => j !== i))}><Minus size={14} /></button>}
            </div>
          ))}
          <button type="button" className="secondary" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }} onClick={() => setItems([...items, { variantId: "", quantity: 1, unitPriceCents: 0, restock: true }])}>
            <Plus size={15} /> Add item
          </button>
          <div style={{ background: "var(--success-soft)", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13, fontWeight: 700, color: "var(--success-strong)" }}>
            Total credit: {money(items.reduce((s, it) => s + it.quantity * it.unitPriceCents, 0))}
          </div>
          <div className="form-actions">
            <button className="primary" disabled={loading || !selInvoice || !reason}>{loading ? "Processing…" : "Issue credit note"}</button>
          </div>
        </form>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHANGE PASSWORD & CREDENTIALS PANEL
// ═══════════════════════════════════════════════════════════════
export function ChangePasswordPanel() {
  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ user: { id: string; name: string; username?: string; email?: string; admin: number } }>("/me")
      .then((res) => {
        if (res.user?.username) setUsername(res.user.username);
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next) {
      if (next !== confirm) return setFlash("New passwords do not match");
      if (next.length < 6) return setFlash("Password must be at least 6 characters");
    }
    if (passcode && !/^\d{4}$/.test(passcode)) {
      return setFlash("Passcode must be exactly 4 digits (e.g. 2026)");
    }
    setLoading(true);
    try {
      const payload: Record<string, string> = {};
      if (username) payload.username = username.trim();
      if (passcode) payload.passcode = passcode.trim();
      if (next) {
        if (current) payload.current = current;
        payload.next = next;
      }
      await api("/change-password", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setFlash("Credentials updated successfully ✓ (පිවිසුම් තොරතුරු සාර්ථකව සුරකින ලදී)");
      setCurrent("");
      setNext("");
      setConfirm("");
      setPasscode("");
    } catch (err) {
      setFlash((err as Error).message || "Failed to update credentials");
    }
    setLoading(false);
  }

  return (
    <div className="panel form-panel" style={{ maxWidth: 520 }}>
      <div className="panel-head">
        <div>
          <h3 style={{ margin: 0 }}>ගිණුම් පිවිසුම් හා ආරක්ෂක සැකසුම් (Account Credentials)</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--brand-text-muted, #647773)" }}>
            පරිශීලක නාමය (Username), මුරපදය (Password), සහ අංක 4 ක්ෂණික PIN කේතය වෙනස් කරන්න.
          </p>
        </div>
      </div>
      {flash && (
        <div
          style={{
            background: flash.includes("✓") ? "var(--success-soft, #e6f6ef)" : "var(--danger-soft, #fff1ef)",
            color: flash.includes("✓") ? "var(--success-strong, #168064)" : "var(--danger-strong, #a53332)",
            padding: "10px 16px",
            borderRadius: 8,
            margin: "0 0 16px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {flash}
        </div>
      )}
      <form onSubmit={submit}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label>
            පරිශීලක නාමය (Username)
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Admin or your username"
              autoComplete="username"
            />
          </label>
          <label>
            අංක 4 ක්ෂණික පිවිසුම් කේතය (4-Digit Quick PIN)
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="e.g. 2026"
            />
            <small style={{ color: "var(--brand-text-muted, #647773)", marginTop: 2 }}>
              ජංගම දුරකථනයෙන් හෝ ටැබ්ලට් එකෙන් ඉක්මනින් ලොග් වීමට අංක 4 PIN කේතයක් සකසන්න.
            </small>
          </label>
          <hr style={{ border: "none", borderTop: "1px solid var(--brand-border, #DDEBE5)", margin: "4px 0" }} />
          <strong style={{ fontSize: 14, color: "var(--brand-text, #142C2A)" }}>
            මුරපදය වෙනස් කිරීම (Change Password - Optional)
          </strong>
          <label>
            Current password (වත්මන් මුරපදය)
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              placeholder="Leave blank if only updating username or PIN"
            />
          </label>
          <label>
            New password (නව මුරපදය)
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={6}
              autoComplete="new-password"
              placeholder="New password (min 6 characters)"
            />
          </label>
          <label>
            Confirm new password (තහවුරු කරන්න)
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Repeat new password"
            />
          </label>
        </div>
        <div className="form-actions" style={{ marginTop: 18 }}>
          <button className="primary" disabled={loading}>
            {loading ? "Saving…" : "Save Changes (සුරකින්න)"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STOCK TRANSFER PANEL
// ═══════════════════════════════════════════════════════════════
export function StockTransferPanel({
  products,
  stocks,
}: {
  products: Array<{ variant_id: string; name: string; label: string }>;
  stocks: Array<{ warehouse_id: string; warehouse: string; variant_id: string; quantity: number }>;
}) {
  const client = useQueryClient();
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ from: "", to: "", variantId: "", quantity: 1 });

  const warehouses = [...new Set(stocks.map(s => s.warehouse_id))];
  const availableQty = stocks.find(s => s.warehouse_id === form.from && s.variant_id === form.variantId)?.quantity || 0;

  function showFlash(msg: string) { setFlash(msg); setTimeout(() => setFlash(""), 4000); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.from === form.to) return showFlash("Select different warehouses");
    if (form.quantity > availableQty) return showFlash(`Only ${availableQty} units available in source`);
    setLoading(true);
    try {
      await api("/stock/transfer", {
        method: "POST",
        body: JSON.stringify({ from: form.from, to: form.to, variantId: form.variantId, quantity: form.quantity }),
      });
      showFlash("Stock transferred ✓");
      setForm(f => ({ ...f, quantity: 1 }));
      await client.invalidateQueries();
    } catch (err) {
      showFlash((err as Error).message);
    }
    setLoading(false);
  }

  if (warehouses.length < 2) {
    return (
      <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
        Stock transfers require at least two warehouses. Create a sales rep warehouse first.
      </div>
    );
  }

  return (
    <>
      {flash && (
        <div style={{ background: flash.includes("✓") ? "var(--success-soft)" : "var(--danger-soft)", color: flash.includes("✓") ? "var(--success-strong)" : "var(--danger-strong)", padding: "10px 20px", borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>{flash}</div>
      )}
      <div className="panel form-panel">
        <div className="panel-head"><h3>Transfer stock between warehouses</h3></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>From warehouse
              <select value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} required>
                <option value="">Select source</option>
                {warehouses.map(wid => <option key={wid} value={wid}>{stocks.find(s => s.warehouse_id === wid)?.warehouse || wid}</option>)}
              </select>
            </label>
            <label>To warehouse
              <select value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} required>
                <option value="">Select destination</option>
                {warehouses.filter(w => w !== form.from).map(wid => <option key={wid} value={wid}>{stocks.find(s => s.warehouse_id === wid)?.warehouse || wid}</option>)}
              </select>
            </label>
            <label>Product
              <select value={form.variantId} onChange={e => setForm(f => ({ ...f, variantId: e.target.value }))} required>
                <option value="">Select product</option>
                {products.map(p => <option key={p.variant_id} value={p.variant_id}>{p.name} · {p.label}</option>)}
              </select>
            </label>
            <label>Quantity {form.variantId && form.from && <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 6 }}>(available: {availableQty})</span>}
              <input type="number" min="1" max={availableQty || undefined} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} required />
            </label>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={loading}>{loading ? "Transferring…" : "Transfer stock"}</button>
          </div>
        </form>
      </div>
    </>
  );
}
