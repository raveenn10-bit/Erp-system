"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart } from "lucide-react";
import { api } from "@/lib/api";
import { lkr } from "@/lib/invoice-model";

/**
 * Presentation layer for /api/reports/:kind. The API still returns integer
 * cents (unchanged); this component only labels and formats them in LKR.
 */

type Row = Record<string, string | number | null>;
type Fmt = "money" | "count" | "date" | "datetime" | "text" | "title" | "signed" | "due";
type Col = { key: string; en: string; si: string; fmt: Fmt; total?: boolean; hint?: string };
type Card = { en: string; si: string; value: (rows: Row[]) => string; tone?: "danger" | "alert" };
type ReportDef = { label: string; si: string; help: string; cols: Col[]; derive?: (r: Row) => Row; cards: Card[] };

const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const sum = (rows: Row[], key: string) => rows.reduce((t, r) => t + n(r[key]), 0);
const today = () => new Date().toISOString().slice(0, 10);

const REPORTS: Record<string, ReportDef> = {
  "daily-sales": {
    label: "Daily sales",
    si: "දෛනික විකුණුම්",
    help: "Sales per day. “Paid” is how much of that day's invoices has been paid so far.",
    derive: (r) => ({ ...r, balance_cents: n(r.invoiced_cents) - n(r.collected_cents) }),
    cols: [
      { key: "date", en: "Date", si: "දිනය", fmt: "date" },
      { key: "invoices", en: "Invoices", si: "බිල්පත්", fmt: "count", total: true },
      { key: "invoiced_cents", en: "Sales", si: "විකුණුම්", fmt: "money", total: true },
      { key: "collected_cents", en: "Paid", si: "ගෙවූ මුදල", fmt: "money", total: true },
      { key: "balance_cents", en: "Balance to collect", si: "ලැබිය යුතු", fmt: "money", total: true },
    ],
    cards: [
      { en: "Total sales", si: "මුළු විකුණුම්", value: (r) => lkr(sum(r, "invoiced_cents")) },
      { en: "Paid", si: "ගෙවූ මුදල", value: (r) => lkr(sum(r, "collected_cents")) },
      { en: "Balance to collect", si: "ලැබිය යුතු", value: (r) => lkr(sum(r, "balance_cents")), tone: "alert" },
      { en: "Invoices", si: "බිල්පත්", value: (r) => String(sum(r, "invoices")) },
    ],
  },
  "product-sales": {
    label: "Product sales & profit",
    si: "නිෂ්පාදන විකුණුම් සහ ලාභය",
    help: "Units sold, sales value and gross profit (sale price − cost) for each product pack.",
    derive: (r) => ({
      ...r,
      margin: n(r.revenue_cents) ? `${((n(r.gross_profit_cents) / n(r.revenue_cents)) * 100).toFixed(1)}%` : "—",
    }),
    cols: [
      { key: "name", en: "Product", si: "නිෂ්පාදනය", fmt: "text" },
      { key: "label", en: "Pack", si: "ඇසුරුම", fmt: "text" },
      { key: "units", en: "Units sold", si: "විකුණූ ප්‍රමාණය", fmt: "count", total: true },
      { key: "revenue_cents", en: "Sales", si: "විකුණුම්", fmt: "money", total: true },
      { key: "gross_profit_cents", en: "Gross profit", si: "දළ ලාභය", fmt: "money", total: true },
      { key: "margin", en: "Margin", si: "ලාභ අනුපාතය", fmt: "text" },
    ],
    cards: [
      { en: "Total sales", si: "මුළු විකුණුම්", value: (r) => lkr(sum(r, "revenue_cents")) },
      { en: "Gross profit", si: "දළ ලාභය", value: (r) => lkr(sum(r, "gross_profit_cents")) },
      {
        en: "Profit margin",
        si: "ලාභ අනුපාතය",
        value: (r) => {
          const s = sum(r, "revenue_cents");
          return s ? `${((sum(r, "gross_profit_cents") / s) * 100).toFixed(1)}%` : "—";
        },
      },
      { en: "Units sold", si: "විකුණූ ප්‍රමාණය", value: (r) => sum(r, "units").toLocaleString("en-LK") },
    ],
  },
  outstanding: {
    label: "Customer outstanding",
    si: "ගනුදෙනුකරුවන්ගේ ණය",
    help: "Unpaid invoices created in this date range. Overdue due dates are shown in red.",
    cols: [
      { key: "shop_name", en: "Shop", si: "කඩය", fmt: "text" },
      { key: "number", en: "Invoice No", si: "බිල් අංකය", fmt: "text" },
      { key: "due_at", en: "Due date", si: "ගෙවිය යුතු දිනය", fmt: "due" },
      { key: "outstanding_cents", en: "Amount due", si: "ගෙවිය යුතු මුදල", fmt: "money", total: true },
    ],
    cards: [
      { en: "Total outstanding", si: "මුළු ණය", value: (r) => lkr(sum(r, "outstanding_cents")), tone: "alert" },
      {
        en: "Overdue",
        si: "කල් ඉකුත් වූ",
        value: (r) => lkr(r.filter((x) => x.due_at && String(x.due_at).slice(0, 10) < today()).reduce((t, x) => t + n(x.outstanding_cents), 0)),
        tone: "danger",
      },
      { en: "Unpaid invoices", si: "නොගෙවූ බිල්පත්", value: (r) => String(r.length) },
      { en: "Shops", si: "කඩ", value: (r) => String(new Set(r.map((x) => x.shop_name)).size) },
    ],
  },
  collections: {
    label: "Payment collections",
    si: "ලැබුණු ගෙවීම්",
    help: "Every payment received in this date range.",
    cols: [
      { key: "created_at", en: "Date & time", si: "දිනය සහ වේලාව", fmt: "datetime" },
      { key: "number", en: "Invoice No", si: "බිල් අංකය", fmt: "text" },
      { key: "method", en: "Method", si: "ක්‍රමය", fmt: "title" },
      { key: "amount_cents", en: "Amount received", si: "ලැබුණු මුදල", fmt: "money", total: true },
    ],
    cards: [
      { en: "Total collected", si: "මුළු ලැබීම්", value: (r) => lkr(sum(r, "amount_cents")) },
      { en: "Cash", si: "මුදල්", value: (r) => lkr(r.filter((x) => String(x.method).toLowerCase() === "cash").reduce((t, x) => t + n(x.amount_cents), 0)) },
      { en: "Other methods", si: "වෙනත් ක්‍රම", value: (r) => lkr(r.filter((x) => String(x.method).toLowerCase() !== "cash").reduce((t, x) => t + n(x.amount_cents), 0)) },
      { en: "Payments", si: "ගෙවීම් ගණන", value: (r) => String(r.length) },
    ],
  },
  "stock-movements": {
    label: "Stock movements",
    si: "තොග චලනයන්",
    help: "Stock in (+) and out (−) for each product pack.",
    cols: [
      { key: "created_at", en: "Date & time", si: "දිනය සහ වේලාව", fmt: "datetime" },
      { key: "name", en: "Product", si: "නිෂ්පාදනය", fmt: "text" },
      { key: "label", en: "Pack", si: "ඇසුරුම", fmt: "text" },
      { key: "reason", en: "Reason", si: "හේතුව", fmt: "title" },
      { key: "quantity", en: "Quantity", si: "ප්‍රමාණය", fmt: "signed" },
      { key: "from_warehouse", en: "From", si: "සිට", fmt: "title" },
      { key: "to_warehouse", en: "To", si: "දක්වා", fmt: "title" },
    ],
    cards: [
      { en: "Units in", si: "ලැබුණු", value: (r) => r.reduce((t, x) => t + Math.max(0, n(x.quantity)), 0).toLocaleString("en-LK") },
      { en: "Units out", si: "නිකුත් කළ", value: (r) => Math.abs(r.reduce((t, x) => t + Math.min(0, n(x.quantity)), 0)).toLocaleString("en-LK") },
      { en: "Movements", si: "චලනයන්", value: (r) => String(r.length) },
    ],
  },
};

