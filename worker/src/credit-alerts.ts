import { Hono } from "hono";
import { z } from "zod";
import {
  audit,
  current,
  guard,
  now,
  uuid,
  type Env,
  type Principal,
} from "./security";
import { normalizeWhatsApp } from "./finance";

const routes = new Hono<Env>();

// ── Helpers ──────────────────────────────────────────────────────────────────
export function colomboToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function daysDifference(targetDate: string, baseDate = colomboToday()): number {
  const t = new Date(`${targetDate.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${baseDate.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((t - b) / 86400000);
}

export function formatLkr(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const DEFAULT_WHATSAPP_TEMPLATE = `ආයුබෝවන් {shop_name},

ඔබගේ බිල්පත් අංකය: {invoice_number}
ගෙවීමට ඉතිරි මුදල: රු. {outstanding}
ගෙවිය යුතු දිනය: {due_date}

කරුණාකර නියමිත දිනයට පෙර ගෙවීම සිදු කරන්න.

ස්තුතියි,
Nugathalawa Ceylon Tea Export (Pvt) Ltd`;

export function buildWhatsAppReminderMessage(
  template: string,
  vars: {
    shop_name: string;
    invoice_number: string;
    outstanding: string;
    due_date: string;
  },
): string {
  return (template || DEFAULT_WHATSAPP_TEMPLATE)
    .replaceAll("{shop_name}", vars.shop_name)
    .replaceAll("{invoice_number}", vars.invoice_number)
    .replaceAll("{outstanding}", vars.outstanding)
    .replaceAll("{due_date}", vars.due_date);
}

export function formatNotificationContent(
  stage: string,
  lang: "si" | "en",
  vars: {
    shop_name: string;
    invoice_number: string;
    outstanding_cents: number;
    diff_days: number;
  },
) {
  const outstandingFormatted = formatLkr(vars.outstanding_cents);
  const days = Math.abs(vars.diff_days);

  if (lang === "en") {
    if (vars.diff_days > 0) {
      return {
        title: "Payment Due Soon",
        body: `${vars.shop_name} — Invoice ${vars.invoice_number} for LKR ${outstandingFormatted} is due in ${days} days.`,
      };
    } else if (vars.diff_days === 0) {
      return {
        title: "Payment Due Today",
        body: `${vars.shop_name} — Invoice ${vars.invoice_number} for LKR ${outstandingFormatted} is due today.`,
      };
    } else {
      return {
        title: "Payment Overdue",
        body: `${vars.shop_name} — Invoice ${vars.invoice_number} for LKR ${outstandingFormatted} is overdue by ${days} days.`,
      };
    }
  }

  // Default Sinhala
  if (vars.diff_days > 0) {
    return {
      title: "ණය ගෙවීමේ දිනය ළඟයි",
      body: `${vars.shop_name} — බිල්පත් අංක ${vars.invoice_number} සඳහා රු. ${outstandingFormatted}ක් ගෙවීමට තව දින ${days}ක් ඉතිරිව ඇත.`,
    };
  } else if (vars.diff_days === 0) {
    return {
      title: "අද දින ණය ගෙවිය යුතුය",
      body: `${vars.shop_name} — බිල්පත් අංක ${vars.invoice_number} සඳහා රු. ${outstandingFormatted}ක මුදල අද දින ගෙවිය යුතුය.`,
    };
  } else {
    return {
      title: "ණය ගෙවීම ප්‍රමාද වී ඇත",
      body: `${vars.shop_name} — රු. ${outstandingFormatted}ක ගෙවීම නියමිත දිනය ඉක්මවා ඇත (ප්‍රමාදය: දින ${days}).`,
    };
  }
}

// ── Background Scheduled Job: processReminders ───────────────────────────────
export async function processReminders(db: D1Database) {
  const jobId = uuid();
  const startTime = now();
  const today = colomboToday();

  try {
    // 1. Fetch settings
    const settings = (await db
      .prepare("SELECT * FROM credit_alert_settings WHERE id = 1")
      .first()) as {
      enabled: number;
      schedule_days: string;
      overdue_frequency_days: number;
      recipients: "admin" | "rep" | "both";
      language: "si" | "en";
      whatsapp_template: string;
      retention_days: number;
    } | null;

    if (settings && !settings.enabled) {
      await db
        .prepare("INSERT INTO scheduler_logs VALUES(?,?,?,?,?,?,?,?)")
        .bind(
          jobId,
          "credit_alerts",
          "success",
          "Skipped: Credit alerts disabled in settings",
          0,
          0,
          null,
          startTime,
        )
        .run();
      return { checked: 0, created: 0 };
    }

    const scheduleDays = (settings?.schedule_days || "14,7,3,0")
      .split(",")
      .map((x) => Number.parseInt(x.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    const overdueFrequency = settings?.overdue_frequency_days || 7;
    const recipientMode = settings?.recipients || "both";
    const language = settings?.language || "si";

    // 2. Query all posted, unpaid credit invoices with due_at set
    const invoices = (
      await db
        .prepare(`
          SELECT i.id, i.number, i.customer_id, i.rep_id, i.total_cents, i.paid_cents,
                 (i.total_cents - i.paid_cents) AS outstanding_cents, i.due_at,
                 c.shop_name, c.owner_name, c.phone, c.whatsapp,
                 u.name AS rep_name
          FROM invoices i
          JOIN customers c ON c.id = i.customer_id
          LEFT JOIN users u ON u.id = i.rep_id
          WHERE i.status = 'posted' AND i.due_at IS NOT NULL AND i.paid_cents < i.total_cents
        `)
        .all()
    ).results as any[];

    // 3. Admin user IDs for broadcast
    const adminUsers = (
      await db
        .prepare("SELECT id FROM users WHERE role_id = 'admin' AND active = 1")
        .all<{ id: string }>()
    ).results;

    let alertsCreated = 0;

    for (const inv of invoices) {
      if (!inv.due_at) continue;
      const diffDays = daysDifference(inv.due_at, today);

      let stage = "";
      let priority: "low" | "medium" | "high" | "urgent" = "medium";

      if (diffDays > 0) {
        if (scheduleDays.includes(diffDays)) {
          stage = `due_soon_${diffDays}d`;
          priority = diffDays <= 3 ? "high" : "medium";
        }
      } else if (diffDays === 0) {
        if (scheduleDays.includes(0)) {
          stage = "due_today";
          priority = "high";
        }
      } else {
        // Overdue (diffDays < 0)
        const overdueDays = Math.abs(diffDays);
        if (overdueDays === 1) {
          stage = "overdue_1d";
          priority = "urgent";
        } else if (overdueDays === 7) {
          stage = "overdue_7d";
          priority = "urgent";
        } else if (overdueDays > 7 && overdueDays % overdueFrequency === 0) {
          stage = `overdue_${overdueDays}d`;
          priority = "urgent";
        }
      }

      if (!stage) continue;

      // Determine recipients
      const recipients: string[] = [];
      if (recipientMode === "rep" || recipientMode === "both") {
        if (inv.rep_id) recipients.push(inv.rep_id);
      }
      if (recipientMode === "admin" || recipientMode === "both") {
        for (const adm of adminUsers) {
          if (!recipients.includes(adm.id)) recipients.push(adm.id);
        }
      }

      const { title, body } = formatNotificationContent(stage, language, {
        shop_name: inv.shop_name,
        invoice_number: inv.number,
        outstanding_cents: inv.outstanding_cents,
        diff_days: diffDays,
      });

      const metadata = JSON.stringify({
        shop_name: inv.shop_name,
        owner_name: inv.owner_name,
        invoice_number: inv.number,
        outstanding_cents: inv.outstanding_cents,
        due_at: inv.due_at,
        days_diff: diffDays,
        phone: inv.phone,
        whatsapp: inv.whatsapp,
        rep_name: inv.rep_name,
      });

      for (const uid of recipients) {
        // Deduplicate via reminders table: (invoice_id, stage, due_at)
        const check = await db
          .prepare(
            "SELECT 1 FROM reminders WHERE invoice_id = ? AND stage = ? AND due_at = ? AND (recipient_id = ? OR recipient_id IS NULL)",
          )
          .bind(inv.id, stage, inv.due_at, uid)
          .first();

        if (check) continue;

        const reminderId = uuid();
        const notificationId = uuid();

        await db.batch([
          db
            .prepare(
              "INSERT INTO reminders(id, invoice_id, type, due_at, created_at, stage, recipient_id) VALUES(?,?,?,?,?,?,?)",
            )
            .bind(reminderId, inv.id, stage, inv.due_at, now(), stage, uid),
          db
            .prepare(
              "INSERT INTO notifications(id, user_id, title, body, read_at, created_at, invoice_id, customer_id, priority, stage, metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              notificationId,
              uid,
              title,
              body,
              null,
              now(),
              inv.id,
              inv.customer_id,
              priority,
              stage,
              metadata,
            ),
        ]);

        alertsCreated++;
      }
    }

    // Clean up old notifications based on retention_days
    const retentionDays = settings?.retention_days || 90;
    const cutoffDate = new Date(
      Date.now() - retentionDays * 86400000,
    ).toISOString();
    await db
      .prepare(
        "DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?",
      )
      .bind(cutoffDate)
      .run();

    await db
      .prepare("INSERT INTO scheduler_logs VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        jobId,
        "credit_alerts",
        "success",
        `Checked ${invoices.length} invoices, generated ${alertsCreated} alerts`,
        invoices.length,
        alertsCreated,
        null,
        startTime,
      )
      .run();

    return { checked: invoices.length, created: alertsCreated };
  } catch (err: any) {
    await db
      .prepare("INSERT INTO scheduler_logs VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        jobId,
        "credit_alerts",
        "failed",
        "Job failed with error",
        0,
        0,
        String(err?.message || err),
        startTime,
      )
      .run();
    throw err;
  }
}

// ── Notifications Endpoints ──────────────────────────────────────────────────
routes.get("/notifications", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const p = current(c);
  const db = c.env.DB;
  const filter = c.req.query("filter") || "all";

  let whereFilter = "user_id = ?";
  const args: any[] = [p.id];

  if (filter === "unread") {
    whereFilter += " AND read_at IS NULL";
  } else if (filter === "overdue") {
    whereFilter += " AND stage LIKE 'overdue%'";
  } else if (filter === "due_soon") {
    whereFilter += " AND stage LIKE 'due_soon%'";
  }

  const [countRow, listRows] = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL",
      )
      .bind(p.id)
      .first<{ unread: number }>(),
    db
      .prepare(
        `SELECT n.*, i.number AS invoice_number, i.total_cents, i.paid_cents, i.due_at,
                c.shop_name, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp,
                u.name AS rep_name
         FROM notifications n
         LEFT JOIN invoices i ON i.id = n.invoice_id
         LEFT JOIN customers c ON c.id = n.customer_id
         LEFT JOIN users u ON u.id = i.rep_id
         WHERE ${whereFilter}
         ORDER BY n.created_at DESC
         LIMIT 100`,
      )
      .bind(...args)
      .all(),
  ]);

  const items = listRows.results.map((row: any) => {
    let parsedMeta: any = {};
    try {
      parsedMeta = JSON.parse(row.metadata || "{}");
    } catch {}

    const outstandingCents =
      row.total_cents != null && row.paid_cents != null
        ? row.total_cents - row.paid_cents
        : parsedMeta.outstanding_cents || 0;

    const diffDays = row.due_at
      ? daysDifference(row.due_at)
      : parsedMeta.days_diff != null
        ? parsedMeta.days_diff
        : 0;

    return {
      id: row.id,
      title: row.title,
      body: row.body,
      read_at: row.read_at,
      created_at: row.created_at,
      priority: row.priority,
      stage: row.stage,
      invoice_id: row.invoice_id,
      customer_id: row.customer_id,
      shop_name: row.shop_name || parsedMeta.shop_name || "Unknown Shop",
      invoice_number: row.invoice_number || parsedMeta.invoice_number || "—",
      outstanding_cents: outstandingCents,
      due_at: row.due_at || parsedMeta.due_at || null,
      days_diff: diffDays,
      customer_whatsapp:
        row.customer_whatsapp ||
        row.customer_phone ||
        parsedMeta.whatsapp ||
        parsedMeta.phone ||
        "",
      rep_name: row.rep_name || parsedMeta.rep_name || "Unassigned",
    };
  });

  return c.json({
    unreadCount: countRow?.unread || 0,
    notifications: items,
  });
});

routes.patch("/notifications/:id/read", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const p = current(c);
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?",
  )
    .bind(now(), id, p.id)
    .run();
  return c.json({ ok: true });
});

routes.post("/notifications/read-all", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const p = current(c);
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
  )
    .bind(now(), p.id)
    .run();
  return c.json({ ok: true });
});

routes.post("/notifications/run-check", async (c) => {
  const denied = await guard(c, "settings.edit");
  if (denied) return denied;
  const p = current(c);
  const result = await processReminders(c.env.DB);
  await audit(c.env.DB, p.id, "credit_alerts.manual_run", p.id, JSON.stringify(result));
  return c.json({ ok: true, ...result });
});

routes.post("/credit-alerts/run-check", async (c) => {
  const denied = await guard(c, "settings.edit");
  if (denied) return denied;
  const p = current(c);
  const result = await processReminders(c.env.DB);
  await audit(c.env.DB, p.id, "credit_alerts.manual_run", p.id, JSON.stringify(result));
  return c.json({ ok: true, ...result });
});

// ── Credit Alerts Dashboard Endpoints ────────────────────────────────────────
routes.get("/credit-alerts", async (c) => {
  const denied = await guard(c, "invoices.view");
  if (denied) return denied;
  const p = current(c);
  const db = c.env.DB;
  const today = colomboToday();

  // Permission scope: Admin sees all, Sales Rep sees only their assigned invoices/customers
  const scopeClause = p.admin ? "1=1" : "i.rep_id = ?";
  const scopeArgs = p.admin ? [] : [p.id];

  // 1. Fetch live summary statistics
  const [totalsRow, highRiskRow, unpaidCountRow] = await Promise.all([
    db
      .prepare(`
        SELECT
          COALESCE(SUM(i.total_cents - i.paid_cents), 0) AS total_outstanding,
          COALESCE(SUM(CASE WHEN i.due_at >= ? AND i.due_at <= date(?, '+14 days') THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS due_14d,
          COALESCE(SUM(CASE WHEN i.due_at >= ? AND i.due_at <= date(?, '+7 days') THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS due_7d,
          COALESCE(SUM(CASE WHEN i.due_at = ? THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS due_today,
          COALESCE(SUM(CASE WHEN i.due_at < ? THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS overdue
        FROM invoices i
        WHERE i.status = 'posted' AND i.due_at IS NOT NULL AND i.total_cents > i.paid_cents AND ${scopeClause}
      `)
      .bind(today, today, today, today, today, today, ...scopeArgs)
      .first<any>(),
    db
      .prepare(`
        SELECT COUNT(DISTINCT c.id) AS count
        FROM customers c
        JOIN invoices i ON i.customer_id = c.id
        WHERE i.status = 'posted' AND i.total_cents > i.paid_cents
          AND (i.due_at < date(?, '-14 days') OR (c.credit_limit_cents > 0 AND (i.total_cents - i.paid_cents) >= c.credit_limit_cents * 0.8))
          AND ${scopeClause}
      `)
      .bind(today, ...scopeArgs)
      .first<{ count: number }>(),
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM invoices i
        WHERE i.status = 'posted' AND i.total_cents > i.paid_cents AND ${scopeClause}
      `)
      .bind(...scopeArgs)
      .first<{ count: number }>(),
  ]);

  // 2. Fetch active unpaid invoices for the alert table
  const invoices = (
    await db
      .prepare(`
        SELECT i.id, i.number, i.total_cents, i.paid_cents,
               (i.total_cents - i.paid_cents) AS outstanding_cents,
               i.due_at, i.payment_terms, i.created_at,
               c.id AS customer_id, c.shop_name, c.owner_name, c.phone, c.whatsapp, c.credit_limit_cents, c.credit_days,
               u.name AS rep_name
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.rep_id
        WHERE i.status = 'posted' AND i.total_cents > i.paid_cents AND i.due_at IS NOT NULL AND ${scopeClause}
        ORDER BY i.due_at ASC
        LIMIT 500
      `)
      .bind(...scopeArgs)
      .all()
  ).results as any[];

  // 3. Get WhatsApp template
  const settings = (await db
    .prepare("SELECT whatsapp_template FROM credit_alert_settings WHERE id = 1")
    .first<{ whatsapp_template: string }>()) || {
    whatsapp_template: DEFAULT_WHATSAPP_TEMPLATE,
  };

  const alertItems = invoices.map((inv) => {
    const diffDays = daysDifference(inv.due_at, today);
    let statusCategory: "due_soon" | "due_today" | "overdue" = "due_soon";
    let priority: "low" | "medium" | "high" | "urgent" = "medium";

    if (diffDays > 0) {
      statusCategory = "due_soon";
      priority = diffDays <= 3 ? "high" : diffDays <= 7 ? "medium" : "low";
    } else if (diffDays === 0) {
      statusCategory = "due_today";
      priority = "high";
    } else {
      statusCategory = "overdue";
      priority = "urgent";
    }

    const isHighRisk =
      diffDays < -14 ||
      (inv.credit_limit_cents > 0 &&
        inv.outstanding_cents >= inv.credit_limit_cents * 0.8);

    const targetPhone = inv.whatsapp || inv.phone || "";
    const cleanPhone = targetPhone ? normalizeWhatsApp(targetPhone) : "";
    const message = buildWhatsAppReminderMessage(settings.whatsapp_template, {
      shop_name: inv.shop_name,
      invoice_number: inv.number,
      outstanding: formatLkr(inv.outstanding_cents),
      due_date: inv.due_at,
    });

    const whatsappUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
      : "";

    return {
      id: inv.id,
      number: inv.number,
      customer_id: inv.customer_id,
      shop_name: inv.shop_name,
      owner_name: inv.owner_name,
      phone: inv.phone,
      whatsapp: inv.whatsapp,
      target_phone: targetPhone,
      clean_phone: cleanPhone,
      outstanding_cents: inv.outstanding_cents,
      total_cents: inv.total_cents,
      paid_cents: inv.paid_cents,
      due_at: inv.due_at,
      payment_terms: inv.payment_terms,
      created_at: inv.created_at,
      rep_name: inv.rep_name || "Unassigned",
      days_diff: diffDays,
      status_category: statusCategory,
      priority,
      is_high_risk: isHighRisk,
      whatsapp_message: message,
      whatsapp_url: whatsappUrl,
    };
  });

  return c.json({
    stats: {
      totalOutstandingCents: totalsRow?.total_outstanding || 0,
      dueWithin14DaysCents: totalsRow?.due_14d || 0,
      dueWithin7DaysCents: totalsRow?.due_7d || 0,
      dueTodayCents: totalsRow?.due_today || 0,
      overdueCents: totalsRow?.overdue || 0,
      highRiskCount: highRiskRow?.count || 0,
      totalUnpaidCount: unpaidCountRow?.count || 0,
    },
    alerts: alertItems,
  });
});

// ── WhatsApp Direct Reminder Delivery Log ────────────────────────────────────
routes.post("/credit-alerts/send-whatsapp", async (c) => {
  const denied = await guard(c, "invoices.view");
  if (denied) return denied;
  const p = current(c);
  const db = c.env.DB;

  const payload = await c.req.json<{
    invoiceId: string;
    recipientPhone: string;
    message: string;
    notificationId?: string;
  }>();

  if (!payload.invoiceId || !payload.recipientPhone || !payload.message) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const invoice = (await db
    .prepare("SELECT id, customer_id, number FROM invoices WHERE id = ?")
    .bind(payload.invoiceId)
    .first<{ id: string; customer_id: string; number: string }>()) as any;

  if (!invoice) return c.json({ error: "Invoice not found" }, 404);

  const cleanPhone = normalizeWhatsApp(payload.recipientPhone);
  const logId = uuid();

  await db
    .prepare(
      "INSERT INTO notification_delivery_logs(id, notification_id, invoice_id, customer_id, recipient_phone, message, channel, status, sent_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      logId,
      payload.notificationId || null,
      invoice.id,
      invoice.customer_id,
      cleanPhone,
      payload.message,
      "whatsapp",
      "sent",
      p.id,
      now(),
    )
    .run();

  await audit(
    db,
    p.id,
    "whatsapp_reminder.sent",
    invoice.id,
    `Sent reminder to ${cleanPhone} for invoice ${invoice.number}`,
  );

  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(payload.message)}`;

  return c.json({
    ok: true,
    logId,
    cleanPhone,
    whatsappUrl,
  });
});

routes.get("/credit-alerts/delivery-logs", async (c) => {
  const denied = await guard(c, "invoices.view");
  if (denied) return denied;
  const invoiceId = c.req.query("invoiceId");
  const customerId = c.req.query("customerId");

  let sql = `
    SELECT l.*, u.name AS sent_by_name, i.number AS invoice_number, c.shop_name
    FROM notification_delivery_logs l
    JOIN invoices i ON i.id = l.invoice_id
    JOIN customers c ON c.id = l.customer_id
    LEFT JOIN users u ON u.id = l.sent_by
  `;
  const conds: string[] = [];
  const args: any[] = [];

  if (invoiceId) {
    conds.push("l.invoice_id = ?");
    args.push(invoiceId);
  }
  if (customerId) {
    conds.push("l.customer_id = ?");
    args.push(customerId);
  }

  if (conds.length) {
    sql += ` WHERE ${conds.join(" AND ")}`;
  }

  sql += " ORDER BY l.created_at DESC LIMIT 100";

  const rows = (await c.env.DB.prepare(sql).bind(...args).all()).results;
  return c.json(rows);
});

// ── Credit Alert Settings Endpoints ──────────────────────────────────────────
routes.get("/credit-alerts/settings", async (c) => {
  const denied = await guard(c, "settings.view");
  if (denied) return denied;
  const settings = await c.env.DB.prepare(
    "SELECT * FROM credit_alert_settings WHERE id = 1",
  ).first();
  return c.json(settings);
});

routes.patch("/credit-alerts/settings", async (c) => {
  const denied = await guard(c, "settings.edit");
  if (denied) return denied;
  const p = current(c);
  const db = c.env.DB;

  const schema = z.object({
    enabled: z.number().int().min(0).max(1).optional(),
    scheduleDays: z.string().max(100).optional(),
    overdueFrequencyDays: z.number().int().min(1).max(30).optional(),
    recipients: z.enum(["admin", "rep", "both"]).optional(),
    language: z.enum(["si", "en"]).optional(),
    whatsappTemplate: z.string().max(2000).optional(),
    retentionDays: z.number().int().min(7).max(365).optional(),
  });

  const body = schema.parse(await c.req.json());
  const sets: string[] = [];
  const vals: any[] = [];

  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(body.enabled);
  }
  if (body.scheduleDays !== undefined) {
    sets.push("schedule_days = ?");
    vals.push(body.scheduleDays);
  }
  if (body.overdueFrequencyDays !== undefined) {
    sets.push("overdue_frequency_days = ?");
    vals.push(body.overdueFrequencyDays);
  }
  if (body.recipients !== undefined) {
    sets.push("recipients = ?");
    vals.push(body.recipients);
  }
  if (body.language !== undefined) {
    sets.push("language = ?");
    vals.push(body.language);
  }
  if (body.whatsappTemplate !== undefined) {
    sets.push("whatsapp_template = ?");
    vals.push(body.whatsappTemplate);
  }
  if (body.retentionDays !== undefined) {
    sets.push("retention_days = ?");
    vals.push(body.retentionDays);
  }

  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);

  sets.push("updated_at = ?");
  vals.push(now());

  await db
    .prepare(`UPDATE credit_alert_settings SET ${sets.join(", ")} WHERE id = 1`)
    .bind(...vals)
    .run();

  await audit(db, p.id, "credit_alerts.settings_updated", "1");
  return c.json({ ok: true });
});

routes.get("/credit-alerts/scheduler-logs", async (c) => {
  const denied = await guard(c, "settings.view");
  if (denied) return denied;
  const rows = (
    await c.env.DB.prepare(
      "SELECT * FROM scheduler_logs ORDER BY executed_at DESC LIMIT 50",
    ).all()
  ).results;
  return c.json(rows);
});

export default routes;
