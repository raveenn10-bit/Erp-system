-- Billing, free issue, and consignment upgrade.
-- Append-only migration: existing records are retained and receive safe defaults.

ALTER TABLE product_variants ADD COLUMN shop_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(shop_price_cents >= 0);

ALTER TABLE invoices ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_cents >= 0);
ALTER TABLE invoices ADD COLUMN item_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(item_discount_cents >= 0);
ALTER TABLE invoices ADD COLUMN invoice_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(invoice_discount_cents >= 0);
ALTER TABLE invoices ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE invoices ADD COLUMN payment_terms TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN terms TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN source_type TEXT NOT NULL DEFAULT 'sale';
ALTER TABLE invoices ADD COLUMN source_id TEXT;

ALTER TABLE invoice_items ADD COLUMN price_type TEXT NOT NULL DEFAULT 'wholesale';
ALTER TABLE invoice_items ADD COLUMN item_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(item_discount_cents >= 0);
ALTER TABLE invoice_items ADD COLUMN shop_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(shop_price_cents >= 0);

UPDATE invoices SET subtotal_cents = total_cents WHERE subtotal_cents = 0;

INSERT OR IGNORE INTO system_settings(key,value) VALUES
  ('invoice_show_shop_price','false'),
  ('invoice_default_terms','Goods sold are subject to the agreed payment terms.'),
  ('invoice_number_prefix','INV'),
  ('free_issue_number_prefix','FI'),
  ('consignment_number_prefix','CON');

CREATE TABLE invoice_drafts(
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  rep_id TEXT NOT NULL REFERENCES users(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  invoice_date TEXT NOT NULL,
  due_at TEXT,
  payment_method TEXT NOT NULL CHECK(payment_method IN('cash','bank','credit','other')),
  payment_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  invoice_discount_type TEXT NOT NULL DEFAULT 'fixed' CHECK(invoice_discount_type IN('fixed','percent')),
  invoice_discount_value INTEGER NOT NULL DEFAULT 0 CHECK(invoice_discount_value >= 0),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX invoice_drafts_rep_updated ON invoice_drafts(rep_id,updated_at);

CREATE TABLE free_issues(
  id TEXT PRIMARY KEY,
  reference_number TEXT NOT NULL UNIQUE,
  issue_date TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  rep_id TEXT NOT NULL REFERENCES users(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  reason TEXT NOT NULL CHECK(reason IN('sample','promotion','trial','replacement','other')),
  notes TEXT NOT NULL DEFAULT '',
  issued_by TEXT NOT NULL,
  received_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN('draft','confirmed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX free_issues_customer_date ON free_issues(customer_id,issue_date);
CREATE INDEX free_issues_rep_date ON free_issues(rep_id,issue_date);

CREATE TABLE free_issue_items(
  id TEXT PRIMARY KEY,
  free_issue_id TEXT NOT NULL REFERENCES free_issues(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  cost_cents INTEGER NOT NULL CHECK(cost_cents >= 0),
  UNIQUE(free_issue_id,variant_id)
);

CREATE TABLE consignments(
  id TEXT PRIMARY KEY,
  reference_number TEXT NOT NULL UNIQUE,
  issue_date TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  rep_id TEXT NOT NULL REFERENCES users(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  expected_settlement_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  issued_by TEXT NOT NULL,
  received_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN('open','partially_settled','settled','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX consignments_customer_status ON consignments(customer_id,status);
CREATE INDEX consignments_rep_date ON consignments(rep_id,issue_date);

CREATE TABLE consignment_items(
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES consignments(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  issued_quantity INTEGER NOT NULL CHECK(issued_quantity > 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK(sold_quantity >= 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK(damaged_quantity >= 0),
  agreed_unit_price_cents INTEGER NOT NULL CHECK(agreed_unit_price_cents >= 0),
  UNIQUE(consignment_id,variant_id),
  CHECK(sold_quantity + returned_quantity + damaged_quantity <= issued_quantity)
);

CREATE TABLE consignment_settlements(
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES consignments(id),
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  settlement_date TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE consignment_settlement_items(
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES consignment_settlements(id),
  consignment_item_id TEXT NOT NULL REFERENCES consignment_items(id),
  sold_quantity INTEGER NOT NULL CHECK(sold_quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0),
  UNIQUE(settlement_id,consignment_item_id)
);

CREATE TABLE consignment_returns(
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES consignments(id),
  return_date TEXT NOT NULL,
  condition TEXT NOT NULL CHECK(condition IN('saleable','damaged','expired')),
  reason TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE consignment_return_items(
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES consignment_returns(id),
  consignment_item_id TEXT NOT NULL REFERENCES consignment_items(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  UNIQUE(return_id,consignment_item_id)
);

CREATE UNIQUE INDEX stock_distribution_once
  ON stock_movements(reason,reference_id,variant_id)
  WHERE reason IN('free_issue','free_issue_reversal','consignment_issue','consignment_return','consignment_damaged');

INSERT OR IGNORE INTO permissions(key,description) VALUES
  ('free_issues.view','View free issues'),
  ('free_issues.create','Create and confirm free issues'),
  ('free_issues.cancel','Cancel free issues'),
  ('consignments.view','View consignments'),
  ('consignments.create','Create consignments'),
  ('consignments.settle','Settle sold consignment stock'),
  ('consignments.return','Return consignment stock');

INSERT OR IGNORE INTO role_permissions(role_id,permission_key) VALUES
  ('sales_rep','free_issues.view'),
  ('sales_rep','free_issues.create'),
  ('sales_rep','consignments.view'),
  ('sales_rep','consignments.create'),
  ('sales_rep','consignments.settle'),
  ('sales_rep','consignments.return');

CREATE TRIGGER free_issue_items_immutable_update BEFORE UPDATE ON free_issue_items
BEGIN SELECT RAISE(ABORT,'free issue items are immutable'); END;
CREATE TRIGGER free_issue_items_immutable_delete BEFORE DELETE ON free_issue_items
BEGIN SELECT RAISE(ABORT,'free issue items are immutable'); END;
CREATE TRIGGER consignment_issued_immutable BEFORE UPDATE OF issued_quantity,variant_id,agreed_unit_price_cents ON consignment_items
BEGIN SELECT RAISE(ABORT,'issued consignment values are immutable'); END;
CREATE TRIGGER invoices_billing_immutable BEFORE UPDATE OF subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id ON invoices
BEGIN SELECT RAISE(ABORT,'posted invoice billing values are immutable'); END;
CREATE TRIGGER free_issue_header_immutable BEFORE UPDATE OF reference_number,issue_date,customer_id,rep_id,warehouse_id,reason,notes,issued_by,received_by ON free_issues
BEGIN SELECT RAISE(ABORT,'free issue values are immutable'); END;
CREATE TRIGGER consignment_header_immutable BEFORE UPDATE OF reference_number,issue_date,customer_id,rep_id,warehouse_id,expected_settlement_date,notes,issued_by,received_by ON consignments
BEGIN SELECT RAISE(ABORT,'consignment issue values are immutable'); END;