function parseDate(v: string) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : /^\d{4}-\d{2}-\d{2} \d/.test(v) ? v.replace(" ", "T") + "Z" : v;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(v: string, time: boolean) {
  const d = parseDate(v);
  if (!d) return v;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: dateOnly ? undefined : "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
  }).format(d);
}
const title = (v: string) => v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function display(col: Col, v: Row[string]): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (col.fmt) {
    case "money":
      return lkr(n(v));
    case "count":
      return n(v).toLocaleString("en-LK");
    case "signed":
      return n(v) > 0 ? `+${n(v)}` : String(n(v));
    case "date":
    case "due":
      return fmtDate(String(v), false);
    case "datetime":
      return fmtDate(String(v), true);
    case "title":
      return title(String(v));
    default:
      return String(v);
  }
}
/** CSV keeps plain numbers (2 decimals) so Excel can add them up. */
function csvValue(col: Col, v: Row[string]): string {
  if (v === null || v === undefined) return "";
  if (col.fmt === "money") return (n(v) / 100).toFixed(2);
  if (col.fmt === "count" || col.fmt === "signed") return String(n(v));
  if (col.fmt === "date" || col.fmt === "due") return String(v).slice(0, 10);
  if (col.fmt === "datetime") return display(col, v);
  if (col.fmt === "title") return title(String(v));
  return String(v);
}
const header = (c: Col) => (c.fmt === "money" ? `${c.en} (LKR)` : c.en);

