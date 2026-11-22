"""SQLite constraint smoke tests for the SQL migrations; run with python3 worker/test/db-integrity.py."""
import pathlib, sqlite3
root=pathlib.Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted((root/'migrations').glob('*.sql')):db.executescript(migration.read_text())
now='2026-11-22T00:00:00Z'
db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?)',('admin','Admin','admin@example.lk','hash','admin',1,now))
db.execute('INSERT INTO categories VALUES(?,?)',('tea','Tea'))
db.execute('INSERT INTO products VALUES(?,?,?,?,?,?,?)',('p','tea','Tea','T50',None,1,now))
db.execute('INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)',('v','p','50g','pack',50,15000,10000,7000,10,12000))
db.execute('INSERT INTO stock_balances VALUES(?,?,?)',('main','v',5))
db.execute('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('c','Shop','Owner','','','','','wholesale',100000,30,1,now))
db.commit()
def rejects(fn):
    try:fn();raise AssertionError('Expected constraint rejection')
    except sqlite3.IntegrityError:db.rollback()
rejects(lambda:db.execute('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)',('m','v','main',None,6,'sale','invoice',now)))
rejects(lambda:db.execute('UPDATE stock_balances SET quantity=-1'))
invoice_sql='INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
rejects(lambda:db.execute(invoice_sql,('bad','SD-1','c','admin','main',100001,0,'posted','2026-12-22','k1',now,None,100001,0,0,'credit','','','','sale',None)))
db.execute(invoice_sql,('inv','SD-2','c','admin','main',10000,4000,'posted','2026-12-22','k2',now,None,10000,0,0,'cash','','','','sale',None))
db.execute('INSERT INTO payments VALUES(?,?,?,?,?,?,?)',('pay','inv',4000,'cash','pay-key','admin',now))
db.commit()
rejects(lambda:db.execute('INSERT INTO payments VALUES(?,?,?,?,?,?,?)',('pay2','inv',1,'cash','pay-key-2','admin',now)))
rejects(lambda:db.execute('UPDATE invoices SET total_cents=1 WHERE id=?',('inv',)))
rejects(lambda:db.execute(invoice_sql,('dup','SD-3','c','admin','main',10000,0,'posted',None,'k2',now,None,10000,0,0,'credit','','','','sale',None)))

# Free issue: stock movement is separate from revenue/debt and idempotent per variant.
db.execute("INSERT INTO free_issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",('fi','FI-1','2026-11-22','c','admin','main','sample','','Admin','Owner','confirmed','fi-key',now,now,None))
db.execute("INSERT INTO free_issue_items VALUES(?,?,?,?,?)",('fii','fi','v',2,7000))
db.execute("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)",('fm','v','main',None,2,'free_issue','fi',now))
db.execute("UPDATE stock_balances SET quantity=quantity-2 WHERE warehouse_id='main' AND variant_id='v'")
assert db.execute("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v'").fetchone()[0]==3
assert db.execute("SELECT COUNT(*) FROM invoices WHERE source_id='fi'").fetchone()[0]==0
rejects(lambda:db.execute("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)",('fm2','v','main',None,1,'free_issue','fi',now)))

# Consignment issue is not a sale; settlement quantities cannot exceed issued stock.
db.execute("INSERT INTO consignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",('co','CON-1','2026-11-22','c','admin','main','2026-12-22','','Admin','Owner','open','co-key',now,None))
db.execute("INSERT INTO consignment_items VALUES(?,?,?,?,?,?,?,?)",('ci','co','v',2,0,0,0,10000))
db.execute("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)",('cm','v','main',None,2,'consignment_issue','co',now))
db.execute("UPDATE stock_balances SET quantity=quantity-2 WHERE warehouse_id='main' AND variant_id='v'")
assert db.execute("SELECT COUNT(*) FROM invoices WHERE source_id='co'").fetchone()[0]==0
db.commit()
rejects(lambda:db.execute("UPDATE consignment_items SET sold_quantity=3 WHERE id='ci'"))
db.execute("UPDATE consignment_items SET sold_quantity=1 WHERE id='ci'")
db.execute("UPDATE consignment_items SET returned_quantity=1 WHERE id='ci'")
db.commit()
rejects(lambda:db.execute("UPDATE consignment_items SET damaged_quantity=1 WHERE id='ci'"))
print('D1-compatible SQLite migration and integrity checks passed')
