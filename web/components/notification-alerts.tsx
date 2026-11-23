"use client";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle,
  Clock,
  CreditCard,
  ExternalLink,
  Eye,
  Filter,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  User,
  Wallet,
  X,
} from "lucide-react";
import { api, money } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────
export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  priority: "low" | "medium" | "high" | "urgent";
  stage: string;
  invoice_id: string | null;
  customer_id: string | null;
  shop_name: string;
  invoice_number: string;
  outstanding_cents: number;
  due_at: string | null;
  days_diff: number;
  customer_whatsapp: string;
  rep_name: string;
};

export type CreditAlertItem = {
  id: string;
  number: string;
  customer_id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  whatsapp: string;
  target_phone: string;
  clean_phone: string;
  outstanding_cents: number;
  total_cents: number;
  paid_cents: number;
  due_at: string;
  payment_terms: string;
  created_at: string;
  rep_name: string;
  days_diff: number;
  status_category: "due_soon" | "due_today" | "overdue";
  priority: "low" | "medium" | "high" | "urgent";
  is_high_risk: boolean;
  whatsapp_message: string;
  whatsapp_url: string;
};

export type CreditAlertStats = {
  totalOutstandingCents: number;
  dueWithin14DaysCents: number;
  dueWithin7DaysCents: number;
  dueTodayCents: number;
  overdueCents: number;
  highRiskCount: number;
  totalUnpaidCount: number;
};

export type CreditAlertSettings = {
  id: number;
  enabled: number;
  schedule_days: string;
  overdue_frequency_days: number;
  recipients: "admin" | "rep" | "both";
  language: "si" | "en";
  whatsapp_template: string;
  retention_days: number;
  updated_at: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    urgent: { bg: "var(--danger-soft)", text: "var(--danger-strong)", label: "අත්‍යවශ්‍ය (Urgent)" },
    high: { bg: "var(--warning-soft)", text: "var(--warning-strong)", label: "ඉහළ (High)" },
    medium: { bg: "var(--warning-soft)", text: "var(--warning-strong)", label: "මධ්‍යම (Medium)" },
    low: { bg: "var(--surface-muted)", text: "var(--brand-text-muted)", label: "සාමාන්‍ය (Low)" },
  };
  const s = styles[priority] || styles.medium;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 10,
        fontWeight: 700,
        background: s.bg,
        color: s.text,
        letterSpacing: "0.03em",
      }}
    >
      {s.label}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. NOTIFICATION BELL & SLIDE-IN DRAWER
