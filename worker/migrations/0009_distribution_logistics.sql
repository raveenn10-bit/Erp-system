-- Distribution logistics upgrade.
-- Additive only: no existing stock, invoices, payments, or movement history is changed.

CREATE TABLE warehouse_metadata(
  warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),
  location_type TEXT NOT NULL CHECK(location_type IN('warehouse','sales_rep','vehicle')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1))
);
INSERT INTO warehouse_metadata(warehouse_id,location_type,active)
SELECT id,CASE WHEN rep_id IS NULL THEN 'warehouse' ELSE 'sales_rep' END,1 FROM warehouses;

CREATE TABLE stock_balance_status(
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),
  allocated_quantity INTEGER NOT NULL DEFAULT 0 CHECK(allocated_quantity>=0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK(damaged_quantity>=0),
  PRIMARY KEY(warehouse_id,variant_id)
);

CREATE TABLE stock_movement_metadata(
  movement_id TEXT PRIMARY KEY REFERENCES stock_movements(id),
  transaction_reference TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  route_id TEXT,
  transfer_id TEXT
);

CREATE TABLE vehicles(
  id TEXT PRIMARY KEY,
  registration_number TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL CHECK(vehicle_type IN('Van','Lorry','Three-Wheeler','Car','Motorcycle','Other')),
  name TEXT NOT NULL DEFAULT '',
  driver_id TEXT REFERENCES users(id),
  sales_rep_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Inactive','Maintenance')),
  notes TEXT NOT NULL DEFAULT '',
  stock_warehouse_id TEXT NOT NULL UNIQUE REFERENCES warehouses(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX vehicles_rep_status ON vehicles(sales_rep_id,status);

CREATE TABLE daily_routes(
  id TEXT PRIMARY KEY,
  reference_number TEXT NOT NULL UNIQUE,
  route_name TEXT NOT NULL,
  route_date TEXT NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  driver_id TEXT REFERENCES users(id),
  sales_rep_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN('Planned','Loading','Ready','In Progress','Completed','Reconciled')),
  start_time TEXT,
  end_time TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(vehicle_id,route_date),
  UNIQUE(sales_rep_id,route_date)
);
CREATE INDEX daily_routes_date_status ON daily_routes(route_date,status);

CREATE TABLE daily_route_customers(
  route_id TEXT NOT NULL REFERENCES daily_routes(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  visit_order INTEGER NOT NULL CHECK(visit_order>0),
  status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN('Planned','Visited','Skipped')),
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(route_id,customer_id),
  UNIQUE(route_id,visit_order)
);

CREATE TABLE stock_transfers(
  id TEXT PRIMARY KEY,
  reference_number TEXT NOT NULL UNIQUE,
  source_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  destination_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  route_id TEXT REFERENCES daily_routes(id),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Pending','Confirmed','Cancelled')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  CHECK(source_warehouse_id<>destination_warehouse_id)
);
CREATE INDEX stock_transfers_created ON stock_transfers(created_at,status);

CREATE TABLE stock_transfer_items(
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES stock_transfers(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK(quantity>0),
  UNIQUE(transfer_id,variant_id)
);

CREATE TABLE vehicle_loadings(
  id TEXT PRIMARY KEY,
  reference_number TEXT NOT NULL UNIQUE,
  loading_date TEXT NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  route_id TEXT NOT NULL REFERENCES daily_routes(id),
  sales_rep_id TEXT NOT NULL REFERENCES users(id),
  source_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  transfer_id TEXT UNIQUE REFERENCES stock_transfers(id),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Confirmed','Cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX vehicle_loadings_date ON vehicle_loadings(loading_date,vehicle_id);

CREATE TABLE vehicle_loading_items(
  id TEXT PRIMARY KEY,
  loading_id TEXT NOT NULL REFERENCES vehicle_loadings(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK(quantity>0),
  UNIQUE(loading_id,variant_id)
);

CREATE TABLE route_reconciliations(
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL UNIQUE REFERENCES daily_routes(id),
  reference_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK(status IN('Submitted','Approved','Rejected')),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  variance_reason TEXT NOT NULL DEFAULT '',
  approval_notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  submitted_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE route_reconciliation_items(
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES route_reconciliations(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  opening_quantity INTEGER NOT NULL DEFAULT 0 CHECK(opening_quantity>=0),
  loaded_quantity INTEGER NOT NULL DEFAULT 0 CHECK(loaded_quantity>=0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK(sold_quantity>=0),
  free_issue_quantity INTEGER NOT NULL DEFAULT 0 CHECK(free_issue_quantity>=0),
  consignment_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consignment_quantity>=0),
  customer_return_quantity INTEGER NOT NULL DEFAULT 0 CHECK(customer_return_quantity>=0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK(damaged_quantity>=0),
  transfer_out_quantity INTEGER NOT NULL DEFAULT 0 CHECK(transfer_out_quantity>=0),
  expected_quantity INTEGER NOT NULL CHECK(expected_quantity>=0),
  counted_quantity INTEGER NOT NULL CHECK(counted_quantity>=0),
  variance_quantity INTEGER NOT NULL,
  UNIQUE(reconciliation_id,variant_id)
);

CREATE TABLE distribution_entity_routes(
  entity_type TEXT NOT NULL CHECK(entity_type IN('invoice','free_issue','consignment')),
  entity_id TEXT NOT NULL,
  route_id TEXT NOT NULL REFERENCES daily_routes(id),
  PRIMARY KEY(entity_type,entity_id)
);
CREATE INDEX distribution_entity_routes_route ON distribution_entity_routes(route_id,entity_type);

CREATE UNIQUE INDEX stock_internal_transfer_once
  ON stock_movements(reason,reference_id,variant_id)
  WHERE reason IN('stock_transfer','vehicle_loading','route_return','route_variance');
CREATE INDEX stock_movement_metadata_route ON stock_movement_metadata(route_id);
CREATE INDEX stock_movement_metadata_reference ON stock_movement_metadata(transaction_reference);

INSERT OR IGNORE INTO permissions(key,description) VALUES
  ('distribution.view','View assigned distribution routes and stock'),
  ('vehicles.manage','Manage distribution vehicles'),
  ('routes.manage','Plan and manage daily routes'),
  ('stock.transfer.manage','Create and confirm controlled stock transfers'),
  ('reconciliations.submit','Submit route closing stock counts'),
  ('reconciliations.approve','Approve route stock reconciliation variances');

INSERT OR IGNORE INTO role_permissions(role_id,permission_key) VALUES
  ('sales_rep','distribution.view'),
  ('sales_rep','reconciliations.submit');

CREATE TRIGGER stock_transfer_items_immutable_update BEFORE UPDATE ON stock_transfer_items
BEGIN SELECT RAISE(ABORT,'confirmed transfer items are immutable'); END;
CREATE TRIGGER stock_transfer_items_immutable_delete BEFORE DELETE ON stock_transfer_items
BEGIN SELECT RAISE(ABORT,'transfer items are immutable'); END;
CREATE TRIGGER vehicle_loading_items_immutable_update BEFORE UPDATE ON vehicle_loading_items
BEGIN SELECT RAISE(ABORT,'vehicle loading items are immutable'); END;
CREATE TRIGGER vehicle_loading_items_immutable_delete BEFORE DELETE ON vehicle_loading_items
BEGIN SELECT RAISE(ABORT,'vehicle loading items are immutable'); END;

