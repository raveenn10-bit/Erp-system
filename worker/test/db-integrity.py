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
db.execute('INSERT INTO product_variants VALUES(?,?,?,?,?,?,?,?,?)',('v','p','50g','pack',50,15000,10000,7000,10))
db.execute('INSERT INTO stock_balances VALUES(?,?,?)',('main','v',5))
db.execute('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('c','Shop','Owner','','','','','wholesale',100000,30,1,now))
db.commit()
def rejects(fn):
    try:fn();raise AssertionError('Expected constraint rejection')
    except sqlite3.IntegrityError:db.rollback()
rejects(lambda:db.execute('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)',('m','v','main',None,6,'sale','invoice',now)))
rejects(lambda:db.execute('UPDATE stock_balances SET quantity=-1'))
rejects(lambda:db.execute('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('bad','SD-1','c','admin','main',100001,0,'posted','2026-12-22','k1',now,None)))
db.execute('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('inv','SD-2','c','admin','main',10000,4000,'posted','2026-12-22','k2',now,None))
db.execute('INSERT INTO payments VALUES(?,?,?,?,?,?,?)',('pay','inv',4000,'cash','pay-key','admin',now))
db.commit()
rejects(lambda:db.execute('INSERT INTO payments VALUES(?,?,?,?,?,?,?)',('pay2','inv',1,'cash','pay-key-2','admin',now)))
rejects(lambda:db.execute('UPDATE invoices SET total_cents=1 WHERE id=?',('inv',)))
rejects(lambda:db.execute('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('dup','SD-3','c','admin','main',10000,0,'posted',None,'k2',now,None)))
print('D1-compatible SQLite migration and integrity checks passed')