// ═════════════════════════════════════════════════════════════════════════════
export function NotificationBellAndDrawer({
  onViewInvoice,
  onViewCustomer,
}: {
  onViewInvoice: (id: string) => void;
  onViewCustomer: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "due_soon" | "overdue">("all");
  const [activeWhatsAppModal, setActiveWhatsAppModal] = useState<NotificationItem | null>(null);
  const client = useQueryClient();

  const query = useQuery<{ unreadCount: number; notifications: NotificationItem[] }>({
    queryKey: ["notifications", filter],
    queryFn: () => api(`/notifications?filter=${filter}`),
    refetchInterval: 30000,
  });

  const unreadCount = query.data?.unreadCount || 0;
  const items = query.data?.notifications || [];

  async function markAsRead(id: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    try {
      await api(`/notifications/${id}/read`, { method: "PATCH" });
      await client.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err) {
      console.error(err);
    }
  }

  async function markAllAsRead() {
    try {
      await api("/notifications/read-all", { method: "POST" });
      await client.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <>
      {/* Bell Button */}
      <button
        type="button"
        className="secondary"
        aria-label="ණය මතක් කිරීම් සහ දැනුම්දීම්"
        onClick={() => setOpen(true)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: "50%",
          padding: 0,
          border: unreadCount > 0 ? "1.5px solid var(--brand-primary)" : "1px solid var(--border)",
          background: unreadCount > 0 ? "var(--surface-raised)" : "var(--surface)",
        }}
      >
        <Bell size={18} style={{ color: unreadCount > 0 ? "var(--brand-primary)" : "currentColor" }} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              borderRadius: 9,
              background: "var(--danger)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-in Drawer */}
      {open && (
        <div
          data-overlay
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            background: "rgba(15,23,42,0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 460,
              height: "100%",
              background: "var(--surface)",
              boxShadow: "-8px 0 32px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 20px",
                borderBottom: "1.5px solid var(--border)",
                background: "var(--surface-raised)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Bell size={20} style={{ color: "var(--brand-primary)" }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>දැනුම්දීම් (Notifications)</h3>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    නොකියවූ {unreadCount} ක් ඇත
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={markAllAsRead}
                    style={{ fontSize: 11, padding: "5px 10px", gap: 4 }}
                    title="සියල්ල කියවූ ලෙස සලකුණු කරන්න"
                  >
                    <CheckCheck size={14} /> කියවූ ලෙස
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setOpen(false)}
                  style={{ width: 32, height: 32, padding: 0 }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div
              style={{
                display: "flex",
                gap: 6,
                padding: "10px 16px",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface)",
                overflowX: "auto",
              }}
            >
              {[
                { k: "all", label: "සියල්ල (All)" },
                { k: "unread", label: `නොකියවූ (${unreadCount})` },
                { k: "due_soon", label: "දිනය ළඟයි" },
                { k: "overdue", label: "ප්‍රමාදයි" },
              ].map(({ k, label }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k as any)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    border: "none",
                    fontSize: 11,
                    fontWeight: filter === k ? 700 : 500,
                    background: filter === k ? "var(--brand-primary)" : "var(--surface-raised)",
                    color: filter === k ? "#fff" : "var(--muted)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Notification List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
              {query.isLoading && (
                <div style={{ padding: 40, textAlign: "center" }}>
                  <div className="loader" />
                </div>
              )}

              {items.map((item) => {
                const isOverdue = item.days_diff < 0;
                const isUnread = !item.read_at;

                return (
                  <div
                    key={item.id}
                    style={{
                      background: isUnread ? "var(--surface-raised)" : "var(--surface)",
                      border: isUnread ? "1.5px solid var(--brand-primary)" : "1px solid var(--border)",
                      borderLeftWidth: 4,
                      borderLeftColor: isOverdue ? "var(--danger)" : "var(--brand-primary)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      marginBottom: 10,
                      boxShadow: isUnread ? "0 2px 8px rgba(14,146,125,0.08)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <PriorityBadge priority={item.priority} />
                        {isOverdue && (
                          <span
                            style={{
                              background: "var(--danger-soft)",
                              color: "var(--danger)",
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            දින {Math.abs(item.days_diff)} ක් ප්‍රමාදයි
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>
                        {item.created_at.slice(0, 16).replace("T", " ")}
                      </span>
                    </div>

                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>
                      {item.shop_name}
                    </div>

                    <div style={{ fontSize: 12, lineHeight: 1.4, color: "var(--text)", marginBottom: 8 }}>
                      {item.body}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 10,
                        padding: "6px 8px",
                        background: "var(--surface-raised)",
                        borderRadius: 6,
                      }}
                    >
                      <span>බිල්පත: <strong>{item.invoice_number}</strong></span>
                      <span>හිඟ මුදල: <strong style={{ color: isOverdue ? "var(--danger)" : "inherit" }}>{money(item.outstanding_cents)}</strong></span>
                      <span>නියමිත: <strong>{item.due_at || "—"}</strong></span>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {item.invoice_id && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "4px 8px", fontSize: 11, gap: 4 }}
                          onClick={() => {
                            onViewInvoice(item.invoice_id!);
                            setOpen(false);
                          }}
                        >
                          <Eye size={13} /> බිල්පත
                        </button>
                      )}

                      {item.customer_id && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "4px 8px", fontSize: 11, gap: 4 }}
                          onClick={() => {
                            onViewCustomer(item.customer_id!);
                            setOpen(false);
                          }}
                        >
                          <Wallet size={13} /> ගිණුම
                        </button>
                      )}

                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: "4px 8px", fontSize: 11, gap: 4, color: "var(--success)" }}
                        onClick={() => setActiveWhatsAppModal(item)}
                      >
                        <MessageCircle size={13} /> WhatsApp
                      </button>

                      {isUnread && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "4px 8px", fontSize: 11, gap: 4, marginLeft: "auto" }}
                          onClick={(e) => markAsRead(item.id, e)}
                        >
                          <Check size={13} /> කියවූ
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {!query.isLoading && items.length === 0 && (
                <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--muted)" }}>
                  <CheckCircle size={32} style={{ color: "var(--success)", margin: "0 auto 10px" }} />
                  <div style={{ fontWeight: 700, fontSize: 14 }}>කිසිදු දැනුම්දීමක් නොමැත</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>සියලු ණය ගෙවීම් යාවත්කාලීනයි</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Reminder Direct Modal */}
      {activeWhatsAppModal && (
        <WhatsAppReminderSenderModal
          item={{
            invoiceId: activeWhatsAppModal.invoice_id || "",
            invoiceNumber: activeWhatsAppModal.invoice_number,
            shopName: activeWhatsAppModal.shop_name,
            outstandingCents: activeWhatsAppModal.outstanding_cents,
            dueDate: activeWhatsAppModal.due_at || "",
            phone: activeWhatsAppModal.customer_whatsapp,
            notificationId: activeWhatsAppModal.id,
          }}
          onClose={() => setActiveWhatsAppModal(null)}
        />
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. WHATSAPP REMINDER SENDER MODAL
// ═════════════════════════════════════════════════════════════════════════════
export function WhatsAppReminderSenderModal({
  item,
  onClose,
}: {
  item: {
    invoiceId: string;
    invoiceNumber: string;
    shopName: string;
    outstandingCents: number;
    dueDate: string;
    phone: string;
    notificationId?: string;
  };
  onClose: () => void;
}) {
  const [recipientPhone, setRecipientPhone] = useState(item.phone || "");
  const [message, setMessage] = useState(() => {
    return `ආයුබෝවන් ${item.shopName},

ඔබගේ බිල්පත් අංකය: ${item.invoiceNumber}
ගෙවීමට ඉතිරි මුදල: ${money(item.outstandingCents)}
ගෙවිය යුතු දිනය: ${item.dueDate}

කරුණාකර නියමිත දිනයට පෙර ගෙවීම සිදු කරන්න.

ස්තුතියි,
Nugathalawa Ceylon Tea Export (Pvt) Ltd`;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendReminder() {
    if (!recipientPhone.trim()) {
      setError("කරුණාකර දුරකථන අංකය ඇතුළත් කරන්න");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api<{ ok: boolean; whatsappUrl: string }>("/credit-alerts/send-whatsapp", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: item.invoiceId,
          recipientPhone,
          message,
          notificationId: item.notificationId,
        }),
      });

      if (res.whatsappUrl) {
        window.open(res.whatsappUrl, "_blank");
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || "WhatsApp සබැඳිය විවෘත කිරීමට නොහැකි විය");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      data-overlay
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 480,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-raised)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageCircle size={20} style={{ color: "var(--success)" }} />
            <strong style={{ fontSize: 15 }}>WhatsApp මතක් කිරීම (Payment Reminder)</strong>
          </div>
          <button type="button" className="secondary" data-close aria-label="Close" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {error && (
            <div
              style={{
                background: "var(--danger-soft)",
                color: "var(--danger-strong)",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
              ලබන්නාගේ WhatsApp අංකය (Recipient WhatsApp)
            </label>
            <input
              type="tel"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="0771234567 හෝ 94771234567"
              required
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
              පණිවිඩය (Message Preview)
            </label>
            <textarea
              rows={8}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ width: "100%", fontSize: 12, lineHeight: 1.5, fontFamily: "inherit" }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="secondary" onClick={onClose}>
              අවලංගු කරන්න
            </button>
            <button
              type="button"
              className="primary"
              onClick={sendReminder}
              disabled={loading}
              style={{ background: "var(--success)", gap: 6 }}
            >
              <Send size={15} />
              {loading ? "සූදානම් වෙමින්…" : "WhatsApp වෙත යවන්න"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. CREDIT ALERTS DASHBOARD MODULE
// ═════════════════════════════════════════════════════════════════════════════
export function CreditAlertsDashboardPanel({
  onViewInvoice,
  onViewCustomer,
  isAdmin,
}: {
  onViewInvoice: (id: string) => void;
  onViewCustomer: (id: string) => void;
  isAdmin: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "due_soon" | "due_today" | "overdue" | "high_risk">("all");
  const [activeWhatsAppModal, setActiveWhatsAppModal] = useState<CreditAlertItem | null>(null);
  const [flash, setFlash] = useState("");
  const [runningCheck, setRunningCheck] = useState(false);
  const client = useQueryClient();

  const query = useQuery<{ stats: CreditAlertStats; alerts: CreditAlertItem[] }>({
    queryKey: ["credit-alerts"],
    queryFn: () => api("/credit-alerts"),
  });

  const stats = query.data?.stats;
  const allAlerts = query.data?.alerts || [];

  const filteredAlerts = allAlerts.filter((item) => {
    const matchesSearch =
      item.shop_name.toLowerCase().includes(search.toLowerCase()) ||
      item.number.toLowerCase().includes(search.toLowerCase()) ||
      item.owner_name.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === "all") return true;
    if (statusFilter === "due_soon") return item.status_category === "due_soon";
    if (statusFilter === "due_today") return item.status_category === "due_today";
    if (statusFilter === "overdue") return item.status_category === "overdue";
    if (statusFilter === "high_risk") return item.is_high_risk;

    return true;
  });

  async function triggerManualCheck() {
    setRunningCheck(true);
    try {
      const res = await api<{ ok: boolean; checked: number; created: number }>("/credit-alerts/run-check", {
        method: "POST",
      });
      setFlash(`පරීක්ෂාව සාර්ථකයි ✓ — බිල්පත් ${res.checked} ක් පරීක්ෂා කර නව දැනුම්දීම් ${res.created} ක් සකස් විය.`);
      await client.invalidateQueries();
    } catch (err: any) {
      setFlash(err?.message || "පරීක්ෂාව අසාර්ථක විය");
    } finally {
      setRunningCheck(false);
      setTimeout(() => setFlash(""), 6000);
    }
  }

  return (
    <>
      {flash && (
        <div
          style={{
            background: flash.includes("✓") ? "var(--success-soft)" : "var(--danger-soft)",
            color: flash.includes("✓") ? "var(--success-strong)" : "var(--danger-strong)",
            padding: "10px 20px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {flash}
        </div>
      )}

      {/* Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="stat-card">
          <small>මුළු හිඟ ණය (Total Credit)</small>
          <strong>{money(stats?.totalOutstandingCents || 0)}</strong>
        </div>

        <div className="stat-card alert" style={{ borderColor: "var(--danger)" }}>
          <small style={{ color: "var(--danger)" }}>ප්‍රමාද වූ ණය (Overdue)</small>
          <strong style={{ color: "var(--danger)" }}>{money(stats?.overdueCents || 0)}</strong>
        </div>

        <div className="stat-card" style={{ borderColor: "var(--warning)" }}>
          <small style={{ color: "var(--warning)" }}>අද ගෙවිය යුතු (Due Today)</small>
          <strong style={{ color: "var(--warning)" }}>{money(stats?.dueTodayCents || 0)}</strong>
        </div>

        <div className="stat-card">
          <small>දින 7 තුළ ගෙවිය යුතු</small>
          <strong>{money(stats?.dueWithin7DaysCents || 0)}</strong>
        </div>

        <div className="stat-card">
          <small>දින 14 තුළ ගෙවිය යුතු</small>
          <strong>{money(stats?.dueWithin14DaysCents || 0)}</strong>
        </div>

        <div className="stat-card" style={{ borderColor: "var(--danger)" }}>
          <small style={{ color: "var(--danger)" }}>අධි අවදානම් පාරිභෝගිකයින්</small>
          <strong style={{ color: "var(--danger)" }}>{stats?.highRiskCount || 0}</strong>
        </div>

        <div className="stat-card">
          <small>නොගෙවූ බිල්පත් ගණන</small>
          <strong>{stats?.totalUnpaidCount || 0}</strong>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="panel" style={{ marginBottom: 16, padding: "14px 18px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 260 }}>
            <Search size={16} style={{ color: "var(--muted)" }} />
            <input
              type="text"
              placeholder="කඩේ නම, අයිතිකරු හෝ බිල්පත් අංකය සොයන්න..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 12px" }}
            />
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { k: "all", label: `සියල්ල (${allAlerts.length})` },
              { k: "overdue", label: `ප්‍රමාදයි (${allAlerts.filter((x) => x.status_category === "overdue").length})` },
              { k: "due_today", label: `අද දිනය (${allAlerts.filter((x) => x.status_category === "due_today").length})` },
              { k: "due_soon", label: `දිනය ළඟයි (${allAlerts.filter((x) => x.status_category === "due_soon").length})` },
              { k: "high_risk", label: `අධි අවදානම් (${allAlerts.filter((x) => x.is_high_risk).length})` },
            ].map(({ k, label }) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k as any)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: statusFilter === k ? 700 : 500,
                  border: "none",
                  cursor: "pointer",
                  background: statusFilter === k ? "var(--brand-primary)" : "var(--surface-raised)",
                  color: statusFilter === k ? "#fff" : "var(--muted)",
                }}
              >
                {label}
              </button>
            ))}

            {isAdmin && (
              <button
                type="button"
                className="secondary"
                disabled={runningCheck}
                onClick={triggerManualCheck}
                style={{ padding: "5px 12px", fontSize: 11, gap: 5, marginLeft: 8 }}
                title="ණය මතක් කිරීම් පද්ධතිය දැන්ම ධාවනය කර පරීක්ෂා කරන්න"
              >
                <RefreshCw size={13} className={runningCheck ? "spin" : ""} />
                {runningCheck ? "පරීක්ෂා වෙමින්…" : "දැන්ම පරීක්ෂා කරන්න"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Credit Alerts Table */}
      <div className="panel">
        <div className="panel-head">
          <h3>ණය ගෙවීමේ මතක් කිරීම් සටහන</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            ප්‍රතිඵල: {filteredAlerts.length}
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>බිල්පත් අංකය</th>
                <th>කඩේ නම & අයිතිකරු</th>
                <th>විකුණුම් නියෝජිත</th>
                <th>නියමිත දිනය</th>
                <th>තත්ත්වය (Status)</th>
                <th>හිඟ මුදල (LKR)</th>
                <th>ප්‍රමුඛතාව</th>
                <th>ක්‍රියාකාරකම් (Actions)</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((item) => {
                const isOverdue = item.days_diff < 0;

                return (
                  <tr key={item.id}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onViewInvoice(item.id)}
                      >
                        <strong>{item.number}</strong>
                      </button>
                    </td>
                    <td>
                      <div>
                        <strong>{item.shop_name}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {item.owner_name} {item.target_phone ? `· ${item.target_phone}` : ""}
                      </div>
                    </td>
                    <td>{item.rep_name}</td>
                    <td>
                      <div>{item.due_at}</div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: isOverdue ? "var(--danger)" : item.days_diff === 0 ? "var(--warning)" : "var(--muted)",
                        }}
                      >
                        {isOverdue
                          ? `දින ${Math.abs(item.days_diff)} ක් ප්‍රමාදයි`
                          : item.days_diff === 0
                            ? "අද ගෙවිය යුතුය"
                            : `තව දින ${item.days_diff} යි`}
                      </div>
                    </td>
                    <td>
                      {item.is_high_risk ? (
                        <span
                          style={{
                            background: "var(--danger-soft)",
                            color: "var(--danger)",
                            padding: "2px 8px",
                            borderRadius: 99,
                            fontSize: 10,
                            fontWeight: 800,
                          }}
                        >
                          අධි අවදානම්
                        </span>
                      ) : isOverdue ? (
                        <span className="badge due">ප්‍රමාදයි</span>
                      ) : item.days_diff === 0 ? (
                        <span className="badge warning">අද දිනය</span>
                      ) : (
                        <span className="badge">ක්‍රියාකාරී</span>
                      )}
                    </td>
                    <td style={{ color: isOverdue ? "var(--danger)" : "inherit", fontWeight: 800 }}>
                      {money(item.outstanding_cents)}
                    </td>
                    <td>
                      <PriorityBadge priority={item.priority} />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "4px 8px", fontSize: 11, color: "var(--success)", gap: 3 }}
                          onClick={() => setActiveWhatsAppModal(item)}
                          title="WhatsApp මතක් කිරීමක් යවන්න"
                        >
                          <MessageCircle size={13} /> WhatsApp
                        </button>

                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => onViewCustomer(item.customer_id)}
                          title="පාරිභෝගික ගිණුම් ලෙජරය බලන්න"
                        >
                          ගිණුම
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredAlerts.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
              {query.isLoading ? "පූරණය වෙමින් පවතී…" : "සෙවුමට ගැළපෙන ණය මතක් කිරීම් නොමැත."}
            </div>
          )}
        </div>
      </div>

      {activeWhatsAppModal && (
        <WhatsAppReminderSenderModal
          item={{
            invoiceId: activeWhatsAppModal.id,
            invoiceNumber: activeWhatsAppModal.number,
            shopName: activeWhatsAppModal.shop_name,
            outstandingCents: activeWhatsAppModal.outstanding_cents,
            dueDate: activeWhatsAppModal.due_at,
            phone: activeWhatsAppModal.target_phone,
          }}
          onClose={() => setActiveWhatsAppModal(null)}
        />
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. SETTINGS → CREDIT ALERTS PANEL
// ═════════════════════════════════════════════════════════════════════════════
export function CreditAlertSettingsPanel() {
  const client = useQueryClient();
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);

  const query = useQuery<CreditAlertSettings>({
    queryKey: ["credit-alert-settings"],
    queryFn: () => api("/credit-alerts/settings"),
  });

  const logsQuery = useQuery<any[]>({
    queryKey: ["credit-alert-scheduler-logs"],
    queryFn: () => api("/credit-alerts/scheduler-logs"),
  });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFlash("");

    const fd = new FormData(e.currentTarget);
    const enabled = fd.get("enabled") === "1" ? 1 : 0;
    const scheduleDays = String(fd.get("scheduleDays") || "14,7,3,0");
    const overdueFrequencyDays = Number(fd.get("overdueFrequencyDays") || 7);
    const recipients = String(fd.get("recipients") || "both");
    const language = String(fd.get("language") || "si");
    const whatsappTemplate = String(fd.get("whatsappTemplate") || "");
    const retentionDays = Number(fd.get("retentionDays") || 90);

    try {
      await api("/credit-alerts/settings", {
        method: "PATCH",
        body: JSON.stringify({
          enabled,
          scheduleDays,
          overdueFrequencyDays,
          recipients,
          language,
          whatsappTemplate,
          retentionDays,
        }),
      });

      setFlash("ණය මතක් කිරීම් සැකසුම් සුරැකිණි ✓");
      await client.invalidateQueries({ queryKey: ["credit-alert-settings"] });
    } catch (err: any) {
      setFlash(err?.message || "සුරැකීම අසාර්ථක විය");
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(""), 4500);
    }
  }

  const s = query.data;

  if (query.isLoading) return <div className="loader" />;

  return (
    <div className="panel form-panel" style={{ marginTop: 20 }}>
      <div className="panel-head">
        <h3>ණය මතක් කිරීම් සැකසුම් (Credit Alert Settings)</h3>
      </div>

      {flash && (
        <div
          style={{
            background: flash.includes("✓") ? "var(--success-soft)" : "var(--danger-soft)",
            color: flash.includes("✓") ? "var(--success-strong)" : "var(--danger-strong)",
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {flash}
        </div>
      )}

      <form onSubmit={submit} key={s?.updated_at || "default"}>
        <div className="form-grid">
          <label>
            ස්වයංක්‍රීය මතක් කිරීම් සක්‍රීය කරන්න (Enable Alerts)
            <select name="enabled" defaultValue={s?.enabled ? "1" : "0"}>
              <option value="1">සක්‍රීයයි (Enabled)</option>
              <option value="0">අක්‍රීයයි (Disabled)</option>
            </select>
          </label>

          <label>
            මතක් කිරීම් සිදුකළ යුතු දින (Days Before Due)
            <input
              name="scheduleDays"
              defaultValue={s?.schedule_days || "14,7,3,0"}
              placeholder="14,7,3,0"
              required
            />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              කොමා මගින් වෙන් කරන්න (උදා: 14, 7, 3, 0)
            </span>
          </label>

          <label>
            ප්‍රමාද වූ පසු මතක් කිරීමේ සංඛ්‍යාතය (Overdue Frequency in Days)
            <input
              type="number"
              name="overdueFrequencyDays"
              min="1"
              max="30"
              defaultValue={s?.overdue_frequency_days || 7}
              required
            />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              දින කීයකට වරක්ද (උදා: දින 7 කට වරක්)
            </span>
          </label>

          <label>
            දැනුම්දීම් ලබන්නන් (Alert Recipients)
            <select name="recipients" defaultValue={s?.recipients || "both"}>
              <option value="both">පරිපාලක සහ විකුණුම් නියෝජිත (Both)</option>
              <option value="rep">නියෝජිතයා පමණක් (Sales Rep Only)</option>
              <option value="admin">පරිපාලක පමණක් (Admin Only)</option>
            </select>
          </label>

          <label>
            දැනුම්දීම් භාෂාව (Notification Language)
            <select name="language" defaultValue={s?.language || "si"}>
              <option value="si">සිංහල (Sinhala - Default)</option>
              <option value="en">English</option>
            </select>
          </label>

          <label>
            දැනුම්දීම් රඳවා ගැනීමේ දින (Retention Days)
            <input
              type="number"
              name="retentionDays"
              min="7"
              max="365"
              defaultValue={s?.retention_days || 90}
              required
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 6 }}>
            WhatsApp පණිවිඩ ආකෘතිය (WhatsApp Message Template)
          </label>
          <textarea
            name="whatsappTemplate"
            rows={6}
            defaultValue={s?.whatsapp_template || ""}
            style={{ width: "100%", fontSize: 12, lineHeight: 1.5, fontFamily: "inherit" }}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            භාවිත කළ හැකි ටෝකන: <code>{"{shop_name}"}</code>, <code>{"{invoice_number}"}</code>,{" "}
            <code>{"{outstanding}"}</code>, <code>{"{due_date}"}</code>
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: 20 }}>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "සුරැකෙමින්…" : "සැකසුම් සුරකින්න"}
          </button>
        </div>
      </form>

      {/* Scheduler Execution Logs */}
      <div style={{ marginTop: 32, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>පසුගිය ස්වයංක්‍රීය ධාවන සටහන් (Scheduler Execution Logs)</h4>
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>දිනය සහ වේලාව</th>
                <th>තත්ත්වය</th>
                <th>සාරාංශය</th>
                <th>පරීක්ෂා කළ බිල්පත්</th>
                <th>ජනනය වූ ඇලර්ට්</th>
              </tr>
            </thead>
            <tbody>
              {(logsQuery.data || []).slice(0, 5).map((log: any) => (
                <tr key={log.id}>
                  <td>{log.executed_at.slice(0, 19).replace("T", " ")}</td>
                  <td>
                    <span className={`badge ${log.status === "success" ? "" : "due"}`}>
                      {log.status}
                    </span>
                  </td>
                  <td>{log.summary || log.error || "—"}</td>
                  <td>{log.invoices_checked}</td>
                  <td>{log.alerts_created}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logsQuery.data?.length && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>
              ධාවන සටහන් තවමත් නොමැත.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
