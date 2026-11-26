"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  Box,
  Building2,
  ClipboardList,
  CreditCard,
  Download,
  FileText,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PackageCheck,
  Plus,
  Settings,
  Shield,
  ShoppingBag,
  Users,
  Warehouse,
  X,
  RotateCcw,
  ChevronRight,
  ReceiptText,
  UserRound,
  BookOpen,
  Wallet,
  MoreHorizontal,
  TrendingUp,
  Truck,
  MapPin,
} from "lucide-react";
import { api, idempotency, money } from "@/lib/api";
import { InvoiceActions } from "@/components/invoice-actions";
import { ProductAdminActions, StockAdminActions } from "@/components/admin-records";
import type { InvoiceDetail } from "@/lib/invoice/model";
import { DutyPanel } from "@/components/duty-panel";
import { LiveTracking } from "@/components/live-tracking";
import { endDutyForLogout, initTracking } from "@/lib/tracking";
import { BiometricSettings } from "@/components/biometric-login";
import { UserGuide } from "@/components/user-guide";
import { PrinterSettingsPanel } from "@/components/printer-settings";
import { FreeIssueSettings } from "@/components/free-issue-settings";
import { disableBiometric } from "@/lib/biometric";
import { isNative } from "@/lib/native";
import { ReportsPanel } from "@/components/reports-panel";
import {
  NotificationBellAndDrawer,
  CreditAlertsDashboardPanel,
  CreditAlertSettingsPanel,
} from "@/components/notification-alerts";
import {
  CustomerAccountModal,
  ExpensesPanel,
  CreditNotesPanel,
  ChangePasswordPanel,
  StockTransferPanel,
} from "@/components/erp-panels";
import {
  BillingPanel,
  BillingSettings,
  ConsignmentPanel,
  FreeIssuePanel,
} from "@/components/distribution-panels";
import { LogisticsPanel } from "@/components/logistics-panel";
type User = { id: string; name: string; admin: number; role_id: string };
type Summary = {
  totalSalesCents: number;
  todaySalesCents: number;
  monthlySalesCents: number;
  outstandingCents: number;
  overdueCents: number;
  activeShops: number;
  activeReps: number;
  lowStock: number;
};
type Product = {
  id: string;
  name: string;
  sku: string;
  variant_id: string;
  label: string;
  unit: string;
  main_stock: number;
  wholesale_cents: number;
  retail_cents: number;
  shop_price_cents: number;
  low_stock: number;
};
type Customer = {
  id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  type: string;
  credit_days: number;
  credit_limit_cents: number;
};
type Invoice = {
  id: string;
  number: string;
  shop_name: string;
  total_cents: number;
  paid_cents: number;
  due_at: string | null;
  status: string;
  created_at: string;
};
type Stock = {
  warehouse_id: string;
  variant_id: string;
  name: string;
  label: string;
  warehouse: string;
  quantity: number;
  available_quantity?: number;
  reserved_quantity?: number;
  allocated_quantity?: number;
  damaged_quantity?: number;
  location_type?: string;
};
const menu = [
  { name: "Overview", si: "දළ විශ්ලේෂණය", icon: LayoutDashboard },
  { name: "Products", si: "නිෂ්පාදන", icon: Box },
  { name: "Inventory", si: "තොග", icon: Warehouse },
  { name: "Distribution", si: "බෙදාහැරීම", icon: Truck },
  { name: "Live Tracking", si: "සජීවී ලුහුබැඳීම", icon: MapPin },
  { name: "Customers", si: "ගනුදෙනුකරුවන්", icon: Building2 },
  { name: "Invoices", si: "බිල්පත් / POS", icon: FileText },
  { name: "Free Issues", si: "නොමිලේ නිකුත් කිරීම්", icon: Gift },
  { name: "Consignments", si: "භාර තොග", icon: PackageCheck },
  { name: "Payments", si: "ගෙවීම්", icon: CreditCard },
  { name: "Credit Alerts", si: "ණය මතක් කිරීම්", icon: Bell },
  { name: "Expenses", si: "වියදම්", icon: ArrowDownLeft },
  { name: "Returns", si: "ආපසු භාණ්ඩ", icon: RotateCcw },
  { name: "Reports", si: "වාර්තා", icon: BarChart3 },
  { name: "Team", si: "කණ්ඩායම", icon: Users },
  { name: "Settings", si: "සැකසුම්", icon: Settings },
  { name: "Profile", si: "මගේ ගිණුම", icon: UserRound },
  { name: "Help", si: "මාර්ගෝපදේශය", icon: BookOpen },
];
const siLabel = (name: string) => menu.find((m) => m.name === name)?.si || "";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20000 } },
});
// Offline sync finished uploading: refresh every screen so PENDING items show their server numbers.
if (typeof window !== "undefined") window.addEventListener("erp-synced", () => { queryClient.invalidateQueries(); });
export default function Dashboard() {
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace />
    </QueryClientProvider>
  );
}
function Workspace() {
  const router = useRouter(),
    client = useQueryClient(),
    [tab, setTab] = useState("Overview"),
    [open, setOpen] = useState(false),
    [toast, setToast] = useState(""),
    [invoiceId, setInvoiceId] = useState<string | null>(null),
    [customerAccountId, setCustomerAccountId] = useState<string | null>(null),
    [focusBilling, setFocusBilling] = useState(false),
    [editInvoice, setEditInvoice] = useState<InvoiceDetail | null>(null),
    [showVoided, setShowVoided] = useState(false),
    [editingUser, setEditingUser] = useState<{ id: string; name: string; username?: string; role_id: string } | null>(null),
    [editUsername, setEditUsername] = useState(""),
    [editPassword, setEditPassword] = useState(""),
    [editPasscode, setEditPasscode] = useState(""),
    [editMsg, setEditMsg] = useState(""),
    [editBusy, setEditBusy] = useState(false);
  const reduced = useReducedMotion();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User }>("/me"),
    retry: false,
  });
  useEffect(() => {
    if (me.isError) router.replace("/login");
  }, [me.isError, router]);
  // Android back button: close the drawer first, then return to Overview.
  useEffect(() => {
    const onBack = (e: Event) => {
      if (open) { setOpen(false); e.preventDefault(); }
      else if (tab !== "Overview") { setTab("Overview"); e.preventDefault(); }
    };
    window.addEventListener("erp-back", onBack);
    return () => window.removeEventListener("erp-back", onBack);
  }, [open, tab]);
  const user = me.data?.user;
  // Resume a running duty (GPS) after reload / app restart, and send anything recorded offline.
  useEffect(() => {
    if (user?.id) void initTracking(user.id);
  }, [user?.id]);
  const summary = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Summary>("/dashboard"),
    enabled: !!user,
  });
  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api<Invoice[]>("/invoices"),
    enabled: !!user,
  });
  const products = useQuery({
    queryKey: ["products"],
    queryFn: () => api<Product[]>("/products"),
    enabled: !!user,
  });
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => api<Customer[]>("/customers"),
    enabled: !!user,
  });
  const stocks = useQuery({
    queryKey: ["stock"],
    queryFn: () => api<Stock[]>("/stock"),
    enabled: !!user,
  });
  const staff = useQuery({
    queryKey: ["users"],
    queryFn: () =>
      api<
        Array<{
          id: string;
          name: string;
          email: string;
          role_id: string;
          active: number;
        }>
      >("/users"),
    enabled: !!user?.admin,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{
        name: string;
        address: string;
        email: string;
        phone: string;
        whatsapp: string;
      }>("/settings"),
    enabled: !!user?.admin,
  });
  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  }
  async function submit(path: string, payload: unknown, method = "POST") {
    try {
      await api(path, { method, body: JSON.stringify(payload) });
      flash("Saved successfully");
      await client.invalidateQueries();
    } catch (e) {
      flash((e as Error).message);
    }
  }
  function changeTab(name: string) {
    setTab(name);
    setOpen(false);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }
  function openBilling() {
    changeTab("Invoices");
    setFocusBilling(true);
  }
  useEffect(() => {
    if (!focusBilling || tab !== "Invoices") return;
    const t = setTimeout(() => {
      document
        .getElementById("quick-billing")
        ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      setFocusBilling(false);
    }, 280);
    return () => clearTimeout(t);
  }, [focusBilling, tab, reduced]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  if (me.isLoading)
    return (
      <div className="main-content" style={{ paddingTop: 50 }}>
        <div className="loader" />
      </div>
    );
  if (!user) return null;
  const visibleMenu = menu.filter(
    (i) => user.admin || (
      !["Team", "Settings", "Reports", "Expenses", "Live Tracking"].includes(i.name) &&
      (i.name !== "Distribution" || user.role_id === "sales_rep")
    ),
  );
  const roleLabel = user.admin ? "Admin" : "Sales Representative";
  const bottomItems = [
    { name: "Overview", label: "Home", icon: LayoutDashboard },
    { name: "Customers", label: "Shops", icon: Building2 },
    { name: "Invoices", label: "Bill", icon: ReceiptText, fab: true },
    { name: "Payments", label: "Collect", icon: Wallet },
  ];
  const inBottom = bottomItems.some((b) => b.name === tab);
  async function signOut() {
    // Sign out revokes the server session, so the biometric credential
    // protecting it is useless: remove it from this phone as well.
    if (isNative()) {
      const off = await import("@/lib/offline/store");
      const st = off.getSyncState();
      const waiting = st.pending + st.conflicts + st.failed;
      if (waiting && !confirm(`${waiting} item(s) are saved on this phone and not yet on the server. They stay on the phone and upload after you sign in again. Sign out anyway?`)) return;
      await off.clearCache().catch(() => {});
    }
    await disableBiometric();
    await endDutyForLogout();
    await api("/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }
  return (
    <div className="app-shell">
      <div
        className={`mobile-overlay ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="app-drawer"
        className={`sidebar ${open ? "open" : ""}`}
        aria-label="Main menu"
      >
        <div className="sidebar-brand">
          <span className="sidebar-logo">
            <img src="/nugathalawa-logo.jpg" alt="Nugathalawa Ceylon Tea" />
          </span>
          <div>
            <b>NUGATHALAWA TEA</b>
            <small>DISTRIBUTION ERP</small>
          </div>
          <button
            className="sidebar-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="sidebar-user"
          style={{ textAlign: "left", width: "auto", cursor: "pointer" }}
          onClick={() => changeTab("Profile")}
        >
          <span className="avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span style={{ minWidth: 0 }}>
            <b>{user.name}</b>
            <small>{roleLabel}</small>
          </span>
        </button>
        <div className="nav-label">WORKSPACE · වැඩබිම</div>
        <nav aria-label="Primary navigation">
          {visibleMenu.map(({ name, si, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${tab === name ? "active" : ""}`}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => changeTab(name)}
            >
              {tab === name && (
                <motion.span
                  layoutId={reduced ? undefined : "nav-active"}
                  className="nav-active-bg"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <Icon size={19} />
              <span className="nav-text">
                {name}
                <small className="si" lang="si">{si}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={signOut}>
            <LogOut size={19} />
            <span className="nav-text">
              Sign out
              <small className="si" lang="si">පිටවීම</small>
            </span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="secondary mobile-menu"
              aria-label="Open menu"
              aria-controls="app-drawer"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div>
              <span className="eyebrow">
                {settings.data?.name || "Nugathalawa Ceylon Tea Export"}
              </span>
              <h1>
                {tab}
                <small className="si" lang="si">{siLabel(tab)}</small>
              </h1>
            </div>
          </div>
          <div className="topbar-right">
            <NotificationBellAndDrawer
              onViewInvoice={setInvoiceId}
              onViewCustomer={setCustomerAccountId}
            />
            <span className="topbar-user">
              <b>{user.name}</b>
              <span>{roleLabel}</span>
            </span>
            <button
              className="avatar"
              aria-label={`${user.name} profile`}
              onClick={() => changeTab("Profile")}
            >
              {user.name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <AnimatePresence>
          {toast && (
            <motion.div
              className="toast"
              role="status"
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          key={tab}
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 0.8, 0.24, 1] }}
          className="main-section"
        >
          {customerAccountId && (
            <CustomerAccountModal
              customerId={customerAccountId}
              onClose={() => setCustomerAccountId(null)}
              onViewInvoice={(id) => {
                setCustomerAccountId(null);
                setInvoiceId(id);
              }}
            />
          )}
          {invoiceId && (
            <InvoiceActions
              id={invoiceId}
              close={() => setInvoiceId(null)}
              admin={!!user.admin}
              onEdit={(d) => {
                setInvoiceId(null);
                setEditInvoice(d);
                openBilling();
              }}
            />
          )}{" "}
          {tab === "Overview" && !user.admin && (
            <DutyPanel userId={user.id} customers={customers.data || []} />
          )}
          {tab === "Live Tracking" && user.admin && (
            <>
              <Lead
                title="Live rep tracking · සජීවී නියෝජිත ලුහුබැඳීම"
                subtitle="Where your sales reps are now, their route, distance and shop visits."
              />
              <LiveTracking />
            </>
          )}
          {tab === "Overview" && (
            <Overview
              user={user}
              summary={summary.data}
              loading={summary.isLoading}
              invoices={invoices.data || []}
              reduced={!!reduced}
              go={changeTab}
              openBilling={openBilling}
              onSelectInvoice={setInvoiceId}
            />
          )}
          {tab === "Products" && (
            <>
              <Lead
                title="Products & variants"
                subtitle="Manage your catalogue and prices from one place."
              />
              <div className="panel">
                <ProductTable rows={products.data || []} admin={!!user.admin} />
              </div>
              {user.admin && (
                <FormPanel title="Add a product">
                  <ProductForm submit={submit} />
                </FormPanel>
              )}
            </>
          )}
          {tab === "Customers" && (
            <>
              <Lead
                title="Shops & customers"
                subtitle="Customer records and assigned shops."
              />
              <div className="panel">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Shop</th>
                        <th>Owner</th>
                        <th>Phone</th>
                        <th>Type</th>
                        <th>Credit terms</th>
                        <th>Account</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(customers.data || []).map((c) => (
                        <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setCustomerAccountId(c.id)}>
                          <td>
                            <button
                              type="button"
                              className="link-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCustomerAccountId(c.id);
                              }}
                            >
                              <strong>{c.shop_name}</strong>
                            </button>
                          </td>
                          <td>{c.owner_name}</td>
                          <td>{c.phone || "—"}</td>
                          <td>
                            <span className="badge">{c.type}</span>
                          </td>
                          <td>{c.credit_days} days</td>
                          <td>
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCustomerAccountId(c.id);
                              }}
                            >
                              Account
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!customers.data?.length && (
                    <Empty text="No shops registered yet." />
                  )}
                </div>
              </div>
              <FormPanel title="Register a shop">
                <CustomerForm
                  submit={submit}
                  admin={!!user.admin}
                  staff={staff.data || []}
                />
              </FormPanel>
            </>
          )}
          {tab === "Inventory" && (
            <>
              <Lead
                title="Stock control"
                subtitle="Warehouse balances update with every posted invoice."
              />
              <div className="panel">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Variant</th>
                        <th>Warehouse</th>
                        <th>Available</th>
                        <th>Reserved</th>
                        <th>Allocated</th>
                        <th>Damaged</th>
                        {user.admin && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(stocks.data || []).map((s, i) => (
                        <tr key={`${s.warehouse_id}:${s.variant_id}`}>
                          <td>{s.name}</td>
                          <td>{s.label}</td>
                          <td>{s.warehouse}</td>
                          <td><b>{s.available_quantity ?? s.quantity}</b></td>
                          <td>{s.reserved_quantity || 0}</td>
                          <td>{s.allocated_quantity || 0}</td>
                          <td>{s.damaged_quantity || 0}</td>
                          {user.admin && (
                            <td>
                              <StockAdminActions warehouseId={s.warehouse_id} variantId={s.variant_id} quantity={s.quantity} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!stocks.data?.length && (
                    <Empty text="No stock movements recorded yet." />
                  )}
                </div>
              </div>
              {user.admin && (
                <FormPanel title="Stock adjustment">
                  <StockForm products={products.data || []} submit={submit} />
                </FormPanel>
              )}
              {user.admin && (
                <div style={{ marginTop: 20 }}>
                  <div className="panel form-panel">
                    <div className="panel-head">
                      <h3>Stock transfers</h3>
                    </div>
                    <StockTransferPanel products={products.data || []} stocks={stocks.data || []} />
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "Distribution" && (
            <>
              <Lead
                title="Distribution control"
                subtitle="Warehouse, representative and vehicle stock through daily route reconciliation."
              />
              <LogisticsPanel
                isAdmin={!!user.admin}
                products={products.data || []}
                stocks={stocks.data || []}
                staff={staff.data || []}
                customers={customers.data || []}
              />
            </>
          )}
          {tab === "Invoices" && (
            <>
              <Lead
                title="Invoices & billing"
                subtitle="Draft, preview, finalize, print and share professional invoices."
              />
              <div className="panel">
                {user.admin && (invoices.data || []).some((i) => i.status === "cancelled") && (
                  <label className="muted" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                    <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
                    Show deleted (voided) invoices
                  </label>
                )}
                <InvoiceTable
                  rows={(invoices.data || []).filter((i) => showVoided || i.status !== "cancelled")}
                  onSelect={setInvoiceId}
                />
              </div>
              <div id="quick-billing" style={{ marginTop: 20, scrollMarginTop: 90 }}>
                <BillingPanel
                  customers={customers.data || []}
                  products={products.data || []}
                  stocks={stocks.data || []}
                  onPosted={(id) => {
                    setEditInvoice(null);
                    setInvoiceId(id);
                  }}
                  editInvoice={editInvoice}
                  onCancelEdit={() => setEditInvoice(null)}
                />
              </div>
            </>
          )}
          {tab === "Free Issues" && (
            <>
              <Lead
                title="Free issues"
                subtitle="Issue samples and promotions without revenue or customer debt."
              />
              <FreeIssuePanel
                customers={customers.data || []}
                products={products.data || []}
                stocks={stocks.data || []}
              />
            </>
          )}
          {tab === "Consignments" && (
            <>
              <Lead
                title="Consignment / Sale or Return"
                subtitle="Track shop-held stock, partial settlements, returns and damage."
              />
              <ConsignmentPanel
                customers={customers.data || []}
                products={products.data || []}
                stocks={stocks.data || []}
                onInvoice={setInvoiceId}
              />
            </>
          )}
          {tab === "Payments" && (
            <>
              <Lead
                title="Payment collections"
                subtitle="Record cash and bank collections against posted invoices."
              />
              <div className="panel">
                <InvoiceTable
                  rows={(invoices.data || []).filter(
                    (i) =>
                      i.status === "posted" && i.total_cents > i.paid_cents,
                  )}
                />
              </div>
              <FormPanel title="Record a payment">
                <PaymentForm invoices={invoices.data || []} submit={submit} />
              </FormPanel>
            </>
          )}
          {tab === "Credit Alerts" && (
            <>
              <Lead
                title="ණය මතක් කිරීම් (Credit Alerts & Reminders)"
                subtitle="ස්වයංක්‍රීය ණය මතක් කිරීම්, ප්‍රමාද වූ බිල්පත් සහ WhatsApp සන්නිවේදනය."
              />
              <CreditAlertsDashboardPanel
                onViewInvoice={setInvoiceId}
                onViewCustomer={setCustomerAccountId}
                isAdmin={!!user.admin}
              />
            </>
          )}
          {tab === "Expenses" && (
            <>
              <Lead
                title="Expenses & Cashbook"
                subtitle="Record operational expenditures and monitor company cashflow."
              />
              <ExpensesPanel isAdmin={!!user.admin} />
            </>
          )}
          {tab === "Returns" && (
            <>
              <Lead
                title="Sales Returns & Credit Notes"
                subtitle="Issue credit notes for returned stock and adjust balances."
              />
              <CreditNotesPanel invoices={invoices.data || []} products={products.data || []} />
            </>
          )}
          {tab === "Reports" && user.admin && <ReportsPanel />}
          {tab === "Team" && user.admin && (
            <>
              <Lead
                title="Team & access"
                subtitle="Admin controls account access and staff activation."
              />
              <div className="panel">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                                                <th>Name (නම)</th>
                        <th>Username (පරිශීලක නාමය)</th>
                        <th>Role</th>
                        <th>4-Digit PIN</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(staff.data || []).map((s: any) => (
                        <tr key={s.id}>
                          <td><strong>{s.name}</strong></td>
                          <td>
                            <code style={{ background: "var(--brand-background, #F3FAF6)", padding: "3px 8px", borderRadius: 6, fontWeight: 700, color: "var(--brand-primary, #0C5051)" }}>
                              {s.username || s.name.toLowerCase().replace(/\s+/g, '')}
                            </code>
                          </td>
                          <td>
                            <span className="badge" style={{ textTransform: "capitalize" }}>
                              {s.role_id?.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            {s.has_passcode ? (
                              <span style={{ color: "var(--brand-primary, #0C5051)", fontWeight: 700 }}>✓ Configured</span>
                            ) : (
                              <span style={{ color: "var(--brand-text-muted, #647773)" }}>— Not set</span>
                            )}
                          </td>
                          <td>
                            <span className="badge">
                              {s.active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="secondary"
                                style={{ padding: "4px 10px", fontSize: 12 }}
                                onClick={() => {
                                  setEditingUser(s);
                                  setEditUsername(s.username || "");
                                  setEditPassword("");
                                  setEditPasscode("");
                                  setEditMsg("");
                                }}
                              >
                                Edit Credentials
                              </button>
                              {s.id !== user.id && (
                                <button
                                  className="secondary"
                                  style={{ padding: "4px 10px", fontSize: 12 }}
                                  onClick={() =>
                                    submit(
                                      `/users/${s.id}`,
                                      { active: !s.active },
                                      "PATCH",
                                    )
                                  }
                                >
                                  {s.active ? "Deactivate" : "Activate"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <FormPanel title="Create team account">
                <StaffForm submit={submit} />
              </FormPanel>
            </>
          )}
          {tab === "Settings" && user.admin && (
            <>
              <Lead
                title="Business settings"
                subtitle="These details are stored centrally for future invoices and documents."
              />
              <FormPanel title="Business profile">
                <SettingsForm data={settings.data} submit={submit} />
                <FreeIssueSettings />
              </FormPanel>
              <FormPanel title="Invoice print settings">
                <BillingSettings />
              </FormPanel>
              <CreditAlertSettingsPanel />
              <div style={{ marginTop: 20 }}>
                <BiometricSettings />
              <PrinterSettingsPanel admin={!!user.admin} businessName={settings.data?.name || ""} />
                <ChangePasswordPanel />
              </div>
            </>
          )}
          {tab === "Help" && <UserGuide user={user} />}
          {tab === "Profile" && (
            <>
              <Lead
                title="My profile"
                subtitle="Your account details and password. · ඔබේ ගිණුම් තොරතුරු."
              />
              <div className="panel profile-card">
                <span className="avatar" aria-hidden="true">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>{user.name}</h3>
                  <span className="badge">{roleLabel}</span>
                </div>
                <button className="secondary" onClick={signOut}>
                  <LogOut size={17} /> Sign out
                </button>
              </div>
              <div style={{ marginTop: 20 }}>
                <BiometricSettings />
              <PrinterSettingsPanel admin={!!user.admin} businessName={settings.data?.name || ""} />
                <ChangePasswordPanel />
              </div>
            </>
          )}
        </motion.div>
      </main>
      <nav className="bottom-nav" aria-label="Quick navigation">
        {[...bottomItems, { name: "__more", label: "More", icon: MoreHorizontal, fab: false }].map(
          ({ name, label, icon: Icon, fab }) => {
            const isMore = name === "__more";
            const active = isMore ? !inBottom : tab === name;
            return (
              <button
                key={name}
                className={`bn-item ${fab ? "bn-fab-item" : ""} ${active ? "active" : ""}`}
                aria-current={active && !isMore ? "page" : undefined}
                aria-label={
                  fab
                    ? "Quick billing (POS) · ඉක්මන් බිල්පත"
                    : isMore
                      ? "More menu · තවත්"
                      : `${name} · ${siLabel(name)}`
                }
                {...(isMore ? { "aria-controls": "app-drawer", "aria-expanded": open } : {})}
                onClick={fab ? openBilling : isMore ? () => setOpen(true) : () => changeTab(name)}
              >
                {fab ? (
                  <span className="bn-fab" aria-hidden="true">
                    <Plus size={26} strokeWidth={2.4} />
                  </span>
                ) : (
                  <span className="bn-icon" aria-hidden="true">
                    {active && (
                      <motion.span
                        layoutId={reduced ? undefined : "bn-active"}
                        className="bn-pill"
                        transition={{ type: "spring", stiffness: 480, damping: 34 }}
                      />
                    )}
                    <Icon size={20} />
                  </span>
                )}
                <span className="bn-label">{label}</span>
              </button>
            );
          },
        )}
      </nav>
    </div>
  );
}
function greetingFor(date: Date) {
  const h = date.getHours();
  if (h < 12) return { en: "Good morning", si: "සුභ උදෑසනක්" };
  if (h < 17) return { en: "Good afternoon", si: "සුභ දහවලක්" };
  return { en: "Good evening", si: "සුභ සන්ධ්‍යාවක්" };
}
function Overview({
  user,
  summary,
  loading,
  invoices,
  reduced,
  go,
  openBilling,
  onSelectInvoice,
}: {
  user: User;
  summary?: Summary;
  loading: boolean;
  invoices: Invoice[];
  reduced: boolean;
  go: (tab: string) => void;
  openBilling: () => void;
  onSelectInvoice: (id: string) => void;
}) {
  const admin = !!user.admin;
  const [range, setRange] = useState<"7d" | "recent">("7d");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const greet = greetingFor(now || new Date(0));
  const s = summary;
  const daily = useMemo(() => {
    const days: { key: string; name: string; amount: number }[] = [];
    const base = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({
        key,
        name: d.toLocaleDateString("en-LK", { weekday: "short" }),
        amount: 0,
      });
    }
    for (const inv of invoices) {
      if (inv.status === "cancelled") continue;
      const created = new Date(inv.created_at);
      if (Number.isNaN(created.getTime())) continue;
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
      const day = days.find((d) => d.key === key);
      if (day) day.amount += inv.total_cents / 100;
    }
    return days;
  }, [invoices]);
  const recentSeries = useMemo(
    () =>
      [...invoices]
        .reverse()
        .slice(-12)
        .map((x, i) => ({ name: `#${i + 1}`, amount: x.total_cents / 100 })),
    [invoices],
  );
  const weekTotal = daily.reduce((t, d) => t + d.amount, 0);
  const maxDay = Math.max(...daily.map((d) => d.amount));
  const actions = admin
    ? [
        { label: "New bill", si: "බිල්පත", icon: ReceiptText, onClick: openBilling },
        { label: "Collect", si: "ගෙවීම්", icon: Wallet, onClick: () => go("Payments") },
        { label: "Stock", si: "තොග", icon: Warehouse, onClick: () => go("Inventory") },
        { label: "Reports", si: "වාර්තා", icon: BarChart3, onClick: () => go("Reports") },
      ]
    : [
        { label: "New bill", si: "බිල්පත", icon: ReceiptText, onClick: openBilling },
        { label: "Collect", si: "ගෙවීම්", icon: Wallet, onClick: () => go("Payments") },
        { label: "Add shop", si: "කඩයක්", icon: Building2, onClick: () => go("Customers") },
        { label: "Alerts", si: "ණය", icon: Bell, onClick: () => go("Credit Alerts") },
      ];
  const minis = admin
    ? [
        { title: "Total invoiced", value: money(s?.totalSalesCents || 0), icon: BarChart3 },
        { title: "Overdue credit", value: money(s?.overdueCents || 0), icon: Bell, tone: "danger" },
        { title: "Active shops", value: s?.activeShops || 0, icon: ShoppingBag },
        { title: "Active reps", value: s?.activeReps || 0, icon: Users },
        { title: "Low stock", value: s?.lowStock || 0, icon: Box, tone: "alert", wide: true },
      ]
    : [
        { title: "Total invoiced", value: money(s?.totalSalesCents || 0), icon: BarChart3 },
        { title: "Overdue credit", value: money(s?.overdueCents || 0), icon: Bell, tone: "danger" },
        { title: "My customers", value: s?.activeShops || 0, icon: ShoppingBag },
        { title: "Low stock", value: s?.lowStock || 0, icon: Box, tone: "alert" },
      ];
  const hero = admin
    ? {
        label: "This month’s revenue",
        si: "මෙම මාසයේ ආදායම",
        value: money(s?.monthlySalesCents || 0),
        a: { label: "Today’s sales", value: money(s?.todaySalesCents || 0) },
        b: { label: "Outstanding", value: money(s?.outstandingCents || 0) },
      }
    : {
        label: "Today’s sales",
        si: "අද විකුණුම්",
        value: money(s?.todaySalesCents || 0),
        a: { label: "This month", value: money(s?.monthlySalesCents || 0) },
        b: { label: "To collect", value: money(s?.outstandingCents || 0) },
      };
  const rise = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: i * 0.05, duration: 0.32, ease: [0.22, 0.8, 0.24, 1] as const },
        };
  return (
    <>
      <div className="greeting">
        <div>
          <p>
            {greet.en} · <span className="si" lang="si">{greet.si}</span>
          </p>
          <h2>{user.name.split(" ")[0]} 👋</h2>
        </div>
        <span className="role-chip">
          <i aria-hidden="true" />
          {admin ? "Admin dashboard" : "Sales Rep dashboard"}
        </span>
      </div>
      {loading ? (
        <div className="loader" />
      ) : (
        <>
          <div className="overview-top">
            <motion.section className="hero-card" aria-label={hero.label} {...rise(0)}>
              <div className="hero-label">
                <span>
                  {hero.label}
                  <span className="si" lang="si">{hero.si}</span>
                </span>
                <span className="hero-badge" aria-hidden="true">
                  <TrendingUp size={20} />
                </span>
              </div>
              <div className="hero-value">{hero.value}</div>
              {(s?.overdueCents || 0) > 0 ? (
                <button
                  className="hero-trend"
                  style={{ border: 0, cursor: "pointer" }}
                  onClick={() => go("Credit Alerts")}
                >
                  <Bell size={13} /> {money(s?.overdueCents || 0)} overdue · view
                </button>
              ) : (
                <span className="hero-trend">
                  <Activity size={13} /> Live records
                </span>
              )}
              <div className="hero-split">
                <div>
                  <small>{hero.a.label}</small>
                  <b>{hero.a.value}</b>
                </div>
                <div>
                  <small>{hero.b.label}</small>
                  <b>{hero.b.value}</b>
                </div>
              </div>
            </motion.section>
            <motion.div className="quick-panel" {...rise(1)}>
              <div className="panel" style={{ padding: 12 }}>
                <div className="quick-actions">
                  {actions.map((a) => (
                    <button key={a.label} className="quick-action" onClick={a.onClick}>
                      <span className="qa-icon">
                        <a.icon size={22} />
                      </span>
                      <span>
                        {a.label}
                        <small className="si" lang="si">{a.si}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mini-stats">
                {minis.map((m) => (
                  <div
                    key={m.title}
                    className={`mini-stat ${m.tone || ""}`}
                    style={"wide" in m && m.wide ? { gridColumn: "1 / -1" } : undefined}
                  >
                    <span className="stat-icon">
                      <m.icon size={18} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <small>{m.title}</small>
                      <b>{m.value}</b>
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
          <div className="workspace-grid">
            <motion.div className="panel" {...rise(2)}>
              <div className="panel-head" style={{ marginBottom: 6 }}>
                <h3>
                  Recent transactions
                  <small className="si muted" lang="si" style={{ display: "block", fontSize: 12, fontWeight: 500 }}>
                    මෑත බිල්පත්
                  </small>
                </h3>
                <button className="see-all" onClick={() => go("Invoices")}>
                  See all <ChevronRight size={15} />
                </button>
              </div>
              <TransactionList rows={invoices.slice(0, 6)} onSelect={onSelectInvoice} />
            </motion.div>
            <motion.div className="panel" {...rise(3)}>
              <div className="panel-head" style={{ marginBottom: 4 }}>
                <h3>Sales activity</h3>
                <div className="segmented" role="tablist" aria-label="Chart range">
                  {(
                    [
                      ["7d", "7 days"],
                      ["recent", "Latest 12"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={range === k}
                      className={range === k ? "on" : ""}
                      onClick={() => setRange(k)}
                    >
                      {range === k && (
                        <motion.span
                          layoutId={reduced ? undefined : "seg"}
                          className="seg-bg"
                        />
                      )}
                      <span>{l}</span>
                    </button>
                  ))}
                </div>
              </div>
              {invoices.length ? (
                range === "7d" ? (
                  <>
                    <div className="chart-total">
                      <small>Invoiced in the last 7 days</small>
                      {money(Math.round(weekTotal * 100))}
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <BarChart data={daily} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--brand-border)" />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--brand-text-muted)", fontSize: 12 }} />
                        <Tooltip
                          cursor={{ fill: "var(--surface-raised)" }}
                          formatter={(v) => money(Number(v) * 100)}
                          contentStyle={{ borderRadius: 12, border: "1px solid var(--brand-border)" }}
                        />
                        <Bar dataKey="amount" radius={[8, 8, 8, 8]} maxBarSize={34} isAnimationActive={!reduced}>
                          {daily.map((d) => (
                            <Cell
                              key={d.key}
                              fill={d.amount > 0 && d.amount === maxDay ? "#0C5051" : "#287E65"}
                              fillOpacity={d.amount > 0 && d.amount === maxDay ? 1 : 0.55}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <ResponsiveContainer width="100%" height={262}>
                    <AreaChart data={recentSeries} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#92FD6F" stopOpacity={0.55} />
                          <stop offset="95%" stopColor="#92FD6F" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--brand-border)" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--brand-text-muted)", fontSize: 12 }} />
                      <Tooltip
                        formatter={(v) => money(Number(v) * 100)}
                        contentStyle={{ borderRadius: 12, border: "1px solid var(--brand-border)" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="#0C5051"
                        strokeWidth={3}
                        fill="url(#sales-fill)"
                        isAnimationActive={!reduced}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )
              ) : (
                <div className="chart-empty">
                  Sales activity will appear after the first invoice.
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </>
  );
}
function TransactionList({
  rows,
  onSelect,
}: {
  rows: Invoice[];
  onSelect: (id: string) => void;
}) {
  if (!rows.length)
    return <Empty text="No invoices yet. Create your first invoice to get started." />;
  return (
    <ul className="txn-list">
      {rows.map((i) => {
        const due = i.total_cents - i.paid_cents;
        const state =
          i.status === "cancelled" ? "cancelled" : due > 0 ? "due" : "paid";
        return (
          <li key={i.id}>
            <button className="txn-item" onClick={() => onSelect(i.id)}>
              <span className={`txn-avatar ${state}`} aria-hidden="true">
                {(i.shop_name || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="txn-body">
                <b>{i.shop_name}</b>
                <small>
                  {i.number} · {String(i.created_at).slice(0, 10)}
                </small>
              </span>
              <span className="txn-amount">
                <b>{money(i.total_cents)}</b>
                <small className={state}>
                  {state === "cancelled"
                    ? "Cancelled"
                    : state === "due"
                      ? `${money(due)} due`
                      : "Paid"}
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Lead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-lead">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function FormPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel form-panel" style={{ marginTop: 20 }}>
      <div className="panel-head">
        <h3>{title}</h3>
        <Plus size={18} />
      </div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ClipboardList size={27} />
      <span>{text}</span>
    </div>
  );
}
function InvoiceTable({
  rows,
  onSelect,
}: {
  rows: Invoice[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Outstanding</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className={i.status === "cancelled" ? "voided" : undefined}>
              <td>
                {onSelect ? (
                  <button
                    className="link-button"
                    onClick={() => onSelect(i.id)}
                  >
                    {i.number}
                  </button>
                ) : (
                  <strong>{i.number}</strong>
                )}
              </td>
              <td>{i.shop_name}</td>
              <td>{money(i.total_cents)}</td>
              <td>{money(i.total_cents - i.paid_cents)}</td>
              <td>{i.due_at || "Paid"}</td>
              <td>
                <span className={`badge ${i.status === "cancelled" ? "danger" : i.due_at ? "due" : ""}`}>
                  {i.status === "cancelled" ? "deleted" : i.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <Empty text="No invoices yet. Create your first invoice to get started." />
      )}
    </div>
  );
}
function ProductTable({ rows, admin }: { rows: Product[]; admin?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Wholesale</th>
            <th>Retail</th>
            <th>Shop selling</th>
            <th>Main stock</th>
            {admin && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.variant_id}>
              <td>
                <strong>{x.name}</strong>
              </td>
              <td>{x.label}</td>
              <td>{x.sku}</td>
              <td>{money(x.wholesale_cents)}</td>
              <td>{money(x.retail_cents)}</td>
              <td>{x.shop_price_cents ? money(x.shop_price_cents) : "—"}</td>
              <td>{x.main_stock}</td>
              {admin && (
                <td>
                  {rows.findIndex((r) => r.id === x.id) === rows.indexOf(x) ? (
                    <ProductAdminActions productId={x.id} name={x.name} />
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>↑ same product</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <Empty text="No products yet. Add your first product below." />
      )}
    </div>
  );
}
function val(e: React.FormEvent<HTMLFormElement>) {
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
    string,
    string
  >;
}
function ProductForm({ submit }: { submit: (p: string, v: unknown) => void }) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = val(e);
    submit("/products", {
      name: d.name,
      sku: d.sku,
      variants: [
        {
          label: d.label,
          unit: d.unit,
          grams: d.grams ? Number(d.grams) : undefined,
          wholesaleCents: Math.round(Number(d.wholesale) * 100),
          retailCents: Math.round(Number(d.retail) * 100),
          shopPriceCents: Math.round(Number(d.shopPrice || 0) * 100),
          costCents: Math.round(Number(d.cost) * 100),
          lowStock: Number(d.lowStock),
        },
      ],
    });
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Product name
          <input name="name" required placeholder="Ceylon Tea" />
        </label>
        <label>
          SKU
          <input name="sku" required placeholder="TEA-050" />
        </label>
        <label>
          Variant label
          <input name="label" required placeholder="50 g pack" />
        </label>
        <label>
          Unit
          <input name="unit" required defaultValue="pack" />
        </label>
        <label>
          Weight in grams
          <input name="grams" type="number" min="1" placeholder="50" />
        </label>
        <label>
          Low stock alert
          <input
            name="lowStock"
            type="number"
            min="0"
            defaultValue="10"
            required
          />
        </label>
        <label>
          Wholesale price (LKR)
          <input name="wholesale" type="number" min="0" step="0.01" required />
        </label>
        <label>
          Retail price (LKR)
          <input name="retail" type="number" min="0" step="0.01" required />
        </label>
        <label>
          Shop selling price (LKR)
          <input name="shopPrice" type="number" min="0" step="0.01" />
        </label>
        <label>
          Unit cost (LKR)
          <input name="cost" type="number" min="0" step="0.01" required />
        </label>
      </div>
      <div className="form-actions">
        <button className="primary">Add product</button>
      </div>
    </form>
  );
}
function CustomerForm({
  submit,
  admin,
  staff,
}: {
  submit: (p: string, v: unknown) => void;
  admin: boolean;
  staff: Array<{ id: string; name: string; role_id: string }>;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = val(e);
    submit("/customers", {
      shopName: d.shopName,
      ownerName: d.ownerName,
      phone: d.phone,
      whatsapp: d.whatsapp,
      address: d.address,
      location: d.location,
      type: d.type,
      creditLimitCents: admin
        ? Math.round(Number(d.creditLimit || 0) * 100)
        : 0,
      creditDays: admin ? Number(d.creditDays || 0) : 0,
      repId: d.repId || undefined,
    });
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Shop name
          <input name="shopName" required />
        </label>
        <label>
          Owner name
          <input name="ownerName" required />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" />
        </label>
        <label>
          WhatsApp
          <input name="whatsapp" type="tel" />
        </label>
        <label>
          Address
          <input name="address" />
        </label>
        <label>
          Location
          <input name="location" />
        </label>
        <label>
          Customer type
          <select name="type">
            <option value="wholesale">Wholesale</option>
            <option value="retail">Retail</option>
          </select>
        </label>
        {admin && (
          <>
            <label>
              Credit limit (LKR)
              <input
                name="creditLimit"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </label>
            <label>
              Credit period (days, max 45)
              <input
                name="creditDays"
                type="number"
                min="0"
                max="45"
                defaultValue="0"
              />
            </label>
            <label>
              Assign sales rep
              <select name="repId">
                <option value="">Unassigned</option>
                {staff
                  .filter((x) => x.role_id === "sales_rep")
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="form-actions">
        <button className="primary">Register shop</button>
      </div>
    </form>
  );
}
function StockForm({
  products,
  submit,
}: {
  products: Product[];
  submit: (p: string, v: unknown) => void;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = val(e);
    submit("/stock/adjust", {
      warehouseId: "main",
      variantId: d.variantId,
      delta: Number(d.delta),
      reason: d.reason,
    });
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Product variant
          <select name="variantId" required>
            {products.map((p) => (
              <option key={p.variant_id} value={p.variant_id}>
                {p.name} · {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity change (+ or -)
          <input name="delta" type="number" required placeholder="100" />
        </label>
        <label>
          Reason
          <input name="reason" required placeholder="Stock received" />
        </label>
      </div>
      <div className="form-actions">
        <button className="primary" disabled={!products.length}>
          Record movement
        </button>
      </div>
    </form>
  );
}
function InvoiceForm({
  customers,
  products,
  stocks,
  submit,
}: {
  customers: Customer[];
  products: Product[];
  stocks: Stock[];
  submit: (p: string, v: unknown) => void;
}) {
  const [lines, setLines] = useState([{ variantId: "", quantity: 1 }]);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = val(e);
    submit("/invoices", {
      customerId: d.customerId,
      warehouseId: d.warehouseId,
      idempotencyKey: idempotency(),
      items: lines
        .filter((x) => x.variantId)
        .map((x) => ({ variantId: x.variantId, quantity: Number(x.quantity) })),
      initialPaymentCents: Math.round(Number(d.initialPayment || 0) * 100),
      paymentMethod: d.paymentMethod,
    });
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Customer
          <select name="customerId" required>
            <option value="">Select a shop</option>
            {customers.map((c) => (
              <option value={c.id} key={c.id}>
                {c.shop_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stock location
          <select name="warehouseId" required>
            {[...new Set(stocks.map((s) => s.warehouse_id))].map((id) => (
              <option key={id} value={id}>
                {stocks.find((s) => s.warehouse_id === id)?.warehouse || id}
              </option>
            ))}
            {stocks.length === 0 && (
              <option value="main">Main warehouse</option>
            )}
          </select>
        </label>
      </div>
      <div style={{ margin: "20px 0 10px", fontWeight: 700 }}>Line items</div>
      {lines.map((line, i) => (
        <div className="form-grid" key={i} style={{ marginBottom: 12 }}>
          <label>
            Product
            <select
              value={line.variantId}
              onChange={(e) =>
                setLines(
                  lines.map((l, j) =>
                    j === i ? { ...l, variantId: e.target.value } : l,
                  ),
                )
              }
              required
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
            Quantity
            <input
              type="number"
              min="1"
              value={line.quantity}
              onChange={(e) =>
                setLines(
                  lines.map((l, j) =>
                    j === i ? { ...l, quantity: Number(e.target.value) } : l,
                  ),
                )
              }
              required
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => setLines([...lines, { variantId: "", quantity: 1 }])}
      >
        <Plus size={16} /> Add line
      </button>
      <div className="form-grid" style={{ marginTop: 20 }}>
        <label>
          Initial payment (LKR)
          <input
            name="initialPayment"
            type="number"
            min="0"
            step="0.01"
            defaultValue="0"
          />
        </label>
        <label>
          Payment method
          <select name="paymentMethod">
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button
          className="primary"
          disabled={!customers.length || !products.length}
        >
          Post invoice
        </button>
      </div>
    </form>
  );
}
function PaymentForm({
  invoices,
  submit,
}: {
  invoices: Invoice[];
  submit: (p: string, v: unknown) => void;
}) {
  const outstanding = invoices.filter(
    (i) => i.status === "posted" && i.total_cents > i.paid_cents,
  );
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = val(e);
    submit("/payments", {
      invoiceId: d.invoiceId,
      amountCents: Math.round(Number(d.amount) * 100),
      method: d.method,
      idempotencyKey: idempotency(),
    });
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Invoice
          <select name="invoiceId" required>
            {outstanding.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {money(i.total_cents - i.paid_cents)} due
              </option>
            ))}
          </select>
        </label>
        <label>
          Collected amount (LKR)
          <input name="amount" type="number" step="0.01" min="0.01" required />
        </label>
        <label>
          Method
          <select name="method">
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary" disabled={!outstanding.length}>
          Record payment
        </button>
      </div>
    </form>
  );
}
function StaffForm({ submit }: { submit: (p: string, v: unknown) => void }) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = val(e);
    submit("/users", {
      name: d.name,
      username: d.username,
      email: d.email || undefined,
      password: d.password,
      passcode: d.passcode || undefined,
      roleId: d.roleId,
    });
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Full name (සම්පූර්ණ නම)
          <input name="name" required placeholder="e.g. Kamal Perera" />
        </label>
        <label>
          Username (පරිශීලක නාමය)
          <input name="username" required placeholder="e.g. kamal_rep" minLength={2} />
        </label>
        <label>
          Password (මුරපදය)
          <input name="password" type="password" minLength={6} required placeholder="Password (min 6 chars)" />
        </label>
        <label>
          4-Digit Quick PIN (අංක 4 කේතය - Optional)
          <input name="passcode" type="password" inputMode="numeric" maxLength={4} placeholder="e.g. 1234" />
        </label>
        <label>
          Email (ඊමේල් - Optional)
          <input type="email" name="email" placeholder="Optional (defaults to username@nugathalawa.erp)" />
        </label>
        <label>
          Role (භූමිකාව)
          <select name="roleId">
            <option value="sales_rep">Sales Representative</option>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary">Create account (ගිණුම සාදන්න)</button>
      </div>
    </form>
  );
}
function SettingsForm({
  data,
  submit,
}: {
  data?: {
    name: string;
    address: string;
    email: string;
    phone: string;
    whatsapp: string;
  };
  submit: (p: string, v: unknown, m?: string) => void;
}) {
  if (!data) return <div className="loader" />;
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit("/settings", val(e), "PATCH");
  }
  return (
    <form onSubmit={onSubmit} key={data.name}>
      <div className="form-grid">
        {(["name", "address", "email", "phone", "whatsapp"] as const).map(
          (k) => (
            <label key={k}>
              {k[0].toUpperCase() + k.slice(1)}
              <input name={k} defaultValue={data[k]} />
            </label>
          ),
        )}
      </div>
      <div className="form-actions">
        <button className="primary">Save settings</button>
      </div>
    </form>
  );
}
