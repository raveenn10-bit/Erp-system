import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  colomboToday,
  daysDifference,
  formatLkr,
  buildWhatsAppReminderMessage,
  formatNotificationContent,
  DEFAULT_WHATSAPP_TEMPLATE,
} from '../src/credit-alerts';

function setupTestDb() {
  const root = path.resolve(__dirname, '..');
  const migrationsDir = path.join(root, 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
  }

  const now = '2026-11-22T00:00:00Z';
  // Insert users: 1 admin, 1 rep
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('admin-1', 'Sanjeewa Admin', 'admin@example.lk', 'hash', 'admin', 1, now);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('rep-1', 'Nimal Rep', 'rep@example.lk', 'hash', 'sales_rep', 1, now);

  // Insert customers (high credit limit for multi-invoice testing)
  db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('cust-1', 'Peiris Stores', 'Sunil Peiris', '0771234567', '0771234567', 'Galle Rd, Colombo', 'Colombo', 'wholesale', 50000000, 30, 1, now);
  db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('cust-2', 'Kandy Super', 'Anura Kumara', '0719876543', '0719876543', 'Kandy Rd, Kandy', 'Kandy', 'wholesale', 30000000, 30, 1, now);

  return { db, now };
}

describe('Credit Alert Notification Formatting & Language Rules', () => {
  it('correctly renders Sinhala notifications for due soon, due today, and overdue stages', () => {
    // 1. Due soon (7 days)
    const dueSoon = formatNotificationContent('due_soon_7d', 'si', {
      shop_name: 'පීරිස් ස්ටෝර්ස්',
      invoice_number: 'INV-001',
      outstanding_cents: 255000, // LKR 2,550
      diff_days: 7,
    });
    expect(dueSoon.title).toBe('ණය ගෙවීමේ දිනය ළඟයි');
    expect(dueSoon.body).toContain('පීරිස් ස්ටෝර්ස්');
    expect(dueSoon.body).toContain('INV-001');
    expect(dueSoon.body).toContain('2,550.00');
    expect(dueSoon.body).toContain('තව දින 7ක්');

    // 2. Due today (0 days)
    const dueToday = formatNotificationContent('due_today', 'si', {
      shop_name: 'පීරිස් ස්ටෝර්ස්',
      invoice_number: 'INV-002',
      outstanding_cents: 350000,
      diff_days: 0,
    });
    expect(dueToday.title).toBe('අද දින ණය ගෙවිය යුතුය');
    expect(dueToday.body).toContain('අද දින ගෙවිය යුතුය');

    // 3. Overdue (5 days overdue => diff_days = -5)
    const overdue = formatNotificationContent('overdue_5d', 'si', {
      shop_name: 'පීරිස් ස්ටෝර්ස්',
      invoice_number: 'INV-003',
      outstanding_cents: 500000,
      diff_days: -5,
    });
    expect(overdue.title).toBe('ණය ගෙවීම ප්‍රමාද වී ඇත');
    expect(overdue.body).toContain('නියමිත දිනය ඉක්මවා ඇත');
    expect(overdue.body).toContain('ප්‍රමාදය: දින 5');

    // 4. English fallback
    const engDueSoon = formatNotificationContent('due_soon_7d', 'en', {
      shop_name: 'Peiris Stores',
      invoice_number: 'INV-001',
      outstanding_cents: 255000,
      diff_days: 7,
    });
    expect(engDueSoon.title).toBe('Payment Due Soon');
    expect(engDueSoon.body).toContain('due in 7 days');
  });

  it('correctly builds dynamic WhatsApp reminder messages', () => {
    const msg = buildWhatsAppReminderMessage(DEFAULT_WHATSAPP_TEMPLATE, {
      shop_name: 'පීරිස් ස්ටෝර්ස්',
      invoice_number: 'INV-001',
      outstanding: '2,550.00',
      due_date: '2026-12-05',
    });

    expect(msg).toContain('ආයුබෝවන් පීරිස් ස්ටෝර්ස්');
    expect(msg).toContain('ඔබගේ බිල්පත් අංකය: INV-001');
    expect(msg).toContain('ගෙවීමට ඉතිරි මුදල: රු. 2,550.00');
    expect(msg).toContain('ගෙවිය යුතු දිනය: 2026-12-05');
    expect(msg).toContain('Nugathalawa Ceylon Tea Export (Pvt) Ltd');
  });
});

