import { Hono } from "hono";
import { current, guard, type Env } from "./security";

export const reportsRouter = new Hono<Env>();

// Helper to get Asia/Colombo local date YYYY-MM-DD
function getColomboDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Helper to get past date YYYY-MM-DD in Asia/Colombo
function getColomboPastDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return getColomboDate(d);
}

// ── 1. BI Overview & KPI Summary ──────────────────────────────────────────────
reportsRouter.get("/bi/overview", async (c) => {
  const denied = await guard(c, "reports.view");
  if (denied) return denied;

  const db = c.env.DB;
  const p = current(c);
  const from = c.req.query("from") || getColomboPastDate(30);
  const to = c.req.query("to") || getColomboDate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return c.json({ error: "Invalid date range" }, 400);
  }

  const today = getColomboDate();
  const yesterday = getColomboPastDate(1);
  const sevenDaysAgo = getColomboPastDate(7);
  const ninetyDaysAgo = getColomboPastDate(90);
  const startOfMonth = `${today.slice(0, 7)}-01`;

  const scope = " AND (?=1 OR i.rep_id=?)";
  const repArgs = [p.admin, p.id];

  // 1. KPI Queries
  const [
    todaySales,
    yesterdaySales,
    weekSales,
    monthSales,
    ninetyDaysSales,
    rangeSales,
    rangeCollections,
    rangeExpenses,
    rangeGrossProfit,
    overallOutstanding,
    overallOverdue,
    activeShops,
    activeReps,
    lowStock,
    pendingConsignments,
  ] = await Promise.all([
    // Today Sales
    db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices i WHERE status='posted' AND substr(created_at,1,10)=? ${scope}`)
      .bind(today, ...repArgs).first(),
    // Yesterday Sales
    db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices i WHERE status='posted' AND substr(created_at,1,10)=? ${scope}`)
      .bind(yesterday, ...repArgs).first(),
    // Week Sales (last 7 days)
    db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices i WHERE status='posted' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? ${scope}`)
      .bind(sevenDaysAgo, today, ...repArgs).first(),
    // Month Sales
    db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices i WHERE status='posted' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? ${scope}`)
      .bind(startOfMonth, today, ...repArgs).first(),
    // Last 90 days sales
    db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices i WHERE status='posted' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? ${scope}`)
      .bind(ninetyDaysAgo, today, ...repArgs).first(),
    // Range Invoiced
    db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS invoiced_cents, COALESCE(SUM(subtotal_cents),0) AS gross_cents, COALESCE(SUM(item_discount_cents + invoice_discount_cents),0) AS discount_cents, COUNT(*) AS count FROM invoices i WHERE status='posted' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? ${scope}`)
      .bind(from, to, ...repArgs).first(),
    // Range Collections
    db.prepare(`SELECT COALESCE(SUM(pay.amount_cents),0) AS collected_cents FROM payments pay JOIN invoices i ON i.id=pay.invoice_id WHERE substr(pay.created_at,1,10)>=? AND substr(pay.created_at,1,10)<=? ${scope}`)
      .bind(from, to, ...repArgs).first(),
    // Range Expenses
    db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS expense_cents FROM expenses WHERE date>=? AND date<=?`)
      .bind(from, to).first(),
    // Range Gross Profit
    db.prepare(`SELECT COALESCE(SUM((ii.unit_price_cents - ii.cost_cents) * ii.quantity),0) AS gross_profit_cents FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}`)
      .bind(from, to, ...repArgs).first(),
    // Total Outstanding
    db.prepare(`SELECT COALESCE(SUM(total_cents - paid_cents),0) AS cents FROM invoices i WHERE status='posted' ${scope}`)
      .bind(...repArgs).first(),
    // Overdue Credit
    db.prepare(`SELECT COALESCE(SUM(total_cents - paid_cents),0) AS cents FROM invoices i WHERE status='posted' AND total_cents > paid_cents AND due_at IS NOT NULL AND due_at < ? ${scope}`)
      .bind(today, ...repArgs).first(),
    // Active Shops
    db.prepare(p.admin ? "SELECT COUNT(*) AS count FROM customers WHERE active=1" : "SELECT COUNT(*) AS count FROM customer_assignments a JOIN customers c ON c.id=a.customer_id WHERE c.active=1 AND a.rep_id=?")
      .bind(...repArgs).first(),
    // Active Reps
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE role_id='sales_rep' AND active=1").first(),
    // Low Stock
    db.prepare("SELECT COUNT(DISTINCT v.id) AS count FROM product_variants v JOIN stock_balances b ON b.variant_id=v.id WHERE b.warehouse_id='main' AND b.quantity <= v.low_stock").first(),
    // Pending Consignments
    db.prepare(`SELECT COUNT(*) AS count FROM consignments c WHERE status IN ('active','draft') AND (?=1 OR c.rep_id=?)`)
      .bind(p.admin, p.id).first(),
  ]);

  // 2. Daily Trend in range
  const dailyTrend = await db.prepare(`
    SELECT substr(i.created_at,1,10) AS date,
      COUNT(*) AS invoices,
      COALESCE(SUM(i.total_cents),0) AS invoiced_cents,
      COALESCE(SUM(i.paid_cents),0) AS collected_cents
    FROM invoices i
    WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}
    GROUP BY date
    ORDER BY date ASC
    LIMIT 100
  `).bind(from, to, ...repArgs).all();

  // 3. Payment Methods
  const paymentMethods = await db.prepare(`
    SELECT i.payment_method, COALESCE(SUM(i.total_cents),0) AS total_cents, COUNT(*) AS count
    FROM invoices i
    WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}
    GROUP BY i.payment_method
  `).bind(from, to, ...repArgs).all();

  // 4. Top 10 Selling Products
  const topProducts = await db.prepare(`
    SELECT pr.name, v.label, v.unit,
      COALESCE(SUM(ii.quantity),0) AS units,
      COALESCE(SUM(ii.line_cents),0) AS revenue_cents,
      COALESCE(SUM((ii.unit_price_cents - ii.cost_cents) * ii.quantity),0) AS profit_cents
    FROM invoice_items ii
    JOIN invoices i ON i.id=ii.invoice_id
    JOIN product_variants v ON v.id=ii.variant_id
    JOIN products pr ON pr.id=v.product_id
    WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}
    GROUP BY v.id
    ORDER BY revenue_cents DESC
    LIMIT 10
  `).bind(from, to, ...repArgs).all();

  // 5. Top 10 Customers
  const topCustomers = await db.prepare(`
    SELECT c.id, c.shop_name, c.owner_name,
      COALESCE(SUM(i.total_cents),0) AS invoiced_cents,
      COALESCE(SUM(i.paid_cents),0) AS paid_cents,
      COALESCE(SUM(i.total_cents - i.paid_cents),0) AS balance_cents
    FROM invoices i
    JOIN customers c ON c.id=i.customer_id
    WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}
    GROUP BY c.id
    ORDER BY invoiced_cents DESC
    LIMIT 10
  `).bind(from, to, ...repArgs).all();

  // 6. Credit Aging Buckets
  const agingRows = await db.prepare(`
    SELECT
      i.total_cents - i.paid_cents AS balance,
      CAST((julianday(?) - julianday(COALESCE(i.due_at, substr(i.created_at,1,10)))) AS INTEGER) AS overdue_days
    FROM invoices i
    WHERE i.status='posted' AND i.total_cents > i.paid_cents ${scope}
  `).bind(today, ...repArgs).all();

  let agingCurrent = 0;
  let aging1_15 = 0;
  let aging16_30 = 0;
  let aging31_45 = 0;
  let agingOver45 = 0;

  for (const r of (agingRows.results as any[])) {
    const bal = r.balance || 0;
    const days = r.overdue_days || 0;
    if (days <= 0) agingCurrent += bal;
    else if (days <= 15) aging1_15 += bal;
    else if (days <= 30) aging16_30 += bal;
    else if (days <= 45) aging31_45 += bal;
    else agingOver45 += bal;
  }

  return c.json({
    kpis: {
      todaySalesCents: (todaySales as any)?.cents ?? 0,
      yesterdaySalesCents: (yesterdaySales as any)?.cents ?? 0,
      thisWeekSalesCents: (weekSales as any)?.cents ?? 0,
      thisMonthSalesCents: (monthSales as any)?.cents ?? 0,
      last90DaysSalesCents: (ninetyDaysSales as any)?.cents ?? 0,
      rangeInvoicedCents: (rangeSales as any)?.invoiced_cents ?? 0,
      rangeGrossCents: (rangeSales as any)?.gross_cents ?? 0,
      rangeDiscountCents: (rangeSales as any)?.discount_cents ?? 0,
      rangeInvoiceCount: (rangeSales as any)?.count ?? 0,
      rangeCollectionsCents: (rangeCollections as any)?.collected_cents ?? 0,
      rangeExpensesCents: (rangeExpenses as any)?.expense_cents ?? 0,
      rangeGrossProfitCents: (rangeGrossProfit as any)?.gross_profit_cents ?? 0,
      totalOutstandingCents: (overallOutstanding as any)?.cents ?? 0,
      overdueCents: (overallOverdue as any)?.cents ?? 0,
      activeShopsCount: (activeShops as any)?.count ?? 0,
      activeRepsCount: (activeReps as any)?.count ?? 0,
      lowStockCount: (lowStock as any)?.count ?? 0,
      pendingConsignmentsCount: (pendingConsignments as any)?.count ?? 0,
    },
    charts: {
      dailyTrend: dailyTrend.results || [],
      paymentMethods: paymentMethods.results || [],
      topProducts: topProducts.results || [],
      topCustomers: topCustomers.results || [],
      creditAging: {
        currentCents: agingCurrent,
        days1_15Cents: aging1_15,
        days16_30Cents: aging16_30,
        days31_45Cents: aging31_45,
        over45Cents: agingOver45,
      },
    },
  });
});

// ── 2. Daily Sales Comprehensive Report ────────────────────────────────────────
reportsRouter.get("/bi/daily-sales", async (c) => {
  const denied = await guard(c, "reports.view");
  if (denied) return denied;

  const db = c.env.DB;
  const p = current(c);
  const date = c.req.query("date") || getColomboDate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "Invalid date format. Expected YYYY-MM-DD" }, 400);
  }

  const scope = " AND (?=1 OR i.rep_id=?)";
  const repArgs = [p.admin, p.id];

  // Invoices created on this date
  const invoices = await db.prepare(`
    SELECT
      i.id,
      i.number,
      i.created_at,
      i.subtotal_cents,
      i.item_discount_cents,
      i.invoice_discount_cents,
      i.total_cents,
      i.paid_cents,
      (i.total_cents - i.paid_cents) AS balance_cents,
      i.payment_method,
      i.payment_terms,
      i.status,
      i.due_at,
      c.shop_name,
      c.owner_name,
      c.phone AS customer_phone,
      c.whatsapp AS customer_whatsapp,
      u.name AS rep_name
    FROM invoices i
    JOIN customers c ON c.id=i.customer_id
    LEFT JOIN users u ON u.id=i.rep_id
    WHERE i.status='posted' AND substr(i.created_at,1,10)=? ${scope}
    ORDER BY i.created_at DESC
  `).bind(date, ...repArgs).all();

  // Invoice items for drill-down
  const invoiceIds = (invoices.results as any[]).map((inv) => inv.id);
  const itemsByInvoice: Record<string, any[]> = {};

  if (invoiceIds.length > 0) {
    const placeholders = invoiceIds.map(() => "?").join(",");
    const items = await db.prepare(`
      SELECT ii.invoice_id, ii.quantity, ii.unit_price_cents, ii.line_cents, ii.item_discount_cents,
        pr.name AS product_name, v.label AS variant_label, v.unit
      FROM invoice_items ii
      JOIN product_variants v ON v.id=ii.variant_id
      JOIN products pr ON pr.id=v.product_id
      WHERE ii.invoice_id IN (${placeholders})
    `).bind(...invoiceIds).all();

    for (const it of (items.results as any[])) {
      if (!itemsByInvoice[it.invoice_id]) itemsByInvoice[it.invoice_id] = [];
      itemsByInvoice[it.invoice_id].push(it);
    }
  }

  // All payments collected TODAY (both for today's invoices AND prior credit settlements)
  const paymentsToday = await db.prepare(`
    SELECT
      pay.id,
      pay.invoice_id,
      pay.amount_cents,
      pay.method,
      pay.notes,
      pay.created_at,
      i.number AS invoice_number,
      substr(i.created_at,1,10) AS invoice_date,
      c.shop_name,
      u.name AS rep_name
    FROM payments pay
    JOIN invoices i ON i.id=pay.invoice_id
    JOIN customers c ON c.id=i.customer_id
    LEFT JOIN users u ON u.id=pay.created_by
    WHERE substr(pay.created_at,1,10)=? ${scope}
    ORDER BY pay.created_at DESC
  `).bind(date, ...repArgs).all();

  // Free issues on this date
  const freeIssuesToday = await db.prepare(`
    SELECT COALESCE(SUM(fi.quantity),0) AS total_qty, COALESCE(SUM(fi.cost_cents * fi.quantity),0) AS total_cost
    FROM free_issues f
    JOIN free_issue_items fi ON fi.free_issue_id=f.id
    WHERE f.status='confirmed' AND f.issue_date=? AND (?=1 OR f.rep_id=?)
  `).bind(date, p.admin, p.id).first();

  // Consignments on this date
  const consignmentsToday = await db.prepare(`
    SELECT COALESCE(SUM(ci.issued_quantity),0) AS total_qty, COALESCE(SUM(ci.issued_quantity * ci.unit_price_cents),0) AS total_value
    FROM consignments c
    JOIN consignment_items ci ON ci.consignment_id=c.id
    WHERE c.status='active' AND c.issue_date=? AND (?=1 OR c.rep_id=?)
  `).bind(date, p.admin, p.id).first();

  // Sales returns / Credit notes on this date
  const returnsToday = await db.prepare(`
    SELECT COALESCE(SUM(total_cents),0) AS total_cents, COUNT(*) AS count
    FROM credit_notes
    WHERE status='posted' AND substr(created_at,1,10)=?
  `).bind(date).first();

  // Compute daily summary totals
  let grossSalesCents = 0;
  let totalDiscountsCents = 0;
  let netSalesCents = 0;
  let cashSalesCents = 0;
  let bankSalesCents = 0;
  let creditSalesCents = 0;
  let totalItemsSoldQty = 0;
  let outstandingCreatedTodayCents = 0;

  for (const inv of (invoices.results as any[])) {
    grossSalesCents += inv.subtotal_cents || inv.total_cents;
    totalDiscountsCents += (inv.item_discount_cents || 0) + (inv.invoice_discount_cents || 0);
    netSalesCents += inv.total_cents;
    outstandingCreatedTodayCents += (inv.total_cents - inv.paid_cents);

    if (inv.payment_method === "cash") cashSalesCents += inv.total_cents;
    else if (inv.payment_method === "bank") bankSalesCents += inv.total_cents;
    else creditSalesCents += inv.total_cents;

    const invItems = itemsByInvoice[inv.id] || [];
    for (const it of invItems) {
      totalItemsSoldQty += (it.quantity || 0);
    }
  }

  // Calculate collections breakdown:
  // Payments collected today on invoices created today vs previous credit invoices
  let totalCollectionsTodayCents = 0;
  let sameDayCollectionsCents = 0;
  let previousCreditCollectionsCents = 0;

  for (const pay of (paymentsToday.results as any[])) {
    totalCollectionsTodayCents += pay.amount_cents;
    if (pay.invoice_date === date) {
      sameDayCollectionsCents += pay.amount_cents;
    } else {
      previousCreditCollectionsCents += pay.amount_cents;
    }
  }

  // Rep performance summary
  const repStats: Record<string, { repName: string; salesCents: number; collectedCents: number; invoiceCount: number }> = {};
  for (const inv of (invoices.results as any[])) {
    const rep = inv.rep_name || "Unassigned";
    if (!repStats[rep]) repStats[rep] = { repName: rep, salesCents: 0, collectedCents: 0, invoiceCount: 0 };
    repStats[rep].salesCents += inv.total_cents;
    repStats[rep].invoiceCount += 1;
  }
  for (const pay of (paymentsToday.results as any[])) {
    const rep = pay.rep_name || "Unassigned";
    if (!repStats[rep]) repStats[rep] = { repName: rep, salesCents: 0, collectedCents: 0, invoiceCount: 0 };
    repStats[rep].collectedCents += pay.amount_cents;
  }

  return c.json({
    summary: {
      date,
      grossSalesCents,
      totalDiscountsCents,
      netSalesCents,
      returnsCents: (returnsToday as any)?.total_cents ?? 0,
      invoiceCount: invoices.results.length,
      itemsSoldQty: totalItemsSoldQty,
      cashSalesCents,
      bankSalesCents,
      creditSalesCents,
      totalCollectionsTodayCents,
      sameDayCollectionsCents,
      previousCreditCollectionsCents,
      outstandingCreatedTodayCents,
      freeIssuesQty: (freeIssuesToday as any)?.total_qty ?? 0,
      freeIssuesCostCents: (freeIssuesToday as any)?.total_cost ?? 0,
      consignmentsQty: (consignmentsToday as any)?.total_qty ?? 0,
      consignmentsValueCents: (consignmentsToday as any)?.total_value ?? 0,
    },
    invoices: (invoices.results as any[]).map((inv) => ({
      ...inv,
      items: itemsByInvoice[inv.id] || [],
    })),
    payments: paymentsToday.results || [],
    repPerformance: Object.values(repStats),
  });
});

// ── 3. Dedicated Tab Reports (Reconciled & Formatted) ─────────────────────────
reportsRouter.get("/bi/tab/:tabName", async (c) => {
  const denied = await guard(c, "reports.view");
  if (denied) return denied;

  const db = c.env.DB;
  const p = current(c);
  const tab = c.req.param("tabName");
  const from = c.req.query("from") || getColomboPastDate(30);
  const to = c.req.query("to") || getColomboDate();

  const scope = " AND (?=1 OR i.rep_id=?)";
  const repArgs = [p.admin, p.id];

  switch (tab) {
    case "revenue": {
      const rows = await db.prepare(`
        SELECT
          substr(i.created_at,1,10) AS date,
          COUNT(*) AS invoice_count,
          COALESCE(SUM(i.subtotal_cents),0) AS gross_cents,
          COALESCE(SUM(i.item_discount_cents + i.invoice_discount_cents),0) AS discount_cents,
          COALESCE(SUM(i.total_cents),0) AS net_cents,
          COALESCE(SUM(i.paid_cents),0) AS paid_cents,
          COALESCE(SUM(CASE WHEN i.payment_method='cash' THEN i.total_cents ELSE 0 END),0) AS cash_cents,
          COALESCE(SUM(CASE WHEN i.payment_method='bank' THEN i.total_cents ELSE 0 END),0) AS bank_cents,
          COALESCE(SUM(CASE WHEN i.payment_method='credit' THEN i.total_cents ELSE 0 END),0) AS credit_cents
        FROM invoices i
        WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}
        GROUP BY date
        ORDER BY date DESC
        LIMIT 200
      `).bind(from, to, ...repArgs).all();
      return c.json({ rows: rows.results || [] });
    }

    case "customers": {
      const rows = await db.prepare(`
        SELECT
          c.id,
          c.shop_name,
          c.owner_name,
          c.phone,
          c.whatsapp,
          c.type,
          c.credit_limit_cents,
          c.credit_days,
          COALESCE(SUM(i.total_cents),0) AS total_invoiced_cents,
          COALESCE(SUM(i.paid_cents),0) AS total_paid_cents,
          COALESCE(SUM(i.total_cents - i.paid_cents),0) AS outstanding_cents,
          COALESCE(SUM(CASE WHEN i.due_at IS NOT NULL AND i.due_at < ? THEN i.total_cents - i.paid_cents ELSE 0 END),0) AS overdue_cents,
          MAX(substr(i.created_at,1,10)) AS last_invoice_date
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id=c.id AND i.status='posted'
        WHERE c.active=1
        GROUP BY c.id
        ORDER BY total_invoiced_cents DESC
        LIMIT 200
      `).bind(getColomboDate()).all();
      return c.json({ rows: rows.results || [] });
    }

    case "credit-payments": {
      const overdueList = await db.prepare(`
        SELECT
          i.id,
          i.number,
          i.created_at,
          i.due_at,
          i.total_cents,
          i.paid_cents,
          (i.total_cents - i.paid_cents) AS balance_cents,
          c.shop_name,
          c.owner_name,
          c.phone,
          c.whatsapp,
          c.credit_limit_cents,
          u.name AS rep_name,
          CAST((julianday(?) - julianday(COALESCE(i.due_at, substr(i.created_at,1,10)))) AS INTEGER) AS overdue_days
        FROM invoices i
        JOIN customers c ON c.id=i.customer_id
        LEFT JOIN users u ON u.id=i.rep_id
        WHERE i.status='posted' AND i.total_cents > i.paid_cents ${scope}
        ORDER BY i.due_at ASC
        LIMIT 300
      `).bind(getColomboDate(), ...repArgs).all();

      const recentPayments = await db.prepare(`
        SELECT
          p.id,
          p.amount_cents,
          p.method,
          p.notes,
          p.created_at,
          i.number AS invoice_number,
          c.shop_name,
          u.name AS received_by
        FROM payments p
        JOIN invoices i ON i.id=p.invoice_id
        JOIN customers c ON c.id=i.customer_id
        LEFT JOIN users u ON u.id=p.created_by
        WHERE substr(p.created_at,1,10)>=? AND substr(p.created_at,1,10)<=? ${scope}
        ORDER BY p.created_at DESC
        LIMIT 200
      `).bind(from, to, ...repArgs).all();

      return c.json({
        outstandingInvoices: overdueList.results || [],
        payments: recentPayments.results || [],
      });
    }

    case "products": {
      const rows = await db.prepare(`
        SELECT
          pr.sku,
          pr.name,
          v.label,
          v.unit,
          v.wholesale_cents,
          v.retail_cents,
          v.cost_cents,
          COALESCE(SUM(ii.quantity),0) AS units_sold,
          COALESCE(SUM(ii.line_cents),0) AS revenue_cents,
          COALESCE(SUM(ii.cost_cents * ii.quantity),0) AS cogs_cents,
          COALESCE(SUM((ii.unit_price_cents - ii.cost_cents) * ii.quantity),0) AS gross_profit_cents,
          COALESCE(sb.quantity, 0) AS current_stock
        FROM product_variants v
        JOIN products pr ON pr.id=v.product_id
        LEFT JOIN invoice_items ii ON ii.variant_id=v.id
        LEFT JOIN invoices i ON i.id=ii.invoice_id AND i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=? ${scope}
        LEFT JOIN stock_balances sb ON sb.variant_id=v.id AND sb.warehouse_id='main'
        WHERE pr.active=1
        GROUP BY v.id
        ORDER BY revenue_cents DESC
        LIMIT 200
      `).bind(from, to, ...repArgs).all();
      return c.json({ rows: rows.results || [] });
    }

    case "inventory": {
      const stockBalances = await db.prepare(`
        SELECT
          w.name AS warehouse_name,
          pr.name AS product_name,
          pr.sku,
          v.label,
          v.unit,
          v.wholesale_cents,
          v.cost_cents,
          v.low_stock,
          sb.quantity,
          (sb.quantity * v.wholesale_cents) AS wholesale_value_cents,
          (sb.quantity * v.cost_cents) AS cost_value_cents
        FROM stock_balances sb
        JOIN warehouses w ON w.id=sb.warehouse_id
        JOIN product_variants v ON v.id=sb.variant_id
        JOIN products pr ON pr.id=v.product_id
        WHERE pr.active=1
        ORDER BY w.name, pr.name
        LIMIT 300
      `).all();

      const recentMovements = await db.prepare(`
        SELECT
          m.created_at,
          m.quantity,
          m.reason,
          m.from_warehouse,
          m.to_warehouse,
          pr.name AS product_name,
          v.label
        FROM stock_movements m
        JOIN product_variants v ON v.id=m.variant_id
        JOIN products pr ON pr.id=v.product_id
        WHERE substr(m.created_at,1,10)>=? AND substr(m.created_at,1,10)<=?
        ORDER BY m.created_at DESC
        LIMIT 100
      `).bind(from, to).all();

      return c.json({
        balances: stockBalances.results || [],
        movements: recentMovements.results || [],
      });
    }

    case "sales-reps": {
      const reps = await db.prepare(`
        SELECT
          u.id,
          u.name,
          u.email,
          COALESCE(SUM(i.total_cents),0) AS sales_cents,
          COALESCE(SUM(i.paid_cents),0) AS collected_cents,
          COALESCE(SUM(i.total_cents - i.paid_cents),0) AS outstanding_cents,
          COUNT(DISTINCT i.id) AS invoice_count,
          COUNT(DISTINCT a.customer_id) AS assigned_shops
        FROM users u
        LEFT JOIN invoices i ON i.rep_id=u.id AND i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=?
        LEFT JOIN customer_assignments a ON a.rep_id=u.id
        WHERE u.role_id='sales_rep' AND u.active=1
        GROUP BY u.id
        ORDER BY sales_cents DESC
      `).bind(from, to).all();
      return c.json({ reps: reps.results || [] });
    }

    case "free-issues": {
      const rows = await db.prepare(`
        SELECT
          f.id,
          f.reference_number,
          f.issue_date,
          f.reason,
          f.status,
          f.notes,
          c.shop_name,
          u.name AS rep_name,
          COALESCE(SUM(fi.quantity),0) AS total_qty,
          COALESCE(SUM(fi.cost_cents * fi.quantity),0) AS total_cost_cents,
          GROUP_CONCAT(pr.name || ' ' || v.label || ' (x' || fi.quantity || ')', ', ') AS items_detail
        FROM free_issues f
        JOIN customers c ON c.id=f.customer_id
        LEFT JOIN users u ON u.id=f.rep_id
        LEFT JOIN free_issue_items fi ON fi.free_issue_id=f.id
        LEFT JOIN product_variants v ON v.id=fi.variant_id
        LEFT JOIN products pr ON pr.id=v.product_id
        WHERE f.issue_date>=? AND f.issue_date<=?
        GROUP BY f.id
        ORDER BY f.issue_date DESC
        LIMIT 200
      `).bind(from, to).all();
      return c.json({ rows: rows.results || [] });
    }

    case "consignments": {
      const rows = await db.prepare(`
        SELECT
          c.id,
          c.reference_number,
          c.issue_date,
          c.status,
          cust.shop_name,
          u.name AS rep_name,
          COALESCE(SUM(ci.issued_quantity),0) AS issued_qty,
          COALESCE(SUM(ci.returned_quantity),0) AS returned_qty,
          COALESCE(SUM(ci.sold_quantity),0) AS sold_qty,
          COALESCE(SUM(ci.issued_quantity * ci.unit_price_cents),0) AS total_value_cents,
          GROUP_CONCAT(pr.name || ' ' || v.label || ' (' || ci.issued_quantity || ' ' || v.unit || ')', ', ') AS items_detail
        FROM consignments c
        JOIN customers cust ON cust.id=c.customer_id
        LEFT JOIN users u ON u.id=c.rep_id
        LEFT JOIN consignment_items ci ON ci.consignment_id=c.id
        LEFT JOIN product_variants v ON v.id=ci.variant_id
        LEFT JOIN products pr ON pr.id=v.product_id
        WHERE c.issue_date>=? AND c.issue_date<=?
        GROUP BY c.id
        ORDER BY c.issue_date DESC
        LIMIT 200
      `).bind(from, to).all();
      return c.json({ rows: rows.results || [] });
    }

    case "expenses": {
      const rows = await db.prepare(`
        SELECT
          e.id,
          e.date,
          e.category,
          e.description,
          e.amount_cents,
          e.method,
          e.reference,
          u.name AS created_by_name
        FROM expenses e
        LEFT JOIN users u ON u.id=e.created_by
        WHERE e.date>=? AND e.date<=?
        ORDER BY e.date DESC, e.created_at DESC
        LIMIT 300
      `).bind(from, to).all();

      const summaryByCategory = await db.prepare(`
        SELECT category, COALESCE(SUM(amount_cents),0) AS total_cents, COUNT(*) AS count
        FROM expenses
        WHERE date>=? AND date<=?
        GROUP BY category
        ORDER BY total_cents DESC
      `).bind(from, to).all();

      return c.json({
        rows: rows.results || [],
        categories: summaryByCategory.results || [],
      });
    }

    case "profit-loss": {
      const [sales, cogs, returns, expenses] = await Promise.all([
        db.prepare(`
          SELECT
            COALESCE(SUM(subtotal_cents),0) AS gross_sales_cents,
            COALESCE(SUM(item_discount_cents + invoice_discount_cents),0) AS discounts_cents,
            COALESCE(SUM(total_cents),0) AS net_sales_cents
          FROM invoices
          WHERE status='posted' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=?
        `).bind(from, to).first(),
        db.prepare(`
          SELECT COALESCE(SUM(ii.cost_cents * ii.quantity),0) AS cogs_cents
          FROM invoice_items ii
          JOIN invoices i ON i.id=ii.invoice_id
          WHERE i.status='posted' AND substr(i.created_at,1,10)>=? AND substr(i.created_at,1,10)<=?
        `).bind(from, to).first(),
        db.prepare(`
          SELECT COALESCE(SUM(total_cents),0) AS returns_cents
          FROM credit_notes
          WHERE status='posted' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=?
        `).bind(from, to).first(),
        db.prepare(`
          SELECT category, COALESCE(SUM(amount_cents),0) AS amount_cents
          FROM expenses
          WHERE date>=? AND date<=?
          GROUP BY category
        `).bind(from, to).all(),
      ]);

      const grossSales = (sales as any)?.gross_sales_cents ?? 0;
      const discounts = (sales as any)?.discounts_cents ?? 0;
      const returnsAmt = (returns as any)?.returns_cents ?? 0;
      const netSales = Math.max(0, grossSales - discounts - returnsAmt);
      const costOfGoods = (cogs as any)?.cogs_cents ?? 0;
      const grossProfit = netSales - costOfGoods;

      let totalExpenses = 0;
      for (const e of (expenses.results as any[])) {
        totalExpenses += e.amount_cents;
      }
      const netOperatingProfit = grossProfit - totalExpenses;

      return c.json({
        from,
        to,
        revenue: {
          grossSalesCents: grossSales,
          discountsCents: discounts,
          returnsCents: returnsAmt,
          netSalesCents: netSales,
        },
        costOfGoodsSoldCents: costOfGoods,
        grossProfitCents: grossProfit,
        grossProfitMarginPercent: netSales > 0 ? ((grossProfit / netSales) * 100).toFixed(1) : "0.0",
        expenses: expenses.results || [],
        totalExpensesCents: totalExpenses,
        netOperatingProfitCents: netOperatingProfit,
        netMarginPercent: netSales > 0 ? ((netOperatingProfit / netSales) * 100).toFixed(1) : "0.0",
      });
    }

    default:
      return c.json({ error: `Unknown report tab '${tab}'` }, 404);
  }
});
