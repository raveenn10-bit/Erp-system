"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Search,
  Printer,
  Share2,
  Download,
  Eye,
  Gift,
  PackageCheck,
  CreditCard,
  RotateCcw,
  Calendar,
  Building2,
} from "lucide-react";
import { api, money } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { InvoiceActions } from "@/components/invoice-actions";
import { printReceiptViaBrowser } from "@/lib/thermal-printer";

type InvoiceItem = {
  id: string;
  number: string;
  shop_name: string;
  total_cents: number;
  paid_cents: number;
  due_at: string | null;
  status: string;
  created_at: string;
};

type FreeIssueItem = {
  id: string;
  invoice_id?: string;
  customer_name?: string;
  shop_name?: string;
  product_name?: string;
  quantity?: number;
  created_at: string;
};

type ConsignmentItem = {
  id: string;
  shop_name?: string;
  customer_name?: string;
  total_cents?: number;
  status?: string;
  created_at: string;
};

export function DocumentCenterPanel({
  onViewInvoice,
}: {
  onViewInvoice?: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const [docType, setDocType] = useState<"invoices" | "free_issues" | "consignments" | "credit_notes">("invoices");
  const [search, setSearch] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api<InvoiceItem[]>("/invoices"),
  });

  const freeIssues = useQuery({
    queryKey: ["free-issues"],
    queryFn: () => api<FreeIssueItem[]>("/free-issues"),
  });

  const consignments = useQuery({
    queryKey: ["consignments"],
    queryFn: () => api<ConsignmentItem[]>("/consignments"),
  });

  const filteredInvoices = (invoices.data || []).filter(
    (inv) =>
      inv.number.toLowerCase().includes(search.toLowerCase()) ||
      (inv.shop_name && inv.shop_name.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredFreeIssues = (freeIssues.data || []).filter(
    (fi) =>
      (fi.shop_name && fi.shop_name.toLowerCase().includes(search.toLowerCase())) ||
      (fi.customer_name && fi.customer_name.toLowerCase().includes(search.toLowerCase())) ||
      (fi.product_name && fi.product_name.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredConsignments = (consignments.data || []).filter(
    (c) =>
      (c.shop_name && c.shop_name.toLowerCase().includes(search.toLowerCase())) ||
      (c.customer_name && c.customer_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {selectedInvoiceId && (
        <InvoiceActions
          id={selectedInvoiceId}
          close={() => setSelectedInvoiceId(null)}
        />
      )}

      <div className="section-lead">
        <div>
          <h2>{lang === "si" ? "ලේඛන කළමනාකරණ මධ්‍යස්ථානය" : "Document Center"}</h2>
          <p>
            {lang === "si"
              ? "ඉන්වොයිසි, රිසිට්පත්, නොමිලේ තේ පැකට් සහ තොග බෙදාහැරීමේ සියලුම ලේඛන එකම තැනකින්"
              : "Access, print, and share all invoices, receipts, and consignment documents."}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className={docType === "invoices" ? "primary" : "secondary"}
          onClick={() => setDocType("invoices")}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <FileText size={16} />
          {lang === "si" ? "ඉන්වොයිසි සහ බිල්පත්" : "Invoices & Bills"}
        </button>
        <button
          className={docType === "free_issues" ? "primary" : "secondary"}
          onClick={() => setDocType("free_issues")}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <Gift size={16} />
          {lang === "si" ? "නොමිලේ නිකුත් කිරීම් (Free Issues)" : "Free Issues"}
        </button>
        <button
          className={docType === "consignments" ? "primary" : "secondary"}
          onClick={() => setDocType("consignments")}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <PackageCheck size={16} />
          {lang === "si" ? "තොග බෙදාහැරීම් (Consignments)" : "Consignments"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 400 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "#666" }} />
          <input
            type="search"
            placeholder={lang === "si" ? "ලේඛන අංකය හෝ කඩයේ නම සොයන්න..." : "Search document or shop name..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36, width: "100%", margin: 0 }}
          />
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {docType === "invoices" && (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", margin: 0 }}>
              <thead>
                <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "අංකය" : "Number"}</th>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "වෙළඳසැල" : "Shop"}</th>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "දිනය" : "Date"}</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>{lang === "si" ? "මුළු මුදල" : "Total"}</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>{lang === "si" ? "ගෙවූ මුදල" : "Paid"}</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>{lang === "si" ? "හිඟ මුදල" : "Balance"}</th>
                  <th style={{ padding: "12px 16px", textAlign: "center" }}>{lang === "si" ? "ක්‍රියාකාරකම්" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "#888" }}>
                      {lang === "si" ? "කිසිදු ඉන්වොයිසියක් හමු නොවීය" : "No invoices found"}
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const balance = inv.total_cents - inv.paid_cents;
                    return (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#10a58d" }}>
                          {inv.number}
                        </td>
                        <td style={{ padding: "12px 16px", fontWeight: 600 }}>{inv.shop_name}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>
                          {new Date(inv.created_at).toLocaleDateString("en-GB")}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700 }}>
                          {money(inv.total_cents)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#15803d" }}>
                          {money(inv.paid_cents)}
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: balance > 0 ? "#b91c1c" : "#15803d",
                          }}
                        >
                          {money(balance)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <button
                              className="secondary"
                              style={{ padding: "4px 8px", fontSize: 12 }}
                              title={lang === "si" ? "A4 මුද්‍රණය සහ බැලීම" : "View & A4 Print"}
                              onClick={() => {
                                if (onViewInvoice) onViewInvoice(inv.id);
                                else setSelectedInvoiceId(inv.id);
                              }}
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              className="secondary"
                              style={{ padding: "4px 8px", fontSize: 12 }}
                              title={lang === "si" ? "Thermal රිසිට්පත මුද්‍රණය" : "Thermal Receipt"}
                              onClick={() => setSelectedInvoiceId(inv.id)}
                            >
                              <Printer size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {docType === "free_issues" && (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", margin: 0 }}>
              <thead>
                <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "වෙළඳසැල" : "Shop"}</th>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "තේ නිෂ්පාදනය" : "Tea Product"}</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>{lang === "si" ? "ප්‍රමාණය" : "Quantity"}</th>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "දිනය" : "Date"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredFreeIssues.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#888" }}>
                      {lang === "si" ? "නොමිලේ නිකුත් කිරීම් හමු නොවීය" : "No free issue records found"}
                    </td>
                  </tr>
                ) : (
                  filteredFreeIssues.map((fi, idx) => (
                    <tr key={fi.id || idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {fi.shop_name || fi.customer_name || "-"}
                      </td>
                      <td style={{ padding: "12px 16px" }}>{fi.product_name || "Tea Sample"}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700 }}>
                        {fi.quantity || 1}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>
                        {new Date(fi.created_at).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {docType === "consignments" && (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", margin: 0 }}>
              <thead>
                <tr style={{ background: "rgba(16, 165, 141, 0.08)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "වෙළඳසැල" : "Shop"}</th>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "තත්ත්වය" : "Status"}</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>{lang === "si" ? "වටිනාකම" : "Value"}</th>
                  <th style={{ padding: "12px 16px" }}>{lang === "si" ? "දිනය" : "Date"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredConsignments.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#888" }}>
                      {lang === "si" ? "තොග බෙදාහැරීම් හමු නොවීය" : "No consignment records found"}
                    </td>
                  </tr>
                ) : (
                  filteredConsignments.map((c, idx) => (
                    <tr key={c.id || idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {c.shop_name || c.customer_name || "-"}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span className="badge">{c.status || "active"}</span>
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700 }}>
                        {money(c.total_cents || 0)}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>
                        {new Date(c.created_at).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