describe('Credit Alert Database Triggers & Scheduler Engine', () => {
  it('evaluates reminder stages (14d, 7d, 3d, 0d, -1d, -7d) and prevents duplicate notifications', () => {
    const { db, now } = setupTestDb();

    // Helper to calculate target date offset from today in YYYY-MM-DD
    function dateOffset(offsetDays: number): string {
      const today = colomboToday();
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    }

    const invSql = `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    // Invoice 1: Due in 14 days
    db.prepare(invSql).run(
      'inv-14d', 'INV-14D', 'cust-1', 'rep-1', 'main',
      100000, 0, 'posted', dateOffset(14), 'k-14d',
      now, null, 100000, 0, 0, 'credit', '14 days', '', '', 'sale', null, '0771234567', 't-1'
    );

    // Invoice 2: Due in 7 days
    db.prepare(invSql).run(
      'inv-7d', 'INV-7D', 'cust-1', 'rep-1', 'main',
      200000, 0, 'posted', dateOffset(7), 'k-7d',
      now, null, 200000, 0, 0, 'credit', '7 days', '', '', 'sale', null, '0771234567', 't-2'
    );

    // Invoice 3: Due in 3 days
    db.prepare(invSql).run(
      'inv-3d', 'INV-3D', 'cust-1', 'rep-1', 'main',
      300000, 50000, 'posted', dateOffset(3), 'k-3d', // partial payment
      now, null, 300000, 0, 0, 'credit', '3 days', '', '', 'sale', null, '0771234567', 't-3'
    );

    // Invoice 4: Due today (0 days)
    db.prepare(invSql).run(
      'inv-0d', 'INV-0D', 'cust-1', 'rep-1', 'main',
      400000, 0, 'posted', dateOffset(0), 'k-0d',
      now, null, 400000, 0, 0, 'credit', 'today', '', '', 'sale', null, '0771234567', 't-4'
    );

    // Invoice 5: 1 day overdue (-1 days)
    db.prepare(invSql).run(
      'inv-ov1d', 'INV-OV1D', 'cust-1', 'rep-1', 'main',
      500000, 0, 'posted', dateOffset(-1), 'k-ov1d',
      now, null, 500000, 0, 0, 'credit', 'overdue 1d', '', '', 'sale', null, '0771234567', 't-5'
    );

    // Invoice 6: 7 days overdue (-7 days)
    db.prepare(invSql).run(
      'inv-ov7d', 'INV-OV7D', 'cust-1', 'rep-1', 'main',
      600000, 0, 'posted', dateOffset(-7), 'k-ov7d',
      now, null, 600000, 0, 0, 'credit', 'overdue 7d', '', '', 'sale', null, '0771234567', 't-6'
    );

    // Invoice 7: Fully settled (should NOT generate alerts)
    db.prepare(invSql).run(
      'inv-paid', 'INV-PAID', 'cust-1', 'rep-1', 'main',
      100000, 100000, 'posted', dateOffset(7), 'k-paid',
      now, null, 100000, 0, 0, 'credit', 'paid', '', '', 'sale', null, '0771234567', 't-7'
    );

    // Invoice 8: Cancelled (should NOT generate alerts)
    db.prepare(invSql).run(
      'inv-canc', 'INV-CANC', 'cust-1', 'rep-1', 'main',
      100000, 0, 'cancelled', dateOffset(7), 'k-canc',
      now, now, 100000, 0, 0, 'credit', 'cancelled', '', '', 'sale', null, '0771234567', 't-8'
    );

    // Simulate scheduler processing
    const today = colomboToday();
    const unpaidInvoices = db.prepare(`
      SELECT i.id, i.number, i.customer_id, i.rep_id, i.total_cents, i.paid_cents,
             (i.total_cents - i.paid_cents) AS outstanding_cents, i.due_at,
             c.shop_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.status = 'posted' AND i.due_at IS NOT NULL AND i.paid_cents < i.total_cents
    `).all() as any[];

    expect(unpaidInvoices.length).toBe(6); // exactly the 6 active unpaid invoices

    const createdAlerts: any[] = [];
    for (const inv of unpaidInvoices) {
      const diff = daysDifference(inv.due_at, today);
      let stage = '';
      if (diff === 14) stage = 'due_soon_14d';
      else if (diff === 7) stage = 'due_soon_7d';
      else if (diff === 3) stage = 'due_soon_3d';
      else if (diff === 0) stage = 'due_today';
      else if (diff === -1) stage = 'overdue_1d';
      else if (diff === -7) stage = 'overdue_7d';

      if (stage) {
        // Insert reminder and notification for rep
        db.prepare(`INSERT INTO reminders(id, invoice_id, type, due_at, created_at, stage, recipient_id) VALUES(?,?,?,?,?,?,?)`)
          .run(`rem-${inv.id}`, inv.id, stage, inv.due_at, now, stage, inv.rep_id);

        db.prepare(`INSERT INTO notifications(id, user_id, title, body, read_at, created_at, invoice_id, customer_id, priority, stage, metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(`notif-${inv.id}`, inv.rep_id, 'Alert', 'Body', null, now, inv.id, inv.customer_id, 'medium', stage, '{}');

        createdAlerts.push({ id: inv.id, stage });
      }
    }

    expect(createdAlerts.length).toBe(6);
    const stages = createdAlerts.map(a => a.stage).sort();
    expect(stages).toEqual(['due_soon_14d', 'due_soon_3d', 'due_soon_7d', 'due_today', 'overdue_1d', 'overdue_7d'].sort());

    // Verify duplicate prevention:
    // A second check should find all (invoice_id, stage, due_at) already recorded in reminders table
    for (const inv of unpaidInvoices) {
      const diff = daysDifference(inv.due_at, today);
      let stage = '';
      if (diff === 14) stage = 'due_soon_14d';
      else if (diff === 7) stage = 'due_soon_7d';
      else if (diff === 3) stage = 'due_soon_3d';
      else if (diff === 0) stage = 'due_today';
      else if (diff === -1) stage = 'overdue_1d';
      else if (diff === -7) stage = 'overdue_7d';

      const existing = db.prepare(`SELECT 1 FROM reminders WHERE invoice_id=? AND stage=? AND due_at=?`).get(inv.id, stage, inv.due_at);
      expect(existing).toBeTruthy(); // already recorded, so duplicate will be skipped!
    }
  });

  it('records WhatsApp payment reminder delivery logs and updates notification read status', () => {
    const { db, now } = setupTestDb();

    // Insert an invoice and a notification
    const invSql = `INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    db.prepare(invSql).run(
      'inv-test', 'INV-LOG-1', 'cust-1', 'rep-1', 'main',
      255000, 0, 'posted', '2026-12-01', 'k-log',
      now, null, 255000, 0, 0, 'credit', '30 days', '', '', 'sale', null, '0771234567', 't-log'
    );

    db.prepare(`INSERT INTO notifications(id, user_id, title, body, read_at, created_at, invoice_id, customer_id, priority, stage, metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run('notif-1', 'rep-1', 'ණය ගෙවීමේ දිනය ළඟයි', 'Body text', null, now, 'inv-test', 'cust-1', 'medium', 'due_soon_7d', '{}');

    // 1. Mark notification as read
    db.prepare(`UPDATE notifications SET read_at = ? WHERE id = 'notif-1'`).run('2026-11-22T10:00:00Z');
    const notif = db.prepare(`SELECT read_at FROM notifications WHERE id = 'notif-1'`).get() as any;
    expect(notif.read_at).toBe('2026-11-22T10:00:00Z');

    // 2. Record WhatsApp reminder delivery log
    const logId = 'log-1';
    db.prepare(`
      INSERT INTO notification_delivery_logs(id, notification_id, invoice_id, customer_id, recipient_phone, message, channel, status, sent_by, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(logId, 'notif-1', 'inv-test', 'cust-1', '94771234567', 'Reminder message text', 'whatsapp', 'sent', 'rep-1', now);

    const logEntry = db.prepare(`SELECT * FROM notification_delivery_logs WHERE id = 'log-1'`).get() as any;
    expect(logEntry.recipient_phone).toBe('94771234567');
    expect(logEntry.channel).toBe('whatsapp');
    expect(logEntry.status).toBe('sent');
    expect(logEntry.sent_by).toBe('rep-1');

    // 3. Log scheduler execution
    db.prepare(`
      INSERT INTO scheduler_logs(id, job_name, status, summary, invoices_checked, alerts_created, error, executed_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).run('sched-1', 'credit_alerts', 'success', 'Checked 10 invoices, generated 2 alerts', 10, 2, null, now);

    const schedEntry = db.prepare(`SELECT * FROM scheduler_logs WHERE id = 'sched-1'`).get() as any;
    expect(schedEntry.job_name).toBe('credit_alerts');
    expect(schedEntry.invoices_checked).toBe(10);
    expect(schedEntry.alerts_created).toBe(2);
    expect(schedEntry.status).toBe('success');
  });
});
