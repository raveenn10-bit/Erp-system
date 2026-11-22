-- Migration 0007: Complete Credit Alert, Payment Reminder, and Notification Management System
-- Append-only: Preserves all existing financial, invoice, and customer records

-- 1. Enhance notifications table for rich alert drawer
ALTER TABLE notifications ADD COLUMN invoice_id TEXT REFERENCES invoices(id);
ALTER TABLE notifications ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE notifications ADD COLUMN stage TEXT NOT NULL DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_invoice ON notifications(invoice_id);

-- 2. Enhance reminders table for multi-stage tracking
ALTER TABLE reminders ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE reminders ADD COLUMN recipient_id TEXT REFERENCES users(id);

-- 3. Notification delivery logs for WhatsApp & external channels
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id TEXT PRIMARY KEY,
  notification_id TEXT REFERENCES notifications(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  recipient_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'sent',
  sent_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_invoice ON notification_delivery_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_customer ON notification_delivery_logs(customer_id);

-- 4. Scheduler execution records table
CREATE TABLE IF NOT EXISTS scheduler_logs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'running')),
  summary TEXT NOT NULL DEFAULT '',
  invoices_checked INTEGER NOT NULL DEFAULT 0,
  alerts_created INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  executed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduler_logs_executed ON scheduler_logs(executed_at DESC);

-- 5. Credit Alert Settings table
CREATE TABLE IF NOT EXISTS credit_alert_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule_days TEXT NOT NULL DEFAULT '14,7,3,0',
  overdue_frequency_days INTEGER NOT NULL DEFAULT 7,
  recipients TEXT NOT NULL DEFAULT 'both' CHECK(recipients IN ('admin', 'rep', 'both')),
  language TEXT NOT NULL DEFAULT 'si' CHECK(language IN ('si', 'en')),
  whatsapp_template TEXT NOT NULL DEFAULT 'ආයුබෝවන් {shop_name},

ඔබගේ බිල්පත් අංකය: {invoice_number}
ගෙවීමට ඉතිරි මුදල: රු. {outstanding}
ගෙවිය යුතු දිනය: {due_date}

කරුණාකර නියමිත දිනයට පෙර ගෙවීම සිදු කරන්න.

ස්තුතියි,
Nugathalawa Ceylon Tea Export (Pvt) Ltd',
  retention_days INTEGER NOT NULL DEFAULT 90,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO credit_alert_settings(id, enabled, schedule_days, overdue_frequency_days, recipients, language, whatsapp_template, retention_days, updated_at)
VALUES(1, 1, '14,7,3,0', 7, 'both', 'si',
'ආයුබෝවන් {shop_name},

ඔබගේ බිල්පත් අංකය: {invoice_number}
ගෙවීමට ඉතිරි මුදල: රු. {outstanding}
ගෙවිය යුතු දිනය: {due_date}

කරුණාකර නියමිත දිනයට පෙර ගෙවීම සිදු කරන්න.

ස්තුතියි,
Nugathalawa Ceylon Tea Export (Pvt) Ltd',
90, '2026-11-22T00:00:00Z');
