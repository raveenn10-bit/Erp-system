import {describe,expect,it} from "vitest";
import {DatabaseSync} from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

function database(){
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const migrations=path.resolve(__dirname,"../migrations");
  for(const file of fs.readdirSync(migrations).filter(x=>x.endsWith(".sql")).sort())db.exec(fs.readFileSync(path.join(migrations,file),"utf8"));
  const stamp="2026-11-23T08:00:00.000Z";
  db.prepare("INSERT INTO users(id,name,email,password_hash,role_id,active,created_at,username) VALUES(?,?,?,?,?,?,?,?)").run("admin","Admin","admin@test.lk","x","admin",1,stamp,"admin");
  db.prepare("INSERT INTO users(id,name,email,password_hash,role_id,active,created_at,username) VALUES(?,?,?,?,?,?,?,?)").run("rep","Rep","rep@test.lk","x","sales_rep",1,stamp,"rep");
  db.prepare("INSERT INTO categories(id,name) VALUES('tea','Tea')").run();
  db.prepare("INSERT INTO products(id,category_id,name,sku,barcode,active,created_at) VALUES('p','tea','Tea','TEA',NULL,1,?)").run(stamp);
  db.prepare("INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES('v','p','100g','pack',100,20000,16000,12000,10,18000)").run();
  db.prepare("INSERT INTO stock_balances(warehouse_id,variant_id,quantity) VALUES('main','v',100)").run();
  db.prepare("INSERT INTO warehouses(id,name,rep_id) VALUES('vehicle-w','Vehicle stock','rep')").run();
  db.prepare("INSERT INTO warehouse_metadata(warehouse_id,location_type,active) VALUES('vehicle-w','vehicle',1)").run();
  return {db,stamp};
}

describe("Distribution logistics inventory invariants",()=>{
  it("conserves total physical stock for an internal vehicle loading",()=>{
    const {db,stamp}=database();
    db.prepare("INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES('m','v','main','vehicle-w',25,'vehicle_loading','t',?)").run(stamp);
    db.prepare("UPDATE stock_balances SET quantity=quantity-25 WHERE warehouse_id='main' AND variant_id='v'").run();
    db.prepare("INSERT INTO stock_balances(warehouse_id,variant_id,quantity) VALUES('vehicle-w','v',25)").run();
    const total=db.prepare("SELECT SUM(quantity) total FROM stock_balances WHERE variant_id='v'").get() as any;
    expect(total.total).toBe(100);
    expect((db.prepare("SELECT quantity FROM stock_balances WHERE warehouse_id='main' AND variant_id='v'").get() as any).quantity).toBe(75);
  });

  it("prevents negative stock and duplicate movement deductions",()=>{
    const {db,stamp}=database();
    expect(()=>db.prepare("INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES('too-much','v','main','vehicle-w',101,'vehicle_loading','t-over',?)").run(stamp)).toThrow(/insufficient stock/);
    db.prepare("INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES('first','v','main','vehicle-w',5,'vehicle_loading','t-once',?)").run(stamp);
    expect(()=>db.prepare("INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at) VALUES('second','v','main','vehicle-w',5,'vehicle_loading','t-once',?)").run(stamp)).toThrow();
  });

  it("keeps stock transfers outside sales revenue and links route custody separately",()=>{
    const {db,stamp}=database();
    db.prepare("INSERT INTO vehicles(id,registration_number,vehicle_type,name,driver_id,sales_rep_id,status,notes,stock_warehouse_id,created_by,created_at,updated_at) VALUES('veh','TEST-ONLY','Van','',NULL,'rep','Active','','vehicle-w','admin',?,?)").run(stamp,stamp);
    db.prepare("INSERT INTO daily_routes(id,reference_number,route_name,route_date,vehicle_id,driver_id,sales_rep_id,status,start_time,end_time,notes,created_by,created_at,updated_at) VALUES('route','RTE-TEST','Test route','2026-11-23','veh',NULL,'rep','In Progress',?,NULL,'','admin',?,?)").run(stamp,stamp,stamp);
    db.prepare("INSERT INTO customers(id,shop_name,owner_name,phone,whatsapp,address,location,type,credit_limit_cents,credit_days,active,created_at) VALUES('c','Shop','Owner','','','','Galle','retail',0,0,1,?)").run(stamp);
    db.prepare("INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id,customer_whatsapp,share_token) VALUES('inv','INV-TEST','c','rep','vehicle-w',18000,18000,'posted',NULL,'invoice-key-123',?,NULL,18000,0,0,'cash','','','','sale',NULL,'','token-test')").run(stamp);
    db.prepare("INSERT INTO distribution_entity_routes(entity_type,entity_id,route_id) VALUES('invoice','inv','route')").run();
    db.prepare("INSERT INTO stock_transfers(id,reference_number,source_warehouse_id,destination_warehouse_id,route_id,status,requested_by,approved_by,idempotency_key,notes,created_at,confirmed_at,cancelled_at) VALUES('tr','TRF-TEST','main','vehicle-w','route','Confirmed','admin','admin','transfer-key-123','',?,?,NULL)").run(stamp,stamp);
    const revenue=(db.prepare("SELECT SUM(total_cents) amount FROM invoices WHERE status='posted'").get() as any).amount;
    const transferRevenue=(db.prepare("SELECT COUNT(*) count FROM invoices WHERE source_type='transfer'").get() as any).count;
    expect(revenue).toBe(18000);
    expect(transferRevenue).toBe(0);
    expect((db.prepare("SELECT route_id FROM distribution_entity_routes WHERE entity_id='inv'").get() as any).route_id).toBe("route");
  });
});

