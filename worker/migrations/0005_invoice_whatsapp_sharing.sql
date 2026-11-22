-- Migration 0005: Invoice WhatsApp Sharing & Public Invoice Verification
-- Append-only migration: Add customer_whatsapp and share_token to invoices, customer_whatsapp to invoice_drafts

ALTER TABLE invoices ADD COLUMN customer_whatsapp TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token ON invoices(share_token);

ALTER TABLE invoice_drafts ADD COLUMN customer_whatsapp TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO system_settings(key, value) VALUES
  ('invoice_show_customer_whatsapp', 'true');

-- Backfill share_token for existing invoices using random hex
UPDATE invoices SET share_token = lower(hex(randomblob(16))) WHERE share_token IS NULL;
