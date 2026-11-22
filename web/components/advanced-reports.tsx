"use client";

import React, { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Gift,
  HelpCircle,
  Package,
  PackageCheck,
  Printer,
  RotateCcw,
  Search,
  Share2,
  TrendingUp,
  Users,
  Wallet,
  Warehouse,
  ShoppingBag,
  CreditCard,
  Building2,
  DollarSign,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { api, money } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { InvoiceActions } from "@/components/invoice-actions";
import jsPDF from "jspdf";

// Color constants for charts
const COLORS = ["#10a58d", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316"];

type DateRangeOption =
  | "today"
  | "yesterday"
  | "7days"
  | "30days"
  | "90days"
  | "thisMonth"
  | "prevMonth"
  | "prev3Months"
  | "custom";

type TabKey =
  | "all"
  | "daily-sales"
  | "revenue"
  | "customers"
  | "credit-payments"
  | "products"
  | "inventory"
  | "sales-reps"
  | "free-issues"
  | "consignments"
  | "expenses"
  | "profit-loss";

// Helper for date calculations in Asia/Colombo
function getColomboDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getDateRange(range: DateRangeOption): { from: string; to: string } {
  const today = new Date();
  const todayStr = getColomboDateString(today);

  switch (range) {
    case "today":
      return { from: todayStr, to: todayStr };
    case "yesterday": {
      const y = new Date(Date.now() - 86400000);
      const yStr = getColomboDateString(y);
      return { from: yStr, to: yStr };
    }
    case "7days": {
      const f = new Date(Date.now() - 7 * 86400000);
      return { from: getColomboDateString(f), to: todayStr };
    }
    case "30days": {
      const f = new Date(Date.now() - 30 * 86400000);
      return { from: getColomboDateString(f), to: todayStr };
    }
    case "90days": {
      const f = new Date(Date.now() - 90 * 86400000);
      return { from: getColomboDateString(f), to: todayStr };
    }
    case "thisMonth": {
      const start = `${todayStr.slice(0, 7)}-01`;
      return { from: start, to: todayStr };
    }
    case "prevMonth": {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endD = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        from: getColomboDateString(d),
        to: getColomboDateString(endD),
      };
    }
    case "prev3Months": {
      const d = new Date(today.getFullYear(), today.getMonth() - 3, 1);
      return { from: getColomboDateString(d), to: todayStr };
    }
    default:
      return { from: getColomboDateString(new Date(Date.now() - 30 * 86400000)), to: todayStr };
  }
}

export function AdvancedReportsDashboard({
  onViewInvoice,
  onViewCustomer,
}: {
  onViewInvoice?: (id: string) => void;
  onViewCustomer?: (id: string) => void;
}) {
  const { lang } = useI18n();
  const reduced = useReducedMotion();

  // Active Tab state
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  // Date range filter state
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("30days");
  const initialDates = useMemo(() => getDateRange("30days"), []);
  const [customFrom, setCustomFrom] = useState(initialDates.from);
  const [customTo, setCustomTo] = useState(initialDates.to);

  // Daily Sales specific date state
  const [dailySalesDate, setDailySalesDate] = useState(getColomboDateString());

  // Invoice viewer modal state
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Drill-down expanded invoice state
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Current active date range
  const { from, to } = useMemo(() => {
    if (dateRangeOption === "custom") {
      return { from: customFrom, to: customTo };
    }
    return getDateRange(dateRangeOption);
  }, [dateRangeOption, customFrom, customTo]);

  // Handle Date range change
  function handleRangeSelect(opt: DateRangeOption) {
    setDateRangeOption(opt);
    if (opt !== "custom") {
      const r = getDateRange(opt);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  }

  // 1. Fetch BI Overview Query
  const overviewQuery = useQuery({
    queryKey: ["bi-overview", from, to],
    queryFn: () => api<any>(`/reports/bi/overview?from=${from}&to=${to}`),
  });

  // 2. Fetch Daily Sales Query
  const dailySalesQuery = useQuery({
    queryKey: ["bi-daily-sales", dailySalesDate],
    queryFn: () => api<any>(`/reports/bi/daily-sales?date=${dailySalesDate}`),
    enabled: activeTab === "daily-sales" || activeTab === "all",
  });

  // 3. Fetch Tab Specific Query
  const tabQuery = useQuery({
    queryKey: ["bi-tab", activeTab, from, to],
    queryFn: () => api<any>(`/reports/bi/tab/${activeTab}?from=${from}&to=${to}`),
    enabled: activeTab !== "all" && activeTab !== "daily-sales",
  });

  // Tab definitions
  const tabs: Array<{ key: TabKey; labelEn: string; labelSi: string; icon: any }> = [
    { key: "all", labelEn: "All Reports", labelSi: "සියලු වාර්තා", icon: BarChart3 },
    { key: "daily-sales", labelEn: "Daily Sales", labelSi: "දෛනික විකුණුම්", icon: Activity },
    { key: "revenue", labelEn: "Revenue", labelSi: "ආදායම්", icon: TrendingUp },
    { key: "customers", labelEn: "Customers", labelSi: "පාරිභෝගිකයින්", icon: Building2 },
    { key: "credit-payments", labelEn: "Credit & Payments", labelSi: "ණය සහ ගෙවීම්", icon: Wallet },
    { key: "products", labelEn: "Products", labelSi: "නිෂ්පාදන", icon: Package },
    { key: "inventory", labelEn: "Inventory", labelSi: "තොග", icon: Warehouse },
    { key: "sales-reps", labelEn: "Sales Reps", labelSi: "විකුණුම් නියෝජිතයින්", icon: Users },
    { key: "free-issues", labelEn: "Free Issues", labelSi: "නොමිලේ නිකුත් කිරීම්", icon: Gift },
    { key: "consignments", labelEn: "Consignments", labelSi: "විකුණා ගෙවීම්", icon: PackageCheck },
    { key: "expenses", labelEn: "Expenses", labelSi: "වියදම්", icon: ArrowDownLeft },
    { key: "profit-loss", labelEn: "Profit & Loss", labelSi: "ලාභ හා අලාභ", icon: DollarSign },
  ];

  // ── Export Utilities ────────────────────────────────────────────────────────
  function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csvContent = [
      headers.map(escape).join(","),
      ...rows.map((row) => row.map(escape).join(",")),
    ].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel(filename: string, title: string, headers: string[], rows: (string | number)[][]) {
    // Generate clean Excel-compliant XML spreadsheet
    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${title}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>
      </head>
      <body>
        <h2>Nugathalawa Ceylon Tea Export (Pvt) Ltd</h2>
        <h3>${title}</h3>
        <p>Period: ${from} to ${to} · Generated: ${new Date().toLocaleString()}</p>
        <table border="1">
          <tr style="background:#10a58d;color:#ffffff;font-weight:bold;">
            ${headers.map((h) => `<th style="padding:6px 10px;">${h}</th>`).join("")}
          </tr>
          ${rows
            .map(
              (r) =>
                `<tr>${r.map((c) => `<td style="padding:5px 8px;">${c}</td>`).join("")}</tr>`
            )
            .join("")}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDFReport(title: string, headers: string[], rows: (string | number)[][]) {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(16, 165, 141);
    doc.text("NUGATHALAWA CEYLON TEA EXPORT (PVT) LTD", 40, 45);

    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(title.toUpperCase(), 40, 68);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Period: ${from} to ${to}   |   Generated: ${new Date().toLocaleString()}`, 40, 84);

    // Draw header table line
    doc.setDrawColor(203, 213, 225);
    doc.line(40, 95, 800, 95);

    let y = 115;
    const colWidth = Math.floor(760 / Math.max(headers.length, 1));

    // Render table headers
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    headers.forEach((h, i) => {
      doc.text(String(h), 40 + i * colWidth, y);
    });

    y += 10;
    doc.line(40, y, 800, y);
    y += 15;

    // Render table rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);

    rows.slice(0, 35).forEach((r) => {
      if (y > 540) {
        doc.addPage();
        y = 45;
      }
      r.forEach((cell, ci) => {
        const text = String(cell ?? "");
        doc.text(text.length > 28 ? text.slice(0, 26) + "..." : text, 40 + ci * colWidth, y);
      });
      y += 18;
    });

    if (rows.length > 35) {
      doc.setFont("helvetica", "italic");
      doc.text(`... and ${rows.length - 35} more records (export Excel or CSV for full list)`, 40, y + 10);
    }

    doc.save(`${title.toLowerCase().replace(/\s+/g, "-")}-${from}-${to}.pdf`);
  }

  const kpis = overviewQuery.data?.kpis || {};
  const charts = overviewQuery.data?.charts || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {selectedInvoiceId && (
        <InvoiceActions
          id={selectedInvoiceId}
          close={() => setSelectedInvoiceId(null)}
        />
      )}

      {/* Header & Date Controls Lead Section */}
      <div className="section-lead" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h2>{lang === "si" ? "ව්‍යාපාර බුද්ධි සහ වාර්තා මධ්‍යස්ථානය" : "Admin Business Intelligence & Reports"}</h2>
          <p>
            {lang === "si"
              ? "සජීවී D1 ගනුදෙනු, විකුණුම්, ආදායම්, ණය සහ ලාභ-අලාභ පිළිබඳ සම්පූර්ණ විශ්ලේෂණය"
              : "Live transactional metrics, revenue analytics, customer debt, and financial intelligence."}
          </p>
        </div>

        {/* Global Date Filter Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { id: "today", labelEn: "Today", labelSi: "අද" },
              { id: "yesterday", labelEn: "Yesterday", labelSi: "ඊයේ" },
              { id: "7days", labelEn: "Last 7 Days", labelSi: "දින 7" },
              { id: "30days", labelEn: "Last 30 Days", labelSi: "දින 30" },
              { id: "90days", labelEn: "Last 90 Days", labelSi: "දින 90" },
              { id: "thisMonth", labelEn: "This Month", labelSi: "මේ මාසය" },
              { id: "prevMonth", labelEn: "Prev Month", labelSi: "පසුගිය මාසය" },
              { id: "custom", labelEn: "Custom", labelSi: "තෝරාගත්" },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                className={dateRangeOption === btn.id ? "primary" : "secondary"}
                onClick={() => handleRangeSelect(btn.id as DateRangeOption)}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  minHeight: 32,
                  borderRadius: 8,
                }}
              >
                {lang === "si" ? btn.labelSi : btn.labelEn}
              </button>
            ))}
          </div>

          {dateRangeOption === "custom" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ padding: "4px 8px", fontSize: 12, width: 140, minHeight: 32 }}
              />
              <span style={{ fontSize: 12, color: "#64748b" }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ padding: "4px 8px", fontSize: 12, width: 140, minHeight: 32 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* One-Click Horizontal Report Tabs Bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 6,
          borderBottom: "1px solid #e2e8f0",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 14px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: isActive ? 750 : 600,
                whiteSpace: "nowrap",
                border: isActive ? "1px solid #10a58d" : "1px solid #e2e8f0",
                background: isActive ? "#10a58d" : "#ffffff",
                color: isActive ? "#ffffff" : "#334155",
                cursor: "pointer",
                transition: "all 0.16s ease",
                boxShadow: isActive ? "0 2px 8px rgba(16, 165, 141, 0.25)" : "none",
              }}
            >
              <Icon size={16} />
              <span>{lang === "si" ? t.labelSi : t.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* ── 1. ALL REPORTS TAB (Full BI Executive Dashboard) ────────────────── */}
      {activeTab === "all" && (
        <motion.div
          key="all"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", flexDirection: "column", gap: 20 }}
        >
          {/* Executive KPI Cards Grid */}
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {[
              {
                title: lang === "si" ? "අද දින විකුණුම්" : "Today's Revenue",
                value: money(kpis.todaySalesCents || 0),
                sub: "Live from invoices",
                icon: Activity,
                color: "#10a58d",
                onClick: () => setActiveTab("daily-sales"),
              },
              {
                title: lang === "si" ? "ඊයේ දින විකුණුම්" : "Yesterday's Revenue",
                value: money(kpis.yesterdaySalesCents || 0),
                sub: "Settled yesterday",
                icon: TrendingUp,
                color: "#3b82f6",
                onClick: () => setActiveTab("revenue"),
              },
              {
                title: lang === "si" ? "මෙම සතියේ විකුණුම්" : "This Week Sales",
                value: money(kpis.thisWeekSalesCents || 0),
                sub: "Past 7 days",
                icon: BarChart3,
                color: "#8b5cf6",
                onClick: () => setActiveTab("revenue"),
              },
              {
                title: lang === "si" ? "මෙම මාසයේ විකුණුම්" : "This Month Sales",
                value: money(kpis.thisMonthSalesCents || 0),
                sub: "Month to date",
                icon: DollarSign,
                color: "#059669",
                onClick: () => setActiveTab("revenue"),
              },
              {
                title: lang === "si" ? "දින 90 ක විකුණුම්" : "Last 90 Days Revenue",
                value: money(kpis.last90DaysSalesCents || 0),
                sub: "Quarterly total",
                icon: AreaChart,
                color: "#0891b2",
                onClick: () => setActiveTab("revenue"),
              },
              {
                title: lang === "si" ? "මුළු හිඟ ණය ප්‍රමාණය" : "Total Outstanding Credit",
                value: money(kpis.totalOutstandingCents || 0),
                sub: "Receivables ledger",
                icon: Wallet,
                color: "#ea580c",
                alert: (kpis.totalOutstandingCents || 0) > 0,
                onClick: () => setActiveTab("credit-payments"),
              },
              {
                title: lang === "si" ? "කල් ඉකුත් වූ ණය (Overdue)" : "Overdue Credit",
                value: money(kpis.overdueCents || 0),
                sub: "Due date passed",
                icon: AlertTriangle,
                color: "#dc2626",
                alert: (kpis.overdueCents || 0) > 0,
                onClick: () => setActiveTab("credit-payments"),
              },
              {
                title: lang === "si" ? "ලැබුණු මුදල් (Collections)" : "Total Collections",
                value: money(kpis.rangeCollectionsCents || 0),
                sub: `In selected period`,
                icon: CreditCard,
                color: "#16a34a",
                onClick: () => setActiveTab("credit-payments"),
              },
              {
                title: lang === "si" ? "සම්පූර්ණ වියදම්" : "Total Expenses",
                value: money(kpis.rangeExpensesCents || 0),
                sub: `In selected period`,
                icon: ArrowDownLeft,
                color: "#b91c1c",
                onClick: () => setActiveTab("expenses"),
              },
              {
                title: lang === "si" ? "දළ ලාභය (Gross Profit)" : "Gross Profit",
                value: money(kpis.rangeGrossProfitCents || 0),
                sub: `Revenue - COGS`,
                icon: TrendingUp,
                color: "#15803d",
                onClick: () => setActiveTab("profit-loss"),
              },
              {
                title: lang === "si" ? "ක්‍රියාකාරී වෙළඳසැල්" : "Active Shops",
                value: kpis.activeShopsCount || 0,
                sub: "Registered customers",
                icon: Building2,
                color: "#4f46e5",
                onClick: () => setActiveTab("customers"),
              },
              {
                title: lang === "si" ? "අඩු තොග අනතුරු ඇඟවීම්" : "Low Stock Products",
                value: kpis.lowStockCount || 0,
                sub: "Below reorder level",
                icon: Package,
                color: "#d97706",
                alert: (kpis.lowStockCount || 0) > 0,
                onClick: () => setActiveTab("inventory"),
              },
            ].map((kpi, idx) => (
              <motion.div
                key={kpi.title}
                whileHover={reduced ? undefined : { scale: 1.015, y: -2 }}
                transition={{ duration: 0.15 }}
                className={`stat-card ${kpi.alert ? "alert" : ""}`}
                onClick={kpi.onClick}
                style={{ cursor: "pointer" }}
              >
                <div className="stat-top">
                  <small>{kpi.title}</small>
                  <span className="stat-icon" style={{ color: kpi.color }}>
                    <kpi.icon size={19} />
                  </span>
                </div>
                <strong style={{ fontSize: "21px", marginTop: "14px" }}>{kpi.value}</strong>
                <span style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", display: "block" }}>
                  {kpi.sub}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Interactive Charts Grid */}
          <div className="workspace-grid">
            {/* 1. Daily Sales Trend Area Chart */}
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3>{lang === "si" ? "දෛනික විකුණුම් ප්‍රවණතාව" : "Sales Revenue vs Collections Trend"}</h3>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {from} to {to}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const rows = (charts.dailyTrend || []).map((d: any) => [
                      d.date,
                      d.invoices,
                      (d.invoiced_cents / 100).toFixed(2),
                      (d.collected_cents / 100).toFixed(2),
                    ]);
                    exportCSV("daily-sales-trend", ["Date", "Invoices", "Invoiced LKR", "Collected LKR"], rows);
                  }}
                  style={{ padding: "4px 8px", fontSize: 11 }}
                >
                  <Download size={13} /> CSV
                </button>
              </div>

              {(charts.dailyTrend || []).length === 0 ? (
                <div className="empty">No sales records in selected period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart
                    data={(charts.dailyTrend || []).map((d: any) => ({
                      date: d.date.slice(5),
                      invoiced: d.invoiced_cents / 100,
                      collected: d.collected_cents / 100,
                    }))}
                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorInvoiced" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10a58d" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10a58d" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip
                      formatter={(val: any) => [`LKR ${Number(val).toLocaleString()}`, ""]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="invoiced"
                      name={lang === "si" ? "විකුණුම් (Invoiced)" : "Invoiced (LKR)"}
                      stroke="#10a58d"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorInvoiced)"
                    />
                    <Area
                      type="monotone"
                      dataKey="collected"
                      name={lang === "si" ? "ලැබුණු මුදල් (Collected)" : "Collected (LKR)"}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorCollected)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 2. Payment Methods & Credit Aging Card */}
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3>{lang === "si" ? "ගෙවීම් ක්‍රම සහ ණය වයස්ගතවීම" : "Payment Methods & Credit Aging"}</h3>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Aging breakdown of receivables
                  </span>
                </div>
              </div>

              {/* Aging Buckets Bars */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                {[
                  {
                    label: lang === "si" ? "වත්මන් (දින 0 ඇතුළත)" : "Current (Not overdue)",
                    cents: charts.creditAging?.currentCents || 0,
                    color: "#16a34a",
                  },
                  {
                    label: lang === "si" ? "දින 1–15 කල් ඉකුත් වූ" : "1–15 Days Overdue",
                    cents: charts.creditAging?.days1_15Cents || 0,
                    color: "#f59e0b",
                  },
                  {
                    label: lang === "si" ? "දින 16–30 කල් ඉකුත් වූ" : "16–30 Days Overdue",
                    cents: charts.creditAging?.days16_30Cents || 0,
                    color: "#ea580c",
                  },
                  {
                    label: lang === "si" ? "දින 31–45 කල් ඉකුත් වූ" : "31–45 Days Overdue",
                    cents: charts.creditAging?.days31_45Cents || 0,
                    color: "#dc2626",
                  },
                  {
                    label: lang === "si" ? "දින 45 ට වැඩි (High Risk)" : "Over 45 Days Overdue",
                    cents: charts.creditAging?.over45Cents || 0,
                    color: "#7f1d1d",
                  },
                ].map((b) => (
                  <div key={b.label} style={{ fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ color: "#475569", fontWeight: 600 }}>{b.label}</span>
                      <strong style={{ color: b.color }}>{money(b.cents)}</strong>
                    </div>
                    <div style={{ width: "100%", height: 6, background: "#f1f5f9", borderRadius: 4 }}>
                      <div
                        style={{
                          width: `${Math.min(100, ((b.cents / Math.max(1, kpis.totalOutstandingCents || 1)) * 100))}%`,
                          height: "100%",
                          background: b.color,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Payment Methods Breakdown */}
              <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>
                  {lang === "si" ? "ගෙවීම් ක්‍රමය අනුව විකුණුම්" : "Sales by Payment Method"}
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 8 }}>
                  {(charts.paymentMethods || []).map((m: any) => (
                    <div
                      key={m.payment_method}
                      style={{
                        padding: "8px 10px",
                        background: "#f8fafc",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        textAlign: "center",
                      }}
                    >
                      <span style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>
                        {m.payment_method}
                      </span>
                      <strong style={{ display: "block", fontSize: 13, color: "#0f172a", marginTop: 2 }}>
                        {money(m.total_cents)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top 10 Products and Customers Tables Grid */}
          <div className="workspace-grid">
            {/* Top 10 Products */}
            <div className="panel">
              <div className="panel-head">
                <h3>{lang === "si" ? "වැඩිම විකුණුම් ලැබූ නිෂ්පාදන" : "Top 10 Selling Products"}</h3>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setActiveTab("products")}
                  style={{ padding: "4px 8px", fontSize: 11 }}
                >
                  {lang === "si" ? "සියල්ල බලන්න" : "View All"}
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ textAlign: "right" }}>Units</th>
                      <th style={{ textAlign: "right" }}>Revenue</th>
                      <th style={{ textAlign: "right" }}>Gross Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(charts.topProducts || []).slice(0, 7).map((p: any, i: number) => (
                      <tr key={p.name + p.label}>
                        <td>
                          <div style={{ fontWeight: 650 }}>{p.name}</div>
                          <span style={{ fontSize: 11, color: "#64748b" }}>{p.label}</span>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{p.units}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#10a58d" }}>
                          {money(p.revenue_cents)}
                        </td>
                        <td style={{ textAlign: "right", color: "#15803d" }}>
                          {money(p.profit_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top 10 Customers */}
            <div className="panel">
              <div className="panel-head">
                <h3>{lang === "si" ? "ප්‍රමුඛ පාරිභෝගික වෙළඳසැල්" : "Top Customer Accounts"}</h3>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setActiveTab("customers")}
                  style={{ padding: "4px 8px", fontSize: 11 }}
                >
                  {lang === "si" ? "සියල්ල බලන්න" : "View All"}
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th style={{ textAlign: "right" }}>Total Sales</th>
                      <th style={{ textAlign: "right" }}>Paid</th>
                      <th style={{ textAlign: "right" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(charts.topCustomers || []).slice(0, 7).map((c: any) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              if (onViewCustomer) onViewCustomer(c.id);
                            }}
                            style={{ fontWeight: 650, textAlign: "left" }}
                          >
                            {c.shop_name}
                          </button>
                          <span style={{ fontSize: 11, color: "#64748b", display: "block" }}>
                            {c.owner_name}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{money(c.invoiced_cents)}</td>
                        <td style={{ textAlign: "right", color: "#16a34a" }}>{money(c.paid_cents)}</td>
                        <td
                          style={{
                            textAlign: "right",
                            fontWeight: 700,
                            color: c.balance_cents > 0 ? "#b91c1c" : "#16a34a",
                          }}
                        >
                          {money(c.balance_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 2. DAILY SALES TAB (Detailed Day Dashboard + Drill-down) ────────── */}
      {activeTab === "daily-sales" && (
        <motion.div
          key="daily-sales"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* Day Selector and Actions */}
          <div className="panel" style={{ padding: "14px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Calendar size={18} color="#10a58d" />
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {lang === "si" ? "දිනපතා විකුණුම් දිනය තෝරන්න:" : "Select Date for Daily Sales Report:"}
                </span>
                <input
                  type="date"
                  value={dailySalesDate}
                  onChange={(e) => setDailySalesDate(e.target.value)}
                  style={{ width: 160, minHeight: 36, padding: "4px 10px" }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setDailySalesDate(getColomboDateString())}
                  style={{ padding: "5px 10px", fontSize: 12 }}
                >
                  {lang === "si" ? "අද දිනට යන්න" : "Jump to Today"}
                </button>
              </div>

              {/* Export Buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const invs = dailySalesQuery.data?.invoices || [];
                    const rows = invs.map((i: any) => [
                      i.number,
                      i.shop_name,
                      i.rep_name || "Unassigned",
                      (i.subtotal_cents / 100).toFixed(2),
                      ((i.item_discount_cents + i.invoice_discount_cents) / 100).toFixed(2),
                      (i.total_cents / 100).toFixed(2),
                      (i.paid_cents / 100).toFixed(2),
                      (i.balance_cents / 100).toFixed(2),
                      i.payment_method,
                      i.status,
                    ]);
                    exportExcel(`daily-sales-${dailySalesDate}`, `Daily Sales Report (${dailySalesDate})`, [
                      "Invoice Number",
                      "Shop Name",
                      "Sales Rep",
                      "Gross LKR",
                      "Discount LKR",
                      "Net Total LKR",
                      "Paid LKR",
                      "Balance LKR",
                      "Payment Method",
                      "Status",
                    ], rows);
                  }}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  <FileSpreadsheet size={15} /> Excel
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const invs = dailySalesQuery.data?.invoices || [];
                    const rows = invs.map((i: any) => [
                      i.number,
                      i.shop_name,
                      i.rep_name || "Unassigned",
                      (i.total_cents / 100).toFixed(2),
                      (i.paid_cents / 100).toFixed(2),
                      (i.balance_cents / 100).toFixed(2),
                      i.payment_method,
                    ]);
                    exportPDFReport(`Daily Sales Report - ${dailySalesDate}`, [
                      "Invoice #",
                      "Shop Name",
                      "Sales Rep",
                      "Total LKR",
                      "Paid LKR",
                      "Balance LKR",
                      "Method",
                    ], rows);
                  }}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  <Download size={15} /> PDF
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => window.print()}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  <Printer size={15} /> {lang === "si" ? "මුද්‍රණය" : "Print"}
                </button>
              </div>
            </div>
          </div>

          {/* Daily Sales KPI Cards */}
          {(() => {
            const sum = dailySalesQuery.data?.summary || {};
            return (
              <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div className="stat-card">
                  <div className="stat-top">
                    <small>{lang === "si" ? "ශුද්ධ විකුණුම් (Net Sales)" : "Net Sales Revenue"}</small>
                    <span className="stat-icon" style={{ color: "#10a58d" }}><DollarSign size={18} /></span>
                  </div>
                  <strong>{money(sum.netSalesCents || 0)}</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Gross: {money(sum.grossSalesCents || 0)}</span>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <small>{lang === "si" ? "වට්ටම් (Discounts)" : "Discounts Given"}</small>
                    <span className="stat-icon" style={{ color: "#f59e0b" }}><TrendingUp size={18} /></span>
                  </div>
                  <strong style={{ color: "#b45309" }}>{money(sum.totalDiscountsCents || 0)}</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Items + Invoice Discounts</span>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <small>{lang === "si" ? "අද එකතු කළ මුළු මුදල්" : "Total Collections Today"}</small>
                    <span className="stat-icon" style={{ color: "#16a34a" }}><CreditCard size={18} /></span>
                  </div>
                  <strong style={{ color: "#15803d" }}>{money(sum.totalCollectionsTodayCents || 0)}</strong>
                  <span style={{ fontSize: 11, color: "#166534" }}>
                    Same day: {money(sum.sameDayCollectionsCents || 0)}
                  </span>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <small>{lang === "si" ? "පසුගිය ණය එකතු කිරීම්" : "Prior Credit Collected"}</small>
                    <span className="stat-icon" style={{ color: "#2563eb" }}><Wallet size={18} /></span>
                  </div>
                  <strong style={{ color: "#1d4ed8" }}>{money(sum.previousCreditCollectionsCents || 0)}</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Old debts settled today</span>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <small>{lang === "si" ? "අද නිකුත් කළ ණය" : "New Credit Created"}</small>
                    <span className="stat-icon" style={{ color: "#dc2626" }}><AlertTriangle size={18} /></span>
                  </div>
                  <strong style={{ color: "#b91c1c" }}>{money(sum.outstandingCreatedTodayCents || 0)}</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Unpaid from today's invoices</span>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <small>{lang === "si" ? "විකිණූ පැකට් ප්‍රමාණය" : "Tea Packs Sold"}</small>
                    <span className="stat-icon" style={{ color: "#0891b2" }}><Package size={18} /></span>
                  </div>
                  <strong>{sum.itemsSoldQty || 0} Units</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Across {sum.invoiceCount || 0} Invoices</span>
                </div>
              </div>
            );
          })()}

          {/* Daily Sales Detailed Invoices Table with Drill-down */}
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "දවසේ නිකුත් කළ සියලුම ඉන්වොයිසි" : "Invoices Issued on This Date"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  Click row to view product breakdown and payment details
                </span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px", width: 36 }}></th>
                    <th style={{ padding: "10px 14px" }}>Invoice #</th>
                    <th style={{ padding: "10px 14px" }}>Shop Name</th>
                    <th style={{ padding: "10px 14px" }}>Sales Rep</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Gross</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Discount</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Net Total</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Paid</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Balance</th>
                    <th style={{ padding: "10px 14px" }}>Payment</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(dailySalesQuery.data?.invoices || []).length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", padding: 36, color: "#888" }}>
                        {lang === "si" ? "මෙම දිනයේ කිසිදු ඉන්වොයිසියක් නිකුත් කර නොමැත." : "No invoices found for this date."}
                      </td>
                    </tr>
                  ) : (
                    (dailySalesQuery.data?.invoices || []).map((inv: any) => {
                      const isExpanded = expandedInvoiceId === inv.id;
                      return (
                        <React.Fragment key={inv.id}>
                          <tr
                            style={{
                              borderBottom: isExpanded ? "none" : "1px solid #f1f5f9",
                              background: isExpanded ? "#f8fafc" : "transparent",
                              cursor: "pointer",
                            }}
                            onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          >
                            <td style={{ padding: "10px 14px" }}>
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </td>
                            <td style={{ padding: "10px 14px", fontWeight: 700, color: "#10a58d" }}>
                              {inv.number}
                            </td>
                            <td style={{ padding: "10px 14px", fontWeight: 600 }}>{inv.shop_name}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#475569" }}>
                              {inv.rep_name || "Unassigned"}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13 }}>
                              {money(inv.subtotal_cents || inv.total_cents)}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#b45309", fontSize: 13 }}>
                              {money((inv.item_discount_cents || 0) + (inv.invoice_discount_cents || 0))}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>
                              {money(inv.total_cents)}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#16a34a" }}>
                              {money(inv.paid_cents)}
                            </td>
                            <td
                              style={{
                                padding: "10px 14px",
                                textAlign: "right",
                                fontWeight: 700,
                                color: inv.balance_cents > 0 ? "#b91c1c" : "#16a34a",
                              }}
                            >
                              {money(inv.balance_cents)}
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <span
                                className="badge"
                                style={{
                                  textTransform: "capitalize",
                                  background: inv.payment_method === "credit" ? "#fff1e8" : "#e6f6ef",
                                  color: inv.payment_method === "credit" ? "#bf7044" : "#168064",
                                }}
                              >
                                {inv.payment_method}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "inline-flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ padding: "4px 8px", fontSize: 11 }}
                                  title="View Invoice"
                                  onClick={() => {
                                    if (onViewInvoice) onViewInvoice(inv.id);
                                    else setSelectedInvoiceId(inv.id);
                                  }}
                                >
                                  <Eye size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ padding: "4px 8px", fontSize: 11 }}
                                  title="Print"
                                  onClick={() => setSelectedInvoiceId(inv.id)}
                                >
                                  <Printer size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Drill-down line items section */}
                          {isExpanded && (
                            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                              <td colSpan={11} style={{ padding: "10px 24px 18px 48px" }}>
                                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                                    Line Items Breakdown ({inv.items?.length || 0} items)
                                  </span>
                                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr style={{ color: "#64748b", borderBottom: "1px solid #f1f5f9", textAlign: "left" }}>
                                        <th style={{ padding: "4px 8px" }}>Item Description</th>
                                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Quantity</th>
                                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Unit Price</th>
                                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Item Discount</th>
                                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Line Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(inv.items || []).map((it: any, i: number) => (
                                        <tr key={it.id || i} style={{ borderBottom: "1px solid #f8fafc" }}>
                                          <td style={{ padding: "4px 8px", fontWeight: 600 }}>
                                            {it.product_name} - {it.variant_label}
                                          </td>
                                          <td style={{ padding: "4px 8px", textAlign: "right" }}>{it.quantity} {it.unit}</td>
                                          <td style={{ padding: "4px 8px", textAlign: "right" }}>{money(it.unit_price_cents)}</td>
                                          <td style={{ padding: "4px 8px", textAlign: "right", color: "#b45309" }}>
                                            {money(it.item_discount_cents || 0)}
                                          </td>
                                          <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700, color: "#10a58d" }}>
                                            {money(it.line_cents)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily Collections Breakdown Table */}
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "අද දින ලැබුණු මුළු ගෙවීම් විස්තරය" : "All Payment Collections on This Date"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  Includes cash, bank transfers, and old credit settlements
                </span>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Time</th>
                    <th style={{ padding: "10px 14px" }}>Invoice #</th>
                    <th style={{ padding: "10px 14px" }}>Shop Name</th>
                    <th style={{ padding: "10px 14px" }}>Collector / Rep</th>
                    <th style={{ padding: "10px 14px" }}>Method</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Amount Collected</th>
                    <th style={{ padding: "10px 14px" }}>Collection Type</th>
                  </tr>
                </thead>
                <tbody>
                  {(dailySalesQuery.data?.payments || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "#888" }}>
                        No payments recorded on this date.
                      </td>
                    </tr>
                  ) : (
                    (dailySalesQuery.data?.payments || []).map((pay: any) => {
                      const isSameDay = pay.invoice_date === dailySalesDate;
                      return (
                        <tr key={pay.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 14px", fontSize: 12, color: "#64748b" }}>
                            {pay.created_at ? new Date(pay.created_at).toLocaleTimeString() : "-"}
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#10a58d" }}>
                            {pay.invoice_number}
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>{pay.shop_name}</td>
                          <td style={{ padding: "10px 14px", fontSize: 13 }}>{pay.rep_name || "Admin"}</td>
                          <td style={{ padding: "10px 14px" }}>
                            <span className="badge" style={{ textTransform: "capitalize" }}>
                              {pay.method}
                            </span>
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                            {money(pay.amount_cents)}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <span
                              className="badge"
                              style={{
                                background: isSameDay ? "#e6f6ef" : "#eff6ff",
                                color: isSameDay ? "#168064" : "#1d4ed8",
                              }}
                            >
                              {isSameDay ? "Same-Day Invoice" : "Prior Credit Settlement"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 3. REVENUE TAB ─────────────────────────────────────────────────── */}
      {activeTab === "revenue" && (
        <motion.div
          key="revenue"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "දින අනුව විකුණුම් හා ආදායම් සාරාංශය" : "Daily Revenue Breakdown"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>{from} to {to}</span>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const rows = (tabQuery.data?.rows || []).map((r: any) => [
                    r.date,
                    r.invoice_count,
                    (r.gross_cents / 100).toFixed(2),
                    (r.discount_cents / 100).toFixed(2),
                    (r.net_cents / 100).toFixed(2),
                    (r.paid_cents / 100).toFixed(2),
                    (r.cash_cents / 100).toFixed(2),
                    (r.bank_cents / 100).toFixed(2),
                    (r.credit_cents / 100).toFixed(2),
                  ]);
                  exportExcel("revenue-report", "Daily Revenue Report", [
                    "Date", "Invoices", "Gross LKR", "Discount LKR", "Net LKR", "Paid LKR", "Cash LKR", "Bank LKR", "Credit LKR"
                  ], rows);
                }}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                <Download size={14} /> Excel
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Date</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Invoices</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Gross</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Discount</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Net Total</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Collected</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Cash</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.rows || []).map((r: any) => (
                    <tr key={r.date} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>{r.date}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>{r.invoice_count}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>{money(r.gross_cents)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#b45309" }}>{money(r.discount_cents)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#10a58d" }}>
                        {money(r.net_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#16a34a" }}>{money(r.paid_cents)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>{money(r.cash_cents)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#ea580c" }}>{money(r.credit_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 4. CUSTOMERS TAB ───────────────────────────────────────────────── */}
      {activeTab === "customers" && (
        <motion.div
          key="customers"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "පාරිභෝගික වෙළඳසැල් මූල්‍ය විශ්ලේෂණය" : "Customer Ledger & Debt Analytics"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Sales volume, collections, outstanding and credit limits</span>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const rows = (tabQuery.data?.rows || []).map((c: any) => [
                    c.shop_name,
                    c.owner_name,
                    c.phone,
                    (c.total_invoiced_cents / 100).toFixed(2),
                    (c.total_paid_cents / 100).toFixed(2),
                    (c.outstanding_cents / 100).toFixed(2),
                    (c.overdue_cents / 100).toFixed(2),
                    (c.credit_limit_cents / 100).toFixed(2),
                    c.last_invoice_date || "-",
                  ]);
                  exportExcel("customers-analytics", "Customer Debt & Sales Report", [
                    "Shop Name", "Owner", "Phone", "Invoiced LKR", "Paid LKR", "Outstanding LKR", "Overdue LKR", "Credit Limit LKR", "Last Invoice"
                  ], rows);
                }}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                <Download size={14} /> Excel
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Shop Name</th>
                    <th style={{ padding: "10px 14px" }}>Owner & Phone</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Total Sales</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Paid</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Outstanding</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Overdue</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Credit Limit</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.rows || []).map((c: any) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>{c.shop_name}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12, color: "#64748b" }}>
                        {c.owner_name} · {c.phone}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>
                        {money(c.total_invoiced_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#16a34a" }}>
                        {money(c.total_paid_cents)}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: c.outstanding_cents > 0 ? "#b91c1c" : "#16a34a",
                        }}
                      >
                        {money(c.outstanding_cents)}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: c.overdue_cents > 0 ? "#dc2626" : "#64748b",
                        }}
                      >
                        {money(c.overdue_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        {money(c.credit_limit_cents || 0)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => {
                            if (onViewCustomer) onViewCustomer(c.id);
                          }}
                        >
                          Account Ledger
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 5. CREDIT & PAYMENTS TAB ────────────────────────────────────────── */}
      {activeTab === "credit-payments" && (
        <motion.div
          key="credit-payments"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* Overdue and Outstanding Invoices Table */}
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "සියලුම හිඟ සහ කල් ඉකුත් වූ ණය ඉන්වොයිසි" : "Unpaid & Overdue Invoices"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Track debts sorted by due date priority</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Invoice #</th>
                    <th style={{ padding: "10px 14px" }}>Shop Name</th>
                    <th style={{ padding: "10px 14px" }}>Sales Rep</th>
                    <th style={{ padding: "10px 14px" }}>Due Date</th>
                    <th style={{ padding: "10px 14px" }}>Aging</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Net Total</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Paid</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Outstanding Balance</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.outstandingInvoices || []).map((inv: any) => {
                    const isOverdue = (inv.overdue_days || 0) > 0;
                    return (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 700, color: "#10a58d" }}>{inv.number}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{inv.shop_name}</td>
                        <td style={{ padding: "10px 14px", fontSize: 12 }}>{inv.rep_name || "Unassigned"}</td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "#64748b" }}>
                          {inv.due_at ? new Date(inv.due_at).toLocaleDateString() : "-"}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span
                            className="badge"
                            style={{
                              background: isOverdue ? "#fee2e2" : "#e6f6ef",
                              color: isOverdue ? "#b91c1c" : "#168064",
                            }}
                          >
                            {isOverdue ? `${inv.overdue_days} Days Overdue` : "Current"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>{money(inv.total_cents)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#16a34a" }}>
                          {money(inv.paid_cents)}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#b91c1c" }}>
                          {money(inv.balance_cents)}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: "4px 8px", fontSize: 11 }}
                            onClick={() => setSelectedInvoiceId(inv.id)}
                          >
                            <Eye size={12} /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 6. PRODUCTS TAB ────────────────────────────────────────────────── */}
      {activeTab === "products" && (
        <motion.div
          key="products"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "නිෂ්පාදන විකුණුම් හා ලාභ ආන්තික" : "Product Sales & Profit Margins"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Units sold, revenue, COGS, and gross profit</span>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const rows = (tabQuery.data?.rows || []).map((p: any) => [
                    p.sku,
                    p.name,
                    p.label,
                    p.units_sold,
                    (p.revenue_cents / 100).toFixed(2),
                    (p.cogs_cents / 100).toFixed(2),
                    (p.gross_profit_cents / 100).toFixed(2),
                    p.current_stock,
                  ]);
                  exportExcel("product-sales", "Product Sales & Profit", [
                    "SKU", "Product", "Variant", "Units Sold", "Revenue LKR", "COGS LKR", "Gross Profit LKR", "Current Stock"
                  ], rows);
                }}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                <Download size={14} /> Excel
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Product & SKU</th>
                    <th style={{ padding: "10px 14px" }}>Pack Size</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Units Sold</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Revenue</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Cost (COGS)</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Gross Profit</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Current Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.rows || []).map((p: any) => (
                    <tr key={p.sku + p.label} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <span style={{ fontSize: 11, color: "#64748b" }}>SKU: {p.sku}</span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>{p.label}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{p.units_sold}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#10a58d" }}>
                        {money(p.revenue_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>{money(p.cogs_cents)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>
                        {money(p.gross_profit_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600 }}>
                        {p.current_stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 7. INVENTORY TAB ────────────────────────────────────────────────── */}
      {activeTab === "inventory" && (
        <motion.div
          key="inventory"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "වත්මන් තොග ශේෂයන් සහ වටිනාකම" : "Current Stock Balances & Valuation"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Stock count across Main warehouse and sales vans</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Warehouse</th>
                    <th style={{ padding: "10px 14px" }}>Product</th>
                    <th style={{ padding: "10px 14px" }}>Variant</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Quantity</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Wholesale Value</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Cost Value</th>
                    <th style={{ padding: "10px 14px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.balances || []).map((s: any, idx: number) => {
                    const isLow = s.quantity <= (s.low_stock || 0);
                    return (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{s.warehouse_name}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 700 }}>{s.product_name}</td>
                        <td style={{ padding: "10px 14px" }}>{s.label}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{s.quantity} {s.unit}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#10a58d" }}>
                          {money(s.wholesale_value_cents)}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>{money(s.cost_value_cents)}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span
                            className="badge"
                            style={{
                              background: isLow ? "#fee2e2" : "#e6f6ef",
                              color: isLow ? "#b91c1c" : "#168064",
                            }}
                          >
                            {isLow ? "Low Stock" : "Healthy"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 8. SALES REPS TAB ──────────────────────────────────────────────── */}
      {activeTab === "sales-reps" && (
        <motion.div
          key="sales-reps"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "විකුණුම් නියෝජිත කාර්ය සාධනය" : "Sales Representative Performance"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Sales volume, collections, and assigned shops</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Representative Name</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Invoices</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Assigned Shops</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Total Sales</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Collections</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.reps || []).map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>{r.name}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>{r.invoice_count}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>{r.assigned_shops}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#10a58d" }}>
                        {money(r.sales_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#16a34a" }}>
                        {money(r.collected_cents)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#b91c1c" }}>
                        {money(r.outstanding_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 9. FREE ISSUES TAB ─────────────────────────────────────────────── */}
      {activeTab === "free-issues" && (
        <motion.div
          key="free-issues"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "නොමිලේ නිකුත් කිරීම් (Free Issues)" : "Free Samples & Promotional Issues"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Zero-revenue promotional sample records</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Reference</th>
                    <th style={{ padding: "10px 14px" }}>Date</th>
                    <th style={{ padding: "10px 14px" }}>Shop Name</th>
                    <th style={{ padding: "10px 14px" }}>Issued By / Rep</th>
                    <th style={{ padding: "10px 14px" }}>Reason</th>
                    <th style={{ padding: "10px 14px" }}>Items</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.rows || []).map((fi: any) => (
                    <tr key={fi.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#10a58d" }}>{fi.reference_number}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{fi.issue_date}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>{fi.shop_name}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{fi.rep_name || "-"}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span className="badge" style={{ textTransform: "capitalize" }}>{fi.reason}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{fi.items_detail || "-"}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#64748b" }}>
                        {money(fi.total_cost_cents || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 10. CONSIGNMENTS TAB ───────────────────────────────────────────── */}
      {activeTab === "consignments" && (
        <motion.div
          key="consignments"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <div>
                <h3>{lang === "si" ? "විකුණා ගෙවීම් (Consignments)" : "Consignment / Sale or Return Tracking"}</h3>
                <span className="muted" style={{ fontSize: 12 }}>Goods placed at customer shops pending settlement</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Reference</th>
                    <th style={{ padding: "10px 14px" }}>Date</th>
                    <th style={{ padding: "10px 14px" }}>Shop Name</th>
                    <th style={{ padding: "10px 14px" }}>Rep</th>
                    <th style={{ padding: "10px 14px" }}>Status</th>
                    <th style={{ padding: "10px 14px" }}>Items</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.rows || []).map((c: any) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#10a58d" }}>{c.reference_number}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{c.issue_date}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>{c.shop_name}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{c.rep_name || "-"}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span className="badge" style={{ textTransform: "capitalize" }}>{c.status}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{c.items_detail || "-"}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>
                        {money(c.total_value_cents || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 11. EXPENSES TAB ───────────────────────────────────────────────── */}
      {activeTab === "expenses" && (
        <motion.div
          key="expenses"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* Expenses Category Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {(tabQuery.data?.categories || []).map((cat: any) => (
              <div
                key={cat.category}
                style={{
                  background: "#ffffff",
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ fontSize: 12, color: "#64748b", textTransform: "capitalize" }}>{cat.category}</span>
                <strong style={{ display: "block", fontSize: 17, color: "#b91c1c", marginTop: 4 }}>
                  {money(cat.total_cents)}
                </strong>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{cat.count} transactions</span>
              </div>
            ))}
          </div>

          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-head" style={{ padding: "16px 20px 10px" }}>
              <h3>{lang === "si" ? "වියදම් ලේඛනය" : "Operating Expenses Ledger"}</h3>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Date</th>
                    <th style={{ padding: "10px 14px" }}>Category</th>
                    <th style={{ padding: "10px 14px" }}>Description</th>
                    <th style={{ padding: "10px 14px" }}>Method</th>
                    <th style={{ padding: "10px 14px" }}>Recorded By</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(tabQuery.data?.rows || []).map((e: any) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{e.date}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span className="badge" style={{ textTransform: "capitalize" }}>{e.category}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>{e.description}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12, textTransform: "capitalize" }}>{e.method}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{e.created_by_name || "-"}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#b91c1c" }}>
                        {money(e.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 12. PROFIT & LOSS TAB ──────────────────────────────────────────── */}
      {activeTab === "profit-loss" && (
        <motion.div
          key="profit-loss"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {(() => {
            const pnl = tabQuery.data || {};
            const rev = pnl.revenue || {};
            return (
              <div className="panel" style={{ maxWidth: 800, margin: "0 auto", padding: 28 }}>
                <div style={{ textAlign: "center", marginBottom: 24, borderBottom: "1px solid #e2e8f0", paddingBottom: 16 }}>
                  <h3 style={{ fontSize: 20, color: "#0f172a" }}>
                    Nugathalawa Ceylon Tea Export (Pvt) Ltd
                  </h3>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#10a58d", marginTop: 4 }}>
                    {lang === "si" ? "ලාභ හා අලාභ ගිණුම් ප්‍රකාශනය" : "Statement of Profit or Loss"}
                  </div>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    For the period from {from} to {to}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
                  {/* Revenue Section */}
                  <div style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                      <span>Gross Sales Revenue (දළ විකුණුම්)</span>
                      <span>{money(rev.grossSalesCents || 0)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#b45309", paddingLeft: 16, marginTop: 4 }}>
                      <span>Less: Discounts Allowed (අඩුකළ වට්ටම්)</span>
                      <span>({money(rev.discountsCents || 0)})</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#b45309", paddingLeft: 16, marginTop: 4 }}>
                      <span>Less: Sales Returns & Credit Notes (ආපසු ලැබුණු භාණ්ඩ)</span>
                      <span>({money(rev.returnsCents || 0)})</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 750, marginTop: 8, color: "#10a58d" }}>
                      <span>Net Sales Revenue (ශුද්ධ විකුණුම් ආදායම)</span>
                      <span>{money(rev.netSalesCents || 0)}</span>
                    </div>
                  </div>

                  {/* COGS & Gross Profit */}
                  <div style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#b91c1c" }}>
                      <span>Less: Cost of Goods Sold - COGS (විකිණූ භාණ්ඩවල පිරිවැය)</span>
                      <span>({money(pnl.costOfGoodsSoldCents || 0)})</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15, marginTop: 10, color: "#15803d" }}>
                      <span>Gross Profit (දළ ලාභය)</span>
                      <span>{money(pnl.grossProfitCents || 0)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      Gross Margin: <b>{pnl.grossProfitMarginPercent || "0.0"}%</b>
                    </div>
                  </div>

                  {/* Operating Expenses */}
                  <div style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: 10 }}>
                    <span style={{ fontWeight: 700, color: "#334155" }}>Operating Expenses (මෙහෙයුම් වියදම්)</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingLeft: 16 }}>
                      {(pnl.expenses || []).map((e: any) => (
                        <div key={e.category} style={{ display: "flex", justifyContent: "space-between", color: "#475569" }}>
                          <span style={{ textTransform: "capitalize" }}>{e.category} Expenses</span>
                          <span>{money(e.amount_cents)}</span>
                        </div>
                      ))}
                      {(pnl.expenses || []).length === 0 && (
                        <span style={{ color: "#94a3b8" }}>No operating expenses recorded.</span>
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 10, color: "#b91c1c" }}>
                      <span>Total Operating Expenses (මුළු මෙහෙයුම් වියදම්)</span>
                      <span>({money(pnl.totalExpensesCents || 0)})</span>
                    </div>
                  </div>

                  {/* Net Operating Profit */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 800,
                      fontSize: 17,
                      padding: "14px 18px",
                      background: (pnl.netOperatingProfitCents || 0) >= 0 ? "#f0fdf4" : "#fef2f2",
                      border: `1px solid ${(pnl.netOperatingProfitCents || 0) >= 0 ? "#bbf7d0" : "#fecaca"}`,
                      borderRadius: 10,
                      color: (pnl.netOperatingProfitCents || 0) >= 0 ? "#15803d" : "#b91c1c",
                      marginTop: 6,
                    }}
                  >
                    <span>Net Operating Profit / (Loss) (ශුද්ධ මෙහෙයුම් ලාභය)</span>
                    <span>{money(pnl.netOperatingProfitCents || 0)}</span>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#64748b" }}>
                    Net Operating Margin: <b>{pnl.netMarginPercent || "0.0"}%</b>
                  </div>
                </div>
              </div>
            );
          })()}
        </motion.div>
      )}
    </div>
  );
}
