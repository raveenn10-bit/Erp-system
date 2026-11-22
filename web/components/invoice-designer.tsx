"use client";

import React, { useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Printer,
  Receipt,
  MessageCircle,
  Settings,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Share2,
  Bluetooth,
  CheckCircle,
  AlertCircle,
  FileText,
} from "lucide-react";
import { api, formatWhatsApp, money, normalizeWhatsApp } from "@/lib/api";
import {
  ThermalSettings,
  DEFAULT_THERMAL_SETTINGS,
  getThermalSettings,
  saveThermalSettings,
  buildEscPosBuffer,
  printViaBluetooth,
  printReceiptViaBrowser,
  isBluetoothSupported,
} from "@/lib/thermal-printer";

// --- Vector Branding Components ---

export function TeaLeafLogo({ size = 44, color = "#16a34a" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "inline-block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="leafGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#15803d" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#84cc16" />
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#84cc16" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
      </defs>
      {/* Primary Leaf Curve */}
      <path
        d="M12 52C16 36 28 20 52 12C50 32 38 48 16 52Z"
        fill="url(#leafGrad)"
      />
      {/* Secondary Inner Leaf Accent */}
      <path
        d="M20 48C24 38 32 28 46 22C44 34 36 44 24 48Z"
        fill="url(#accentGrad)"
        opacity="0.9"
      />
      {/* Central Leaf Vein */}
      <path
        d="M14 52C26 40 38 30 52 12"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* Subtle dewdrop accent */}
      <circle cx="44" cy="20" r="2.5" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}

export function BottomCornerSwoosh() {
  return (
    <svg
      width="220"
      height="140"
      viewBox="0 0 220 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <defs>
        <linearGradient id="swoosh1" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#15803d" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#22c55e" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#84cc16" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="swoosh2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#84cc16" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {/* Secondary softer swoosh */}
      <path
        d="M0 140C40 130 90 100 130 60C170 20 200 0 220 0C160 30 90 70 0 110V140Z"
        fill="url(#swoosh2)"
      />
      {/* Primary prominent organic leaf wave matching reference image */}
      <path
        d="M0 140C50 140 100 120 140 80C175 45 195 20 200 0C150 40 80 85 0 95V140Z"
        fill="url(#swoosh1)"
      />
    </svg>
  );
}

// --- Invoice Data Interface ---

export interface InvoiceViewData {
  number: string;
  invoiceDate: string;
  dueAt: string | null;
  shopName: string;
  customerPhone?: string;
  customerWhatsapp?: string;
  customerAddress?: string;
  repName?: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  businessWhatsapp?: string;
  businessEmail?: string;
  paymentMethod: string;
  paymentTerms?: string;
  notes?: string;
  terms?: string;
  subtotalCents: number;
  itemDiscountCents: number;
  invoiceDiscountCents: number;
  totalCents: number;
  paidCents: number;
  items: Array<{
    id?: string;
    name: string;
    variantLabel?: string;
    sku?: string;
    quantity: number;
    unitPriceCents: number;
    shopPriceCents?: number;
    itemDiscountCents?: number;
    lineCents: number;
    priceType?: string;
  }>;
  shareToken?: string;
}

// --- 1. A4 Invoice View (Matching Reference Image) ---

