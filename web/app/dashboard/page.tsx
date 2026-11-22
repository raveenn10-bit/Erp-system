"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  AreaChart,
  Area,
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
} from "lucide-react";
import { api, idempotency, money } from "@/lib/api";
import { InvoiceActions } from "@/components/invoice-actions";
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
};
const menu = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Products", icon: Box },
  { name: "Inventory", icon: Warehouse },
  { name: "Customers", icon: Building2 },
  { name: "Invoices", icon: FileText },
  { name: "Free Issues", icon: Gift },
  { name: "Consignments", icon: PackageCheck },
  { name: "Payments", icon: CreditCard },
  { name: "Credit Alerts", icon: Bell },
  { name: "Expenses", icon: ArrowDownLeft },
  { name: "Returns", icon: RotateCcw },
  { name: "Reports", icon: BarChart3 },
  { name: "Team", icon: Users },
  { name: "Settings", icon: Settings },
];
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20000 } },
});
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
    [customerAccountId, setCustomerAccountId] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User }>("/me"),
    retry: false,
  });
  useEffect(() => {
    if (me.isError) router.replace("/login");
  }, [me.isError, router]);
  const user = me.data?.user;
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
  }
  if (me.isLoading)
    return (
      <div className="main-content" style={{ paddingTop: 50 }}>
        <div className="loader" />
      </div>
    );
  if (!user) return null;
  const visibleMenu = menu.filter(
    (i) => user.admin || !["Team", "Settings", "Reports", "Expenses"].includes(i.name),
  );
  return (
    <div className="app-shell">
      <div
        className={`mobile-overlay ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
      />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span
            className="brand-mark"
            style={{
              padding: 0,
              overflow: "hidden",
              width: 36,
              height: 36,
              borderRadius: "50%",
              minWidth: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="/nugathalawa-logo.jpg"
              alt="Logo"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </span>
          <div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 750,
                letterSpacing: "0.04em",
                color: "var(--brand-primary,#0e927d)",
                textTransform: "uppercase",
                display: "block",
                lineHeight: 1.2,
              }}
            >
              {settings.data?.name ? "NUGATHALAWA TEA" : "NUGATHALAWA TEA"}
            </span>
            <span
              style={{
                fontSize: 10,
                opacity: 0.8,
                display: "block",
                letterSpacing: "0.06em",
              }}
            >
              DISTRIBUTION ERP
            </span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Primary navigation">
          {visibleMenu.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${tab === name ? "active" : ""}`}
              onClick={() => changeTab(name)}
            >
              <Icon size={19} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={async () => {
              await api("/logout", { method: "POST" });
              router.replace("/login");
            }}
          >
            <LogOut size={19} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="secondary mobile-menu"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div>
              <span className="eyebrow">
                {settings.data?.name || "NUGATHALAWA CEYLON TEA EXPORT"} ·
                DISTRIBUTION ERP
              </span>
              <h1>{tab}</h1>
            </div>
          </div>
          <div className="topbar-right">
            <span className="muted" style={{ fontSize: 14 }}>
              {user.name} · {user.admin ? "Admin" : "Sales Representative"}
            </span>
            <span className="avatar" aria-label={user.name}>
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        <motion.div
          key={tab}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
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
            <InvoiceActions id={invoiceId} close={() => setInvoiceId(null)} />
          )}{" "}
          {tab === "Overview" && (
            <>
              <div className="section-lead">
                <div>
                  <h2>Business at a glance</h2>
                  <p>Live figures from your distribution operations.</p>
                </div>
                <span className="badge">
                  <Activity size={13} /> Live records
                </span>
              </div>
              {summary.isLoading ? (
                <div className="loader" />
              ) : (
                <>
                  <div className="stats-grid">
                    {[
                      {
                        title: "Total invoiced",
                        value: money(summary.data?.totalSalesCents || 0),
                        icon: BarChart3,
                      },
                      {
                        title: "Today’s sales",
                        value: money(summary.data?.todaySalesCents || 0),
                        icon: ArrowUpRight,
                      },
                      {
                        title: "Outstanding",
                        value: money(summary.data?.outstandingCents || 0),
                        icon: CreditCard,
                      },
                      {
                        title: "Overdue credit",
                        value: money(summary.data?.overdueCents || 0),
                        icon: Bell,
                        alert: true,
                      },
                      {
                        title: "Monthly revenue",
                        value: money(summary.data?.monthlySalesCents || 0),
                        icon: Activity,
                      },
                      {
                        title: "Active shops",
                        value: summary.data?.activeShops || 0,
                        icon: ShoppingBag,
                      },
                      {
                        title: user.admin ? "Active reps" : "My customers",
                        value: user.admin
                          ? summary.data?.activeReps || 0
                          : summary.data?.activeShops || 0,
                        icon: Users,
                      },
                      {
                        title: "Low stock",
                        value: summary.data?.lowStock || 0,
                        icon: Box,
                        alert: true,
                      },
                    ].map((s, i) => (
                      <motion.div
                        key={s.title}
                        className={`stat-card ${s.alert ? "alert" : ""}`}
                        initial={reduced ? false : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.035 }}
                      >
                        <div className="stat-top">
                          <small>{s.title}</small>
                          <span className="stat-icon">
                            <s.icon size={19} />
                          </span>
                        </div>
                        <strong>{s.value}</strong>
                      </motion.div>
                    ))}
                  </div>
                  <div className="workspace-grid">
                    <div className="panel">
                      <div className="panel-head">
                        <h3>Recent invoices</h3>
                        <button
                          className="secondary"
                          onClick={() => changeTab("Invoices")}
                        >
                          View all
                        </button>
                      </div>
                      <InvoiceTable
                        rows={invoices.data?.slice(0, 5) || []}
                        onSelect={setInvoiceId}
                      />
                    </div>
                    <div className="panel">
                      <div className="panel-head">
                        <h3>Sales activity</h3>
                        <span className="muted">Latest transactions</span>
                      </div>
                      {(invoices.data || []).length ? (
                        <ResponsiveContainer width="100%" height={240}>
                          <AreaChart
                            data={[...(invoices.data || [])]
                              .reverse()
                              .slice(-12)
                              .map((x, i) => ({
                                name: `#${i + 1}`,
                                amount: x.total_cents / 100,
                              }))}
                          >
                            <defs>
                              <linearGradient
                                id="sales-fill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="5%"
                                  stopColor="#10a58d"
                                  stopOpacity={0.25}
                                />
                                <stop
                                  offset="95%"
                                  stopColor="#10a58d"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="#e9efef" />
                            <XAxis
                              dataKey="name"
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              formatter={(v) => money(Number(v) * 100)}
                            />
                            <Area
                              type="monotone"
                              dataKey="amount"
                              stroke="#0e927d"
                              strokeWidth={3}
                              fill="url(#sales-fill)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="chart-empty">
                          Sales activity will appear after the first invoice.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {tab === "Products" && (
            <>
              <Lead
                title="Products & variants"
                subtitle="Manage your catalogue and prices from one place."
              />
              <div className="panel">
                <ProductTable rows={products.data || []} />
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
                        <th>Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stocks.data || []).map((s, i) => (
                        <tr key={i}>
                          <td>{s.name}</td>
                          <td>{s.label}</td>
                          <td>{s.warehouse}</td>
                          <td>{s.quantity}</td>
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
          {tab === "Invoices" && (
            <>
              <Lead
                title="Invoices & billing"
                subtitle="Draft, preview, finalize, print and share professional invoices."
              />
              <div className="panel">
                <InvoiceTable
                  rows={invoices.data || []}
                  onSelect={setInvoiceId}
                />
              </div>
              <div style={{ marginTop: 20 }}>
                <BillingPanel
                  customers={customers.data || []}
                  products={products.data || []}
                  stocks={stocks.data || []}
                  onPosted={setInvoiceId}
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
          {tab === "Reports" && user.admin && <Reports />}
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
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(staff.data || []).map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td>{s.email}</td>
                          <td>{s.role_id}</td>
                          <td>
                            <span className="badge">
                              {s.active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td>
                            {s.id !== user.id && (
                              <button
                                className="secondary"
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
              </FormPanel>
              <FormPanel title="Invoice print settings">
                <BillingSettings />
              </FormPanel>
              <CreditAlertSettingsPanel />
              <div style={{ marginTop: 20 }}>
                <ChangePasswordPanel />
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
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
        <Plus size={18} color="#138b78" />
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
            <tr key={i.id}>
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
                <span className={`badge ${i.due_at ? "due" : ""}`}>
                  {i.status}
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
function ProductTable({ rows }: { rows: Product[] }) {
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
      email: d.email,
      password: d.password,
      roleId: d.roleId,
    });
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Full name
          <input name="name" required />
        </label>
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Temporary password (8+ characters)
          <input name="password" type="password" minLength={8} required />
        </label>
        <label>
          Role
          <select name="roleId">
            <option value="sales_rep">Sales Representative</option>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary">Create account</button>
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

function Reports() {
  const [kind, setKind] = useState("daily-sales"),
    [from, setFrom] = useState(
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const report = useQuery({
    queryKey: ["report", kind, from, to],
    queryFn: () =>
      api<Record<string, string | number>[]>(
        `/reports/${kind}?from=${from}&to=${to}`,
      ),
  });
  function csv() {
    const rows = report.data || [];
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const escape = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const content = [
      keys.map(escape).join(","),
      ...rows.map((row) => keys.map((k) => escape(row[k])).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <Lead
        title="Business reports"
        subtitle="Live operational data, filtered by date and ready to export."
      />
      <div className="panel">
        <div className="form-grid">
          <label>
            Report
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {[
                ["daily-sales", "Daily sales"],
                ["product-sales", "Product sales & profit"],
                ["outstanding", "Customer outstanding"],
                ["collections", "Payment collections"],
                ["stock-movements", "Stock movements"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="secondary"
            disabled={!report.data?.length}
            onClick={csv}
          >
            <Download size={17} />
            Export CSV
          </button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 20 }}>
        {report.isLoading ? (
          <div className="loader" />
        ) : report.isError ? (
          <div className="error">Could not load this report.</div>
        ) : report.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {Object.keys(report.data[0]).map((k) => (
                    <th key={k}>{k.replaceAll("_", " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.data.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((v, j) => (
                      <td key={j}>{v ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No records in this date range." />
        )}
      </div>
    </>
  );
}
