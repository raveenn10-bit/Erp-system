"use client";

import React, { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CheckCircle,
  MessageCircle,
  Printer,
  FileText,
  CreditCard,
  Banknote,
  Receipt,
  User,
  AlertTriangle,
  RefreshCw,
  Eye,
} from "lucide-react";
import { api, formatWhatsApp, idempotency, money, normalizeWhatsApp } from "@/lib/api";
import { Product, Customer, Stock } from "./distribution-panels";
import { InvoicePreviewModal, InvoiceViewData, TeaLeafLogo } from "./invoice-designer";
import { useI18n } from "@/lib/i18n";

interface CartItem {
  variantId: string;
  name: string;
  label: string;
  sku?: string;
  unitPriceCents: number;
  wholesaleCents: number;
  retailCents: number;
  shopPriceCents: number;
  quantity: number;
  priceType: "wholesale" | "retail";
  discountCents: number;
}

export function SmartPOSTerminal({
  products,
  customers,
  stocks,
  onInvoiceCreated,
}: {
  products: Product[];
  customers: Customer[];
  stocks: Stock[];
  onInvoiceCreated?: (invoiceId: string) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Cart & Checkout State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerWhatsapp, setCustomerWhatsapp] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit" | "bank">("cash");
  const [amountPaidInput, setAmountPaidInput] = useState<number>(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<"fixed" | "percent">("fixed");
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState<number>(0);
  const [dueDays, setDueDays] = useState<number>(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successData, setSuccessData] = useState<{
    id: string;
    number: string;
    totalCents: number;
    paidCents: number;
    shareToken?: string;
  } | null>(null);

  // Live Preview Modal State
  const [showLivePreview, setShowLivePreview] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    let list = products;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.label.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q))
      );
    }
    return list;
  }, [products, searchQuery]);

  // Selected Customer details & Credit limit calculation
  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // Stock lookup helper
  function getVariantStock(variantId: string): number {
    return stocks
      .filter((s) => s.variant_id === variantId)
      .reduce((sum, s) => sum + s.quantity, 0);
  }

  // Cart Calculations
  const cartTotals = useMemo(() => {
    let subtotalCents = 0;
    let itemDiscountsCents = 0;

    for (const item of cart) {
      const gross = item.unitPriceCents * item.quantity;
      subtotalCents += gross;
      itemDiscountsCents += item.discountCents;
    }

    const netAfterItemDisc = Math.max(0, subtotalCents - itemDiscountsCents);

    let invDiscCents = 0;
    if (invoiceDiscountValue > 0) {
      if (invoiceDiscountType === "percent") {
        invDiscCents = Math.round(netAfterItemDisc * (invoiceDiscountValue / 100));
      } else {
        invDiscCents = Math.min(netAfterItemDisc, Math.round(invoiceDiscountValue * 100));
      }
    }

    const grandTotalCents = Math.max(0, netAfterItemDisc - invDiscCents);
    const paidCents =
      paymentMethod === "credit"
        ? Math.min(grandTotalCents, Math.round(amountPaidInput * 100))
        : grandTotalCents;
    const balanceDueCents = Math.max(0, grandTotalCents - paidCents);

    return {
      subtotalCents,
      itemDiscountsCents,
      invDiscCents,
      grandTotalCents,
      paidCents,
      balanceDueCents,
    };
  }, [cart, invoiceDiscountType, invoiceDiscountValue, paymentMethod, amountPaidInput]);

  // Add Product to Cart
  function addToCart(p: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.variantId === p.variant_id);
      if (idx >= 0) {
        return prev.map((item, i) =>
          i === idx ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          variantId: p.variant_id,
          name: p.name,
          label: p.label,
          sku: p.sku,
          unitPriceCents: p.wholesale_cents,
          wholesaleCents: p.wholesale_cents,
          retailCents: p.retail_cents,
          shopPriceCents: p.shop_price_cents,
          quantity: 1,
          priceType: "wholesale",
          discountCents: 0,
        },
      ];
    });
  }

  function updateQuantity(variantId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((x) => (x.variantId === variantId ? { ...x, quantity: Math.max(1, x.quantity + delta) } : x))
        .filter((x) => x.quantity > 0)
    );
  }

  function removeItem(variantId: string) {
    setCart((prev) => prev.filter((x) => x.variantId !== variantId));
  }

  function togglePriceType(variantId: string) {
    setCart((prev) =>
      prev.map((x) => {
        if (x.variantId !== variantId) return x;
        const newType = x.priceType === "wholesale" ? "retail" : "wholesale";
        return {
          ...x,
          priceType: newType,
          unitPriceCents: newType === "wholesale" ? x.wholesaleCents : x.retailCents,
        };
      })
    );
  }

  // Handle Customer Selection
  function onSelectCustomer(id: string) {
    setSelectedCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) {
      setCustomerWhatsapp(c.whatsapp || c.phone || "");
      if (c.credit_days) {
        setDueDays(Math.min(45, c.credit_days));
      }
    }
  }

  // Handle Barcode Scan / Enter
  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const matched = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === searchQuery.trim().toLowerCase()) ||
        p.name.toLowerCase() === searchQuery.trim().toLowerCase()
    );
    if (matched) {
      addToCart(matched);
      setSearchQuery("");
    }
  }

  // Prepare Payload
  function getCheckoutPayload(isSendWhatsApp = false) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);
    const dueAtStr = paymentMethod === "credit" ? dueDate.toISOString().slice(0, 10) : null;

    return {
      customerId: selectedCustomerId,
      customerWhatsapp: customerWhatsapp ? normalizeWhatsApp(customerWhatsapp) : undefined,
      warehouseId: "main",
      invoiceDate: todayStr,
      dueAt: dueAtStr,
      paymentMethod,
      amountPaidCents: cartTotals.paidCents,
      items: cart.map((c) => ({
        variantId: c.variantId,
        quantity: c.quantity,
        priceType: c.priceType,
        discount:
          c.discountCents > 0
            ? {
                type: "fixed",
                value: c.discountCents,
              }
            : undefined,
      })),
      invoiceDiscount:
        cartTotals.invDiscCents > 0
          ? {
              type: invoiceDiscountType,
              value:
                invoiceDiscountType === "percent"
                  ? Math.round(invoiceDiscountValue * 100)
                  : cartTotals.invDiscCents,
            }
          : undefined,
      idempotencyKey: idempotency(),
      terms: "Goods received in good condition. All cheques subject to realization.",
    };
  }

  // Complete POS Checkout
  async function submitCheckout(isSendWhatsApp = false) {
    if (!selectedCustomerId) {
      setErrorMessage("කරුණාකර පාරිභෝගික සාප්පුව තෝරන්න (Please select a customer/shop)");
      return;
    }
    if (cart.length === 0) {
      setErrorMessage("සාප්පු කරත්තය හිස්ය. කරුණාකර නිෂ්පාදන එක් කරන්න (Cart is empty)");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const payload = getCheckoutPayload(isSendWhatsApp);
      const res = await api<{
        id: string;
        number: string;
        totalCents: number;
        paidCents: number;
        shareToken?: string;
      }>("/billing/invoices", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      setSuccessData(res);
      onInvoiceCreated?.(res.id);

      // WhatsApp Trigger
      if (isSendWhatsApp) {
        const phone = normalizeWhatsApp(customerWhatsapp);
        if (phone) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const link = res.shareToken ? `${origin}/view/invoice/${res.shareToken}` : `${origin}/dashboard`;
          const msg = `Hello,\n\nYour invoice from Nugathalawa Ceylon Tea Export (Pvt) Ltd is ready.\n\nInvoice No: ${res.number}\nShop: ${selectedCustomer?.shop_name || "Valued Customer"}\nTotal: ${money(res.totalCents)}\nPaid: ${money(res.paidCents)}\nBalance: ${money(Math.max(0, res.totalCents - res.paidCents))}\n\nView / Download Invoice:\n${link}\n\nThank you!`;
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
        }
      }

      // Reset cart
      setCart([]);
      setAmountPaidInput(0);
      setInvoiceDiscountValue(0);
    } catch (err: any) {
      setErrorMessage(err.message || "Checkout failed. Please check stock or credit limits.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Prepare Live Preview Data
  const previewData: InvoiceViewData = {
    number: "INV-PREVIEW",
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueAt:
      paymentMethod === "credit"
        ? new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10)
        : null,
    shopName: selectedCustomer?.shop_name || "Valued Customer",
    customerPhone: selectedCustomer?.phone,
    customerWhatsapp: customerWhatsapp || selectedCustomer?.whatsapp,
    customerAddress: selectedCustomer?.address,
    businessName: "Nugathalawa Ceylon Tea Export (Pvt) Ltd",
    businessAddress: "Na Sewana, Hamangalla, Narangoda, Sri Lanka",
    businessPhone: "076 661 5492",
    businessWhatsapp: "076 696 5493",
    paymentMethod,
    subtotalCents: cartTotals.subtotalCents,
    itemDiscountCents: cartTotals.itemDiscountsCents,
    invoiceDiscountCents: cartTotals.invDiscCents,
    totalCents: cartTotals.grandTotalCents,
    paidCents: cartTotals.paidCents,
    items: cart.map((c) => ({
      name: c.name,
      variantLabel: c.label,
      sku: c.sku,
      quantity: c.quantity,
      unitPriceCents: c.unitPriceCents,
      lineCents: c.unitPriceCents * c.quantity - c.discountCents,
      itemDiscountCents: c.discountCents,
      priceType: c.priceType,
    })),
  };

  return (
    <div className="smart-pos-container" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Top Banner / Header */}
      <div
        style={{
          background: "linear-gradient(90deg, #166534 0%, #15803d 50%, #16a34a 100%)",
          color: "#ffffff",
          padding: "16px 20px",
          borderRadius: "12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          boxShadow: "0 4px 15px rgba(22, 101, 52, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <TeaLeafLogo size={38} color="#ffffff" />
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800 }}>
              {t("pos.title", "Smart POS විකුණුම් පර්යන්තය")}
            </h2>
            <p style={{ margin: 0, fontSize: "12px", opacity: 0.9 }}>
              {t("pos.subtitle", "ක්ෂණික බිල්පත් නිකුත් කිරීම සහ ස්වයංක්‍රීය තොග අඩු වීම")}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              background: "rgba(255, 255, 255, 0.2)",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            🛒 {cart.length} {t("pos.items_count", "අයිතම")}
          </span>
          <span
            style={{
              background: "#ffffff",
              color: "#166534",
              padding: "4px 14px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: 800,
            }}
          >
            {money(cartTotals.grandTotalCents)}
          </span>
        </div>
      </div>

      {/* Main POS Split Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: "18px",
          alignItems: "flex-start",
        }}
      >
        {/* Left Column: Product Search & Catalog */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Search & Barcode Bar */}
          <form onSubmit={handleBarcodeSubmit} style={{ display: "flex", gap: "8px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={18}
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b" }}
              />
              <input
                ref={barcodeInputRef}
                type="text"
                placeholder={t("pos.search_product", "නිෂ්පාදනයක් හෝ Barcode එකක් සොයන්න...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 38px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  fontSize: "14px",
                }}
              />
            </div>
            {searchQuery && (
              <button
                type="button"
                className="secondary"
                onClick={() => setSearchQuery("")}
                style={{ padding: "0 14px", fontSize: "12px" }}
              >
                Clear
              </button>
            )}
          </form>

          {/* Product Cards Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
              gap: "12px",
              maxHeight: "68vh",
              overflowY: "auto",
              paddingRight: "4px",
            }}
          >
            {filteredProducts.map((p) => {
              const stock = getVariantStock(p.variant_id);
              const inCart = cart.find((x) => x.variantId === p.variant_id);

              return (
                <div
                  key={p.variant_id}
                  onClick={() => addToCart(p)}
                  style={{
                    background: inCart ? "#f0fdf4" : "#ffffff",
                    border: inCart ? "2px solid #22c55e" : "1px solid #e2e8f0",
                    borderRadius: "10px",
                    padding: "12px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "135px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#1e293b",
                          lineHeight: 1.3,
                        }}
                      >
                        {p.name}
                      </span>
                      {inCart && (
                        <span
                          style={{
                            background: "#16a34a",
                            color: "#fff",
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "2px 6px",
                            borderRadius: "10px",
                          }}
                        >
                          {inCart.quantity}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                      Pack: <b>{p.label}</b> {p.sku ? `· ${p.sku}` : ""}
                    </div>
                  </div>

                  <div style={{ marginTop: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: "10px", color: "#64748b" }}>Wholesale:</div>
                        <div style={{ fontSize: "14px", fontWeight: 800, color: "#16a34a" }}>
                          {money(p.wholesale_cents)}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "10.5px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: stock > 10 ? "#f0fdf4" : stock > 0 ? "#fefce8" : "#fef2f2",
                          color: stock > 10 ? "#166534" : stock > 0 ? "#854d0e" : "#991b1b",
                          fontWeight: 600,
                        }}
                      >
                        {stock > 0 ? `${stock} in stock` : "Out of stock"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredProducts.length === 0 && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "40px 20px",
                  textAlign: "center",
                  color: "#64748b",
                  background: "#ffffff",
                  borderRadius: "10px",
                  border: "1px dashed #cbd5e1",
                }}
              >
                {t("search.no_results", "ගැලපෙන නිෂ්පාදන කිසිවක් හමු නොවීය")}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Customer Selection & Order Cart */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
          }}
        >
          {/* Customer / Shop Selection */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155" }}>
              {t("pos.select_customer", "පාරිභෝගික සාප්පුව තෝරන්න (Select Shop)")}
              <select
                value={selectedCustomerId}
                onChange={(e) => onSelectCustomer(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", marginTop: "4px" }}
              >
                <option value="">-- සාප්පුවක් තෝරන්න (Select Shop) --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shop_name} ({c.owner_name || c.phone || "Customer"})
                  </option>
                ))}
              </select>
            </label>

            {/* Customer WhatsApp Field */}
            <label style={{ fontSize: "12px", color: "#475569" }}>
              Customer WhatsApp Number (බිල්පත යැවීමට WhatsApp අංකය):
              <input
                type="tel"
                value={customerWhatsapp}
                onChange={(e) => setCustomerWhatsapp(e.target.value)}
                placeholder="077 123 4567 or +94771234567"
                style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", marginTop: "3px" }}
              />
            </label>

            {/* Credit Info Warning */}
            {selectedCustomer && (selectedCustomer.credit_limit_cents || 0) > 0 && (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  color: "#166534",
                }}
              >
                Credit Limit: <b>{money(selectedCustomer.credit_limit_cents || 0)}</b> · Terms:{" "}
                <b>{selectedCustomer.credit_days || 30} Days</b>
              </div>
            )}
          </div>

          {/* Cart Items List */}
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                {t("pos.cart_title", "වත්මන් බිල්පත (Cart)")}
              </span>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  style={{
                    border: "none",
                    background: "none",
                    color: "#ef4444",
                    fontSize: "11px",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Clear All
                </button>
              )}
            </div>

            <div
              style={{
                maxHeight: "260px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {cart.map((item) => (
                <div
                  key={item.variantId}
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: "8px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                      {item.label} ·
                      <button
                        type="button"
                        onClick={() => togglePriceType(item.variantId)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#0284c7",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "11px",
                          marginLeft: "4px",
                          textDecoration: "underline",
                        }}
                      >
                        {item.priceType.toUpperCase()} ({money(item.unitPriceCents)})
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        background: "#ffffff",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variantId, -1)}
                        style={{ border: "none", background: "none", padding: "4px 8px", cursor: "pointer" }}
                      >
                        <Minus size={12} />
                      </button>
                      <span style={{ fontSize: "12px", fontWeight: 700, minWidth: "22px", textAlign: "center" }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variantId, 1)}
                        style={{ border: "none", background: "none", padding: "4px 8px", cursor: "pointer" }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <span style={{ fontSize: "13px", fontWeight: 800, color: "#111827", minWidth: "65px", textAlign: "right" }}>
                      {money(item.unitPriceCents * item.quantity)}
                    </span>

                    <button
                      type="button"
                      onClick={() => removeItem(item.variantId)}
                      style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer" }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}

              {cart.length === 0 && (
                <div
                  style={{
                    padding: "30px 10px",
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: "12.5px",
                  }}
                >
                  {t("pos.cart_empty", "සාප්පු කරත්තය හිස්ය. වම්පසින් නිෂ්පාදන එක් කරන්න.")}
                </div>
              )}
            </div>
          </div>

          {/* Payment Method & Terms */}
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                style={{
                  padding: "7px 6px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: paymentMethod === "cash" ? "2px solid #16a34a" : "1px solid #cbd5e1",
                  background: paymentMethod === "cash" ? "#f0fdf4" : "#ffffff",
                  color: paymentMethod === "cash" ? "#166534" : "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <Banknote size={14} />
                {t("pos.cash_sale", "Cash")}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("credit")}
                style={{
                  padding: "7px 6px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: paymentMethod === "credit" ? "2px solid #eab308" : "1px solid #cbd5e1",
                  background: paymentMethod === "credit" ? "#fefce8" : "#ffffff",
                  color: paymentMethod === "credit" ? "#854d0e" : "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <CreditCard size={14} />
                {t("pos.credit_sale", "Credit (ණය)")}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("bank")}
                style={{
                  padding: "7px 6px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: paymentMethod === "bank" ? "2px solid #0284c7" : "1px solid #cbd5e1",
                  background: paymentMethod === "bank" ? "#f0f9ff" : "#ffffff",
                  color: paymentMethod === "bank" ? "#0369a1" : "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <Receipt size={14} />
                {t("pos.bank_sale", "Bank")}
              </button>
            </div>

            {paymentMethod === "credit" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <label style={{ fontSize: "11.5px", color: "#475569" }}>
                  Down Payment (අත්පිට මුදල LKR):
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountPaidInput}
                    onChange={(e) => setAmountPaidInput(Number(e.target.value))}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: "4px", marginTop: "2px" }}
                  />
                </label>
                <label style={{ fontSize: "11.5px", color: "#475569" }}>
                  Credit Period (දින ගණන):
                  <select
                    value={dueDays}
                    onChange={(e) => setDueDays(Number(e.target.value))}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: "4px", marginTop: "2px" }}
                  >
                    <option value="14">14 Days</option>
                    <option value="30">30 Days</option>
                    <option value="45">45 Days (Max)</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Totals Summary */}
          <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "12px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0", color: "#64748b" }}>
              <span>{t("pos.subtotal", "Subtotal")}:</span>
              <b>{money(cartTotals.subtotalCents)}</b>
            </div>

            {cartTotals.invDiscCents > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0", color: "#ef4444" }}>
                <span>{t("pos.discount", "Discount")}:</span>
                <b>-{money(cartTotals.invDiscCents)}</b>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                margin: "6px 0",
                fontSize: "15px",
                fontWeight: 800,
                color: "#166534",
                borderTop: "1px dashed #cbd5e1",
                paddingTop: "6px",
              }}
            >
              <span>{t("pos.grand_total", "Grand Total")}:</span>
              <span>{money(cartTotals.grandTotalCents)}</span>
            </div>

            {paymentMethod === "credit" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0", color: "#16a34a" }}>
                  <span>{t("pos.amount_paid", "Paid Amount")}:</span>
                  <b>{money(cartTotals.paidCents)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0", color: "#dc2626", fontWeight: 700 }}>
                  <span>{t("pos.balance_due", "Balance Due")}:</span>
                  <b>{money(cartTotals.balanceDueCents)}</b>
                </div>
              </>
            )}
          </div>

          {errorMessage && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "#fef2f2",
                color: "#b91c1c",
                fontSize: "12px",
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              type="button"
              disabled={isSubmitting || cart.length === 0}
              onClick={() => submitCheckout(false)}
              className="primary"
              style={{
                background: "#16a34a",
                color: "#ffffff",
                padding: "10px",
                fontSize: "14px",
                fontWeight: 700,
                borderRadius: "8px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <CheckCircle size={17} />
              {isSubmitting ? "Processing..." : t("pos.checkout", "විකුණුම ස්ථිර කරන්න (Checkout)")}
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button
                type="button"
                disabled={isSubmitting || cart.length === 0}
                onClick={() => submitCheckout(true)}
                className="secondary"
                style={{
                  fontSize: "12px",
                  padding: "8px 4px",
                  color: "#16a34a",
                  borderColor: "#86efac",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <MessageCircle size={14} />
                Save & WhatsApp
              </button>

              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => setShowLivePreview(true)}
                className="secondary"
                style={{
                  fontSize: "12px",
                  padding: "8px 4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <Eye size={14} />
                {t("btn.preview", "බිල්පත පෙරදසුන")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Live Preview Modal */}
      {showLivePreview && (
        <InvoicePreviewModal
          data={previewData}
          onClose={() => setShowLivePreview(false)}
        />
      )}

      {/* Success Notification Modal */}
      {successData && (
        <div className="dialog-backdrop" onMouseDown={() => setSuccessData(null)}>
          <div
            className="dialog-card"
            style={{ maxWidth: 460, textAlign: "center", padding: "28px" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ color: "#16a34a", marginBottom: 12 }}>
              <CheckCircle size={48} style={{ margin: "0 auto" }} />
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>
              විකුණුම සාර්ථකයි! (Invoice Created)
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              බිල්පත් අංකය: <b>#{successData.number}</b> · මුදල: <b>{money(successData.totalCents)}</b>
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  onInvoiceCreated?.(successData.id);
                  setSuccessData(null);
                }}
                style={{ background: "#16a34a" }}
              >
                බිල්පත මුද්‍රණය / බාගත කරන්න (Print / PDF)
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setSuccessData(null)}
              >
                නව විකුණුමක් ආරම්භ කරන්න (Next Sale)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