export function A4InvoiceView({
  data,
  showShopPrice = false,
  showCustomerWhatsapp = true,
  accentColor = "#16a34a",
}: {
  data: InvoiceViewData;
  showShopPrice?: boolean;
  showCustomerWhatsapp?: boolean;
  accentColor?: string;
}) {
  const balanceCents = Math.max(0, data.totalCents - data.paidCents);
  const totalDiscountCents = data.itemDiscountCents + data.invoiceDiscountCents;
  const activeWhatsapp = data.customerWhatsapp || data.customerPhone || "";

  return (
    <div
      className="a4-invoice-container"
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: "16mm 18mm 16mm 18mm",
        margin: "0 auto",
        background: "#ffffff",
        color: "#1f2937",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
      }}
    >
      {/* Top Header Section */}
      <div>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "18px",
          }}
        >
          {/* Company Brand (Left) */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
            <TeaLeafLogo size={52} color={accentColor} />
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "19px",
                  fontWeight: 800,
                  color: "#111827",
                  letterSpacing: "-0.2px",
                  lineHeight: 1.2,
                }}
              >
                {data.businessName || "Nugathalawa Ceylon Tea Export (Pvt) Ltd"}
              </h1>
              <div
                style={{
                  fontSize: "10.5px",
                  fontWeight: 600,
                  color: "#16a34a",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  marginTop: "2px",
                }}
              >
                Pure Ceylon Tea & Spices
              </div>
              <div
                style={{
                  fontSize: "10.5px",
                  color: "#6b7280",
                  marginTop: "4px",
                  lineHeight: 1.35,
                }}
              >
                {data.businessAddress || "Na Sewana, Hamangalla, Narangoda, Sri Lanka"}
                <br />
                P: {data.businessPhone || "076 661 5492"} &nbsp;|&nbsp; W:{" "}
                {data.businessWhatsapp || "076 696 5493"}
              </div>
            </div>
          </div>

          {/* Large INVOICE Title (Right, matching reference image) */}
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "34px",
                fontWeight: 900,
                color: "#16a34a",
                letterSpacing: "2px",
                lineHeight: 1,
              }}
            >
              INVOICE
            </div>
            <div
              style={{
                marginTop: "10px",
                fontSize: "11.5px",
                lineHeight: 1.6,
                color: "#374151",
              }}
            >
              <div>
                <b style={{ color: "#111827" }}>Invoice No :</b> #{data.number}
              </div>
              <div>
                <b style={{ color: "#111827" }}>Invoice Date :</b> {data.invoiceDate}
              </div>
              {data.dueAt && (
                <div>
                  <b style={{ color: "#16a34a" }}>Due Date :</b> {data.dueAt}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Customer / Invoice To Section */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            padding: "10px 0 14px",
            borderTop: "1px solid #f0fdf4",
            marginBottom: "12px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#16a34a",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Invoice to
            </div>
            <div
              style={{
                fontSize: "17px",
                fontWeight: 800,
                color: "#111827",
                marginTop: "2px",
              }}
            >
              {data.shopName || "Valued Customer"}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "#4b5563",
                marginTop: "4px",
                lineHeight: 1.45,
              }}
            >
              {data.customerPhone && (
                <div>
                  <b style={{ color: "#374151" }}>P :</b> {data.customerPhone}
                </div>
              )}
              {showCustomerWhatsapp && activeWhatsapp && (
                <div>
                  <b style={{ color: "#16a34a" }}>W :</b> {formatWhatsApp(activeWhatsapp)}
                </div>
              )}
              {data.customerAddress && (
                <div>
                  <b style={{ color: "#374151" }}>A :</b> {data.customerAddress}
                </div>
              )}
            </div>
          </div>

          {data.repName && (
            <div style={{ textAlign: "right", fontSize: "11px", color: "#6b7280" }}>
              <b>Sales Representative:</b>
              <div style={{ color: "#111827", fontWeight: 600 }}>{data.repName}</div>
            </div>
          )}
        </div>

        {/* Product Table (Gradient header & alternating rows matching reference) */}
        <div style={{ width: "100%", marginBottom: "18px" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "11.5px",
            }}
          >
            <thead>
              <tr
                style={{
                  background: "linear-gradient(90deg, #74c044 0%, #16a34a 100%)",
                  color: "#ffffff",
                  borderRadius: "6px",
                }}
              >
                <th
                  style={{
                    padding: "9px 12px",
                    textAlign: "left",
                    fontWeight: 700,
                    letterSpacing: "0.3px",
                    borderTopLeftRadius: "6px",
                    borderBottomLeftRadius: "6px",
                  }}
                >
                  Product Description
                </th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700 }}>
                  Price
                </th>
                <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700 }}>
                  Qty.
                </th>
                {showShopPrice && (
                  <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700 }}>
                    Shop Price
                  </th>
                )}
                <th
                  style={{
                    padding: "9px 12px",
                    textAlign: "right",
                    fontWeight: 700,
                    borderTopRightRadius: "6px",
                    borderBottomRightRadius: "6px",
                  }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, idx) => {
                const isEven = idx % 2 === 1;
                return (
                  <tr
                    key={item.id || idx}
                    style={{
                      background: isEven ? "#f4fbf5" : "#ffffff",
                      borderBottom: "1px solid #f0fdf4",
                    }}
                  >
                    <td style={{ padding: "8px 12px", color: "#1f2937", verticalAlign: "middle" }}>
                      <div style={{ fontWeight: 600, color: "#111827" }}>{item.name}</div>
                      {item.variantLabel && (
                        <div style={{ fontSize: "10px", color: "#6b7280" }}>
                          Pack Size: {item.variantLabel} {item.sku ? `(SKU: ${item.sku})` : ""}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        textAlign: "right",
                        color: "#374151",
                        verticalAlign: "middle",
                      }}
                    >
                      {money(item.unitPriceCents)}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        textAlign: "center",
                        fontWeight: 600,
                        color: "#111827",
                        verticalAlign: "middle",
                      }}
                    >
                      {item.quantity}
                    </td>
                    {showShopPrice && (
                      <td
                        style={{
                          padding: "8px 12px",
                          textAlign: "right",
                          color: "#6b7280",
                          verticalAlign: "middle",
                        }}
                      >
                        {item.shopPriceCents ? money(item.shopPriceCents) : "—"}
                      </td>
                    )}
                    <td
                      style={{
                        padding: "8px 12px",
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#111827",
                        verticalAlign: "middle",
                      }}
                    >
                      {money(item.lineCents)}
                      {item.itemDiscountCents && item.itemDiscountCents > 0 ? (
                        <div style={{ fontSize: "9.5px", color: "#dc2626", fontWeight: "normal" }}>
                          - {money(item.itemDiscountCents)}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Lower Summary Grid (Contact Badges on Left, Totals on Right) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr",
            gap: "24px",
            alignItems: "flex-start",
            marginTop: "10px",
          }}
        >
          {/* Left Column: Contact Badges & Corner Vector Art */}
          <div style={{ position: "relative", minHeight: "140px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", zIndex: 1, position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "11px", color: "#4b5563" }}>
                <span
                  style={{
                    width: "22px",
                    height: "22px",
                    background: "#16a34a",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "11px",
                    flexShrink: 0,
                  }}
                >
                  📞
                </span>
                <span>{data.businessPhone || "076 661 5492"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "11px", color: "#4b5563" }}>
                <span
                  style={{
                    width: "22px",
                    height: "22px",
                    background: "#16a34a",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "11px",
                    flexShrink: 0,
                  }}
                >
                  💬
                </span>
                <span>WhatsApp: {data.businessWhatsapp || "076 696 5493"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "11px", color: "#4b5563" }}>
                <span
                  style={{
                    width: "22px",
                    height: "22px",
                    background: "#16a34a",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "11px",
                    flexShrink: 0,
                  }}
                >
                  📍
                </span>
                <span>{data.businessAddress || "Na Sewana, Hamangalla, Narangoda, Sri Lanka"}</span>
              </div>
            </div>

            {/* Decorative organic green swoosh in bottom left */}
            <BottomCornerSwoosh />
          </div>

          {/* Right Column: Totals & Highlighted TOTAL Bar */}
          <div>
            <div style={{ width: "100%", fontSize: "12px", lineHeight: 1.8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563" }}>
                <span>Subtotal</span>
                <b>{money(data.subtotalCents)}</b>
              </div>

              {totalDiscountCents > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#dc2626" }}>
                  <span>Discounts</span>
                  <b>- {money(totalDiscountCents)}</b>
                </div>
              )}

              {/* Highlighted Green TOTAL Bar matching reference image */}
              <div
                style={{
                  background: "linear-gradient(90deg, #74c044 0%, #16a34a 100%)",
                  color: "#ffffff",
                  padding: "8px 14px",
                  borderRadius: "4px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  margin: "8px 0 12px",
                  fontSize: "14px",
                  fontWeight: 800,
                  letterSpacing: "0.5px",
                }}
              >
                <span>TOTAL</span>
                <span style={{ fontSize: "16px" }}>{money(data.totalCents)}</span>
              </div>

              {/* Payment Details */}
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  fontSize: "11px",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: "#16a34a",
                    marginBottom: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
                  }}
                >
                  Payment Info:
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span style={{ color: "#6b7280" }}>Method:</span>
                  <b style={{ textTransform: "capitalize" }}>{data.paymentMethod}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span style={{ color: "#6b7280" }}>Paid Amount:</span>
                  <b style={{ color: "#16a34a" }}>{money(data.paidCents)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span style={{ color: "#6b7280" }}>Balance Due:</span>
                  <b style={{ color: balanceCents > 0 ? "#dc2626" : "#16a34a" }}>
                    {money(balanceCents)}
                  </b>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer: Terms & Dual Signatures */}
      <footer style={{ marginTop: "24px", paddingTop: "14px", borderTop: "1px solid #e5e7eb" }}>
        {data.terms && (
          <div style={{ marginBottom: "20px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#16a34a",
                marginBottom: "3px",
              }}
            >
              Terms & Conditions
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "9.5px",
                color: "#6b7280",
                lineHeight: 1.45,
              }}
            >
              {data.terms}
            </p>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "40px",
            marginTop: "16px",
            paddingTop: "24px",
          }}
        >
          <div style={{ textAlign: "center", borderTop: "1px dashed #9ca3af", paddingTop: "6px" }}>
            <span style={{ fontSize: "10.5px", color: "#4b5563", fontWeight: 600 }}>
              Issued By / Authorized Signature
            </span>
          </div>
          <div style={{ textAlign: "center", borderTop: "1px dashed #9ca3af", paddingTop: "6px" }}>
            <span style={{ fontSize: "10.5px", color: "#4b5563", fontWeight: 600 }}>
              Received By / Customer Signature
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// --- 2. Thermal Receipt View (for 58mm / 80mm POS Roll) ---