export function ReportsPanel() {
  const [kind, setKind] = useState("daily-sales"),
    [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
    [to, setTo] = useState(today());
  const def = REPORTS[kind];
  const report = useQuery({
    queryKey: ["report", kind, from, to],
    queryFn: () => api<Row[]>(`/reports/${kind}?from=${from}&to=${to}`),
  });
  const rows = useMemo(() => (report.data || []).map((r) => (def.derive ? def.derive(r) : r)), [report.data, def]);

  function csv() {
    if (!rows.length) return;
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const lines = [
      def.cols.map((c) => esc(header(c))).join(","),
      ...rows.map((r) => def.cols.map((c) => esc(csvValue(c, r[c.key]))).join(",")),
    ];
    if (def.cols.some((c) => c.total))
      lines.push(def.cols.map((c, i) => esc(i === 0 ? "TOTAL" : c.total ? csvValue(c, sum(rows, c.key)) : "")).join(","));
    // BOM so Excel opens Sinhala names correctly
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.label.replace(/[^A-Za-z0-9]+/g, "-")}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const today0 = today();
  return (
    <>
      <div className="section-lead">
        <div>
          <h2>Business reports</h2>
          <p>
            All amounts are in Sri Lankan Rupees (LKR). · <span className="si" lang="si">සියලු මුදල් ශ්‍රී ලංකා රුපියල් වලින්.</span>
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="report-filters">
          <label>
            <span>
              Report · <span className="si" lang="si">වාර්තාව</span>
            </span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(REPORTS).map(([value, r]) => (
                <option key={value} value={value}>
                  {r.label} — {r.si}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              From · <span className="si" lang="si">සිට</span>
            </span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span>
              To · <span className="si" lang="si">දක්වා</span>
            </span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="secondary report-export" disabled={!rows.length} onClick={csv}>
            <Download size={17} /> Export CSV
          </button>
        </div>
        <p className="report-help">
          <FileBarChart size={15} /> {def.help}
        </p>
      </div>

      {report.isLoading ? (
        <div className="loader" style={{ marginTop: 20 }} />
      ) : report.isError ? (
        <div className="error" style={{ marginTop: 20 }}>Could not load this report.</div>
      ) : !rows.length ? (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="empty">No records between these dates. · මෙම දින අතර වාර්තා නැත.</div>
        </div>
      ) : (
        <>
          <div className="report-cards">
            {def.cards.map((c) => (
              <div key={c.en} className={`stat-card ${c.tone || ""}`}>
                <small>
                  {c.en}
                  <span className="si" lang="si">{c.si}</span>
                </small>
                <strong>{c.value(rows)}</strong>
              </div>
            ))}
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="table-wrap">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    {def.cols.map((c) => (
                      <th key={c.key} className={c.fmt === "money" || c.fmt === "count" || c.fmt === "signed" ? "num" : ""}>
                        {c.en}
                        <span className="si" lang="si">{c.si}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {def.cols.map((c) => {
                        const overdue = c.fmt === "due" && r[c.key] && String(r[c.key]).slice(0, 10) < today0;
                        const neg = c.fmt === "signed" && n(r[c.key]) < 0;
                        return (
                          <td
                            key={c.key}
                            className={[
                              c.fmt === "money" || c.fmt === "count" || c.fmt === "signed" ? "num" : "",
                              overdue ? "overdue" : "",
                              neg ? "neg" : "",
                            ].join(" ")}
                          >
                            {display(c, r[c.key])}
                            {overdue && <small> overdue</small>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {def.cols.some((c) => c.total) && (
                  <tfoot>
                    <tr>
                      {def.cols.map((c, i) => (
                        <td key={c.key} className={c.total ? "num" : ""}>
                          {i === 0 ? "Total · එකතුව" : c.total ? display(c, sum(rows, c.key)) : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {rows.length >= 500 && <p className="report-help">Showing the first 500 rows. Narrow the dates to see everything.</p>}
          </div>
        </>
      )}
    </>
  );
}