export function ThermalReceiptView({
  data,
  settings,
  receiptId = "printable-thermal-receipt",
}: {
  data: InvoiceViewData;
  settings?: ThermalSettings;
  receiptId?: string;
}) {
  const s = settings || getThermalSettings();
  const widthMm = s.paperWidth === "80mm" ? 80 : s.paperWidth === "custom" ? s.customWidthMm : 58;
  const balanceCents = Math.max(0, data.totalCents - data.paidCents);
  const totalDiscountCents = data.itemDiscountCents + data.invoiceDiscountCents;

  return (
    <div
      id={receiptId}
      className="thermal-receipt-preview"
      style={{
        width: `${widthMm}mm`,
        margin: "0 auto",
        background: "#ffffff",
        color: "#000000",
        padding: "4mm 3mm",
        fontFamily: 'Courier, "Courier New", monospace, -apple-system, sans-serif',
        fontSize: s.fontSize === "small" ? "10px" : s.fontSize === "large" ? "13px" : "11px",
        lineHeight: 1.35,
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
        border: "1px solid #e5e7eb",
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        {s.showLogo && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "4px" }}>
            <TeaLeafLogo size={36} color="#000000" />
          </div>
        )}
        <div style={{ fontWeight: "bold", fontSize: "1.15em", textTransform: "uppercase" }}>
          {data.businessName || "NUGATHALAWA CEYLON TEA"}
        </div>
        <div style={{ fontSize: "0.85em" }}>
          {data.businessAddress || "Hamangalla, Narangoda"}
        </div>
        <div style={{ fontSize: "0.85em" }}>Tel: {data.businessPhone || "076 661 5492"}</div>
      </div>

      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />

      <div style={{ textAlign: "center", fontWeight: "bold", margin: "3px 0" }}>
        SALES RECEIPT / කුඩා බිල්පත
      </div>

      <div style={{ fontSize: "0.9em", margin: "4px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Inv: #{data.number}</span>
          <span>{data.invoiceDate}</span>
        </div>
        <div>Customer: {data.shopName}</div>
        {data.customerWhatsapp && <div>WhatsApp: {formatWhatsApp(data.customerWhatsapp)}</div>}
        {data.repName && <div>Rep: {data.repName}</div>}
      </div>

      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />

      {/* Items list */}
      <div style={{ margin: "4px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
          <span>ITEM</span>
          <span>TOTAL</span>
        </div>
        <div style={{ borderTop: "1px dotted #666", margin: "2px 0" }} />

        {data.items.map((item, idx) => (
          <div key={idx} style={{ margin: "3px 0" }}>
            <div style={{ fontWeight: 600 }}>
              {item.name} {item.variantLabel ? `(${item.variantLabel})` : ""}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9em" }}>
              <span>
                {item.quantity} x {money(item.unitPriceCents)}
              </span>
              <span style={{ fontWeight: "bold" }}>{money(item.lineCents)}</span>
            </div>
            {item.itemDiscountCents && item.itemDiscountCents > 0 ? (
              <div style={{ fontSize: "0.85em", textAlign: "right" }}>
                Disc: -{money(item.itemDiscountCents)}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />

      {/* Totals */}
      <div style={{ margin: "4px 0", fontSize: "0.95em" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Subtotal:</span>
          <span>{money(data.subtotalCents)}</span>
        </div>
        {totalDiscountCents > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Discount:</span>
            <span>-{money(totalDiscountCents)}</span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontWeight: "bold",
            fontSize: "1.15em",
            borderTop: "1px solid #000",
            borderBottom: "1px solid #000",
            padding: "2px 0",
            margin: "3px 0",
          }}
        >
          <span>TOTAL:</span>
          <span>{money(data.totalCents)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Paid:</span>
          <span>{money(data.paidCents)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
          <span>BALANCE:</span>
          <span>{money(balanceCents)}</span>
        </div>
        <div style={{ fontSize: "0.85em", marginTop: "2px" }}>
          Payment: {data.paymentMethod.toUpperCase()}
        </div>
      </div>

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: "0.85em", margin: "4px 0" }}>
        <div>Thank you for your business!</div>
        <div>ස්තූතියි! නැවත එන්න.</div>
        {s.showQr && data.shareToken && (
          <div style={{ marginTop: "4px", fontSize: "0.75em", wordBreak: "break-all" }}>
            Verify: /view/invoice/{data.shareToken.slice(0, 10)}...
          </div>
        )}
      </div>

      <div style={{ marginTop: "12px", fontSize: "0.8em", display: "flex", justifyContent: "space-between" }}>
        <span>Issued: _____</span>
        <span>Received: _____</span>
      </div>
    </div>
  );
}

// --- 3. Thermal Printer Settings Modal ---

export function ThermalPrinterSettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: ThermalSettings;
  onSave: (s: ThermalSettings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ThermalSettings>({ ...settings });
  const [testStatus, setTestStatus] = useState<string>("");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
    onClose();
  }

  async function handleTestPrint() {
    setTestStatus("Printing test receipt...");
    try {
      if (form.defaultMode === "bluetooth" && isBluetoothSupported()) {
        const testBuf = buildEscPosBuffer({
          businessName: "Nugathalawa Ceylon Tea",
          businessAddress: "Na Sewana, Hamangalla",
          businessPhone: "076 661 5492",
          invoiceNumber: "TEST-001",
          invoiceDate: new Date().toISOString().slice(0, 10),
          shopName: "Test Printer Shop",
          items: [{ name: "BOPF Premium 1kg", quantity: 2, unitPrice: 1250, lineTotal: 2500 }],
          subtotal: 2500,
          discount: 0,
          grandTotal: 2500,
          paid: 2500,
          balance: 0,
          paymentMethod: "cash",
          settings: form,
        });
        const res = await printViaBluetooth(testBuf, (st) => setTestStatus(st));
        setTestStatus(res.message);
      } else {
        printReceiptViaBrowser("printable-thermal-receipt", form);
        setTestStatus("Test receipt sent to browser print dialog.");
      }
    } catch (err: any) {
      setTestStatus(`Error: ${err.message}`);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose} style={{ zIndex: 1100 }}>
      <div
        className="dialog-card"
        style={{ maxWidth: 460, width: "100%", padding: 24, borderRadius: 12 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 17 }}>
            <Printer size={20} color="#16a34a" />
            Thermal Printer Settings
          </h3>
          <button className="secondary" onClick={onClose} style={{ padding: "4px 8px" }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Printer Profile Name</span>
              <input
                type="text"
                value={form.printerName}
                onChange={(e) => setForm({ ...form, printerName: e.target.value })}
                style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
              />
            </label>

            <label>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Paper Width Preset</span>
              <select
                value={form.paperWidth}
                onChange={(e) => setForm({ ...form, paperWidth: e.target.value as any })}
                style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
              >
                <option value="58mm">58mm (Portable / Handheld Bluetooth POS)</option>
                <option value="80mm">80mm (Standard Desktop POS Receipt)</option>
                <option value="custom">Custom Width</option>
              </select>
            </label>

            {form.paperWidth === "custom" && (
              <label>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Custom Width (mm)</span>
                <input
                  type="number"
                  min="40"
                  max="120"
                  value={form.customWidthMm}
                  onChange={(e) => setForm({ ...form, customWidthMm: Number(e.target.value) })}
                  style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
                />
              </label>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Font Size</span>
                <select
                  value={form.fontSize}
                  onChange={(e) => setForm({ ...form, fontSize: e.target.value as any })}
                  style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
                >
                  <option value="small">Small (Tight)</option>
                  <option value="normal">Normal</option>
                  <option value="large">Large (High Legibility)</option>
                </select>
              </label>

              <label>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Text Density</span>
                <select
                  value={form.textDensity}
                  onChange={(e) => setForm({ ...form, textDensity: e.target.value as any })}
                  style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
                >
                  <option value="normal">Normal Contrast</option>
                  <option value="high">High Contrast (Bold / Double-Strike)</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Default Mode</span>
                <select
                  value={form.defaultMode}
                  onChange={(e) => setForm({ ...form, defaultMode: e.target.value as any })}
                  style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
                >
                  <option value="browser">Browser Print Fallback (Universal)</option>
                  <option value="bluetooth">Web Bluetooth API (Direct)</option>
                </select>
              </label>

              <label>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Copies</span>
                <select
                  value={form.copies}
                  onChange={(e) => setForm({ ...form, copies: Number(e.target.value) })}
                  style={{ width: "100%", padding: "7px 10px", marginTop: 4 }}
                >
                  <option value="1">1 Copy (Customer)</option>
                  <option value="2">2 Copies (Customer + Office)</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={form.showLogo}
                  onChange={(e) => setForm({ ...form, showLogo: e.target.checked })}
                />
                Show Company Leaf Logo on Receipt
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={form.showQr}
                  onChange={(e) => setForm({ ...form, showQr: e.target.checked })}
                />
                Show Invoice Verification Link / QR
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={form.autoCut}
                  onChange={(e) => setForm({ ...form, autoCut: e.target.checked })}
                />
                Auto Paper Cut (ESC/POS compatible printers)
              </label>
            </div>
          </div>

          {testStatus && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 6,
                background: testStatus.includes("Error") ? "#fef2f2" : "#f0fdf4",
                color: testStatus.includes("Error") ? "#b91c1c" : "#166534",
                fontSize: 12,
              }}
            >
              {testStatus}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 10 }}>
            <button
              type="button"
              className="secondary"
              onClick={handleTestPrint}
              style={{ fontSize: 12 }}
            >
              <Printer size={14} />
              Test Print
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="secondary" onClick={onClose} style={{ fontSize: 12 }}>
                Cancel
              </button>
              <button type="submit" className="primary" style={{ background: "#16a34a", fontSize: 12 }}>
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 4. Comprehensive Invoice Preview Modal & Action Bar ---

export function InvoicePreviewModal({
  data,
  invoiceId,
  onClose,
  initialTab = "a4",
}: {
  data: InvoiceViewData;
  invoiceId?: string;
  onClose: () => void;
  initialTab?: "a4" | "thermal";
}) {
  const [activeTab, setActiveTab] = useState<"a4" | "thermal">(initialTab);
  const [zoom, setZoom] = useState<number>(100);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<string>("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [printerSettings, setPrinterSettings] = useState<ThermalSettings>(getThermalSettings());
  const [bluetoothStatus, setBluetoothStatus] = useState<string>("");

  const a4Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPrinterSettings(getThermalSettings());
  }, []);

  function handleSaveSettings(s: ThermalSettings) {
    const updated = saveThermalSettings(s);
    setPrinterSettings(updated);
  }

  // --- High-Quality A4 PDF Generation ---
  async function downloadA4Pdf() {
    if (!a4Ref.current) return;
    setIsGeneratingPdf(true);
    setShareMsg("");
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(a4Ref.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", 0, 0, 210, 297, undefined, "FAST");
      pdf.save(`Invoice_${data.number}.pdf`);
      setShareMsg("PDF downloaded successfully!");
    } catch (err: any) {
      setShareMsg(`PDF Generation Error: ${err.message}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  // --- Print A4 Invoice ---
  function printA4() {
    window.print();
  }

  // --- Print Thermal Bill ---
  async function printThermal() {
    setBluetoothStatus("");
    if (printerSettings.defaultMode === "bluetooth" && isBluetoothSupported()) {
      try {
        const buffer = buildEscPosBuffer({
          businessName: data.businessName || "NUGATHALAWA CEYLON TEA",
          businessAddress: data.businessAddress || "Hamangalla, Narangoda",
          businessPhone: data.businessPhone || "076 661 5492",
          invoiceNumber: data.number,
          invoiceDate: data.invoiceDate,
          shopName: data.shopName,
          customerPhone: data.customerPhone,
          repName: data.repName,
          items: data.items.map((x) => ({
            name: x.name,
            variantLabel: x.variantLabel,
            quantity: x.quantity,
            unitPrice: x.unitPriceCents / 100,
            lineTotal: x.lineCents / 100,
            discount: (x.itemDiscountCents || 0) / 100,
          })),
          subtotal: data.subtotalCents / 100,
          discount: (data.itemDiscountCents + data.invoiceDiscountCents) / 100,
          grandTotal: data.totalCents / 100,
          paid: data.paidCents / 100,
          balance: Math.max(0, data.totalCents - data.paidCents) / 100,
          paymentMethod: data.paymentMethod,
          verificationUrl: data.shareToken ? `/view/invoice/${data.shareToken}` : undefined,
          settings: printerSettings,
        });

        const res = await printViaBluetooth(buffer, (st) => setBluetoothStatus(st));
        setBluetoothStatus(res.message);
      } catch (err: any) {
        setBluetoothStatus(`Bluetooth Error: ${err.message}. Falling back to browser print.`);
        printReceiptViaBrowser("modal-thermal-receipt", printerSettings);
      }
    } else {
      printReceiptViaBrowser("modal-thermal-receipt", printerSettings);
    }
  }

  // --- WhatsApp PDF Sharing (Web Share API with Download Fallback) ---
  async function shareViaWhatsApp() {
    setIsSharing(true);
    setShareMsg("");
    const phone = normalizeWhatsApp(data.customerWhatsapp || data.customerPhone || "");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const invoiceLink = data.shareToken
      ? `${origin}/view/invoice/${data.shareToken}`
      : `${origin}/dashboard`;

    const totalStr = money(data.totalCents);
    const paidStr = money(data.paidCents);
    const balanceStr = money(Math.max(0, data.totalCents - data.paidCents));

    const messageText = `Hello,\n\nYour invoice from ${
      data.businessName || "Nugathalawa Ceylon Tea Export (Pvt) Ltd"
    } is ready.\n\nInvoice No: ${data.number}\nShop: ${data.shopName}\nTotal: ${totalStr}\nPaid: ${paidStr}\nBalance: ${balanceStr}\n\nView / Download Invoice:\n${invoiceLink}\n\nThank you!`;

    try {
      // 1. Generate PDF blob
      let pdfFile: File | null = null;
      if (a4Ref.current) {
        const html2canvas = (await import("html2canvas")).default;
        const { jsPDF } = await import("jspdf");
        const canvas = await html2canvas(a4Ref.current, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        });
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297, undefined, "FAST");
        const blob = pdf.output("blob");
        pdfFile = new File([blob], `Invoice_${data.number}.pdf`, { type: "application/pdf" });
      }

      // 2. Try Web Share API with attached PDF file
      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        pdfFile &&
        navigator.canShare({ files: [pdfFile] })
      ) {
        await navigator.share({
          title: `Invoice ${data.number}`,
          text: messageText,
          files: [pdfFile],
        });
        setShareMsg("Invoice PDF shared successfully!");
      } else {
        // 3. Fallback: Download PDF & open WhatsApp Web/App
        if (pdfFile) {
          const url = URL.createObjectURL(pdfFile);
          const a = document.createElement("a");
          a.href = url;
          a.download = `Invoice_${data.number}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        }

        const waUrl = phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`
          : `https://wa.me/?text=${encodeURIComponent(messageText)}`;
        window.open(waUrl, "_blank", "noopener,noreferrer");

        setShareMsg(
          "PDF එක ඔබගේ උපාංගයට Download විය. WhatsApp හි 📎 (Attach Document) මඟින් එම PDF ගොනුව තෝරා යවන්න."
        );
      }

      // 4. Log WhatsApp delivery if invoice exists
      if (invoiceId && phone) {
        api(`/credit-alerts/send-whatsapp`, {
          method: "POST",
          body: JSON.stringify({
            invoiceId,
            recipientPhone: phone,
            message: messageText,
          }),
        }).catch(() => {});
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setShareMsg(`WhatsApp Share: ${err.message}`);
      }
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      style={{
        zIndex: 1000,
        background: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        padding: "16px",
        overflowY: "auto",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      }}
      onMouseDown={onClose}
    >
      <div
        className="invoice-preview-modal-card"
        style={{
          width: "100%",
          maxWidth: "1020px",
          background: "#f8fafc",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          margin: "auto",
          border: "1px solid #e2e8f0",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Top Header & Tab Controls */}
        <div
          style={{
            background: "#ffffff",
            padding: "12px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <TeaLeafLogo size={32} />
            <div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#111827" }}>
                Preview Invoice / බිල්පත පෙරදසුන
              </h2>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                Invoice #{data.number} · {data.shopName}
              </span>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div
            style={{
              display: "flex",
              background: "#f1f5f9",
              padding: "3px",
              borderRadius: "8px",
              gap: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("a4")}
              style={{
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "a4" ? "#ffffff" : "transparent",
                color: activeTab === "a4" ? "#16a34a" : "#64748b",
                boxShadow: activeTab === "a4" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <FileText size={14} />
              A4 Invoice (ඉන්වොයිසිය)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("thermal")}
              style={{
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "thermal" ? "#ffffff" : "transparent",
                color: activeTab === "thermal" ? "#16a34a" : "#64748b",
                boxShadow: activeTab === "thermal" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Receipt size={14} />
              Thermal Bill (කුඩා බිල්පත)
            </button>
          </div>

          {/* Close button */}
          <button
            className="secondary"
            onClick={onClose}
            style={{
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "12px",
            }}
          >
            <X size={16} />
            Close
          </button>
        </div>

        {/* Action Toolbar */}
        <div
          style={{
            background: "#f8fafc",
            padding: "10px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          {/* Zoom Controls for A4 */}
          {activeTab === "a4" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Zoom:</span>
              <button
                type="button"
                className="secondary"
                onClick={() => setZoom((z) => Math.max(50, z - 15))}
                style={{ padding: "4px 8px", fontSize: "11px" }}
              >
                <ZoomOut size={13} />
              </button>
              <span style={{ fontSize: "12px", fontWeight: 700, minWidth: "40px", textAlign: "center" }}>
                {zoom}%
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => setZoom((z) => Math.min(150, z + 15))}
                style={{ padding: "4px 8px", fontSize: "11px" }}
              >
                <ZoomIn size={13} />
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setZoom(100)}
                style={{ padding: "4px 8px", fontSize: "11px" }}
              >
                <Maximize2 size={13} />
                Fit
              </button>
            </div>
          ) : (
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Thermal Preset: <b>{printerSettings.paperWidth}</b> ({printerSettings.printerName})
            </div>
          )}

          {/* Primary Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary"
              disabled={isGeneratingPdf}
              onClick={downloadA4Pdf}
              style={{
                background: "#0284c7",
                color: "#fff",
                fontSize: "12px",
                padding: "7px 12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Download size={14} />
              {isGeneratingPdf ? "Building PDF..." : "Download PDF"}
            </button>

            <button
              type="button"
              className="secondary"
              onClick={printA4}
              style={{
                fontSize: "12px",
                padding: "7px 12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Printer size={14} />
              Print Invoice (A4)
            </button>

            <button
              type="button"
              className="secondary"
              onClick={printThermal}
              style={{
                fontSize: "12px",
                padding: "7px 12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                color: "#16a34a",
                borderColor: "#86efac",
              }}
            >
              <Receipt size={14} />
              Print Bill (Thermal)
            </button>

            <button
              type="button"
              className="primary"
              disabled={isSharing}
              onClick={shareViaWhatsApp}
              style={{
                background: "#16a34a",
                color: "#fff",
                fontSize: "12px",
                padding: "7px 14px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <MessageCircle size={14} />
              Send PDF via WhatsApp
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => setShowSettingsModal(true)}
              style={{ padding: "7px 10px", fontSize: "12px" }}
              title="Thermal Printer Settings"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Status / Alert Banner */}
        {(shareMsg || bluetoothStatus) && (
          <div
            style={{
              padding: "8px 20px",
              background: shareMsg.includes("Error") ? "#fef2f2" : "#f0fdf4",
              borderBottom: "1px solid #e2e8f0",
              color: shareMsg.includes("Error") ? "#b91c1c" : "#166534",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {shareMsg.includes("Error") ? <AlertCircle size={15} /> : <CheckCircle size={15} />}
            <span>{shareMsg || bluetoothStatus}</span>
          </div>
        )}

        {/* Viewport Area */}
        <div
          style={{
            maxHeight: "74vh",
            overflowY: "auto",
            overflowX: "auto",
            padding: "24px",
            background: "#f1f5f9",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          {activeTab === "a4" ? (
            <div
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
                transition: "transform 0.15s ease",
              }}
            >
              <div ref={a4Ref}>
                <A4InvoiceView data={data} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <ThermalReceiptView
                data={data}
                settings={printerSettings}
                receiptId="modal-thermal-receipt"
              />
            </div>
          )}
        </div>
      </div>

      {/* Printer Settings Submodal */}
      {showSettingsModal && (
        <ThermalPrinterSettingsModal
          settings={printerSettings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
