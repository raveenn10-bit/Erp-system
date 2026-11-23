import { Hono } from "hono";
import { z } from "zod";
import { audit, current, guard, now, uuid, type Env } from "./security";

const routes = new Hono<Env>();
const safe = z.string().trim().min(1).max(300);
const key = z.string().min(12).max(128);
const items = z.array(z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
})).min(1);
const localDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const reference = (prefix: string, id: string, date = localDate()) =>
  `${prefix}-${date.replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;
const parse = async <T extends z.ZodTypeAny>(c: any, schema: T): Promise<z.infer<T>> =>
  schema.parse(await c.req.json());

async function requireAdmin(c: any) {
  if (!current(c).admin) return c.json({ error: "Admin only" }, 403);
  return null;
}

async function routeForActor(db: D1Database, routeId: string, actorId: string, admin: number) {
  return db.prepare(
    `SELECT r.*,v.stock_warehouse_id,v.registration_number,v.status AS vehicle_status
     FROM daily_routes r JOIN vehicles v ON v.id=r.vehicle_id
     WHERE r.id=? AND (?=1 OR r.sales_rep_id=?)`,
  ).bind(routeId, admin, actorId).first<any>();
}

async function confirmTransfer(
  db: D1Database,
  transferId: string,
  actorId: string,
  movementReason = "stock_transfer",
) {
  const transfer = await db.prepare(
    "SELECT * FROM stock_transfers WHERE id=? AND status IN('Draft','Pending')",
  ).bind(transferId).first<any>();
  if (!transfer) throw new Error("Transfer is already confirmed, cancelled, or unavailable");
  const transferItems = (await db.prepare(
    "SELECT variant_id,quantity FROM stock_transfer_items WHERE transfer_id=? ORDER BY variant_id",
  ).bind(transferId).all<any>()).results;
  if (!transferItems.length) throw new Error("Transfer has no items");
  const stamp = now();
  const statements: D1PreparedStatement[] = [];
  for (const item of transferItems) {
    const movementId=uuid();
    statements.push(db.prepare(
      `INSERT INTO stock_movements(id,variant_id,from_warehouse,to_warehouse,quantity,reason,reference_id,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).bind(movementId, item.variant_id, transfer.source_warehouse_id, transfer.destination_warehouse_id,
      item.quantity, movementReason, transfer.id, stamp));
    statements.push(db.prepare("INSERT INTO stock_movement_metadata(movement_id,transaction_reference,actor_id,route_id,transfer_id) VALUES(?,?,?,?,?)")
      .bind(movementId,transfer.reference_number,actorId,transfer.route_id,transfer.id));
    statements.push(db.prepare(
      "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
    ).bind(item.quantity, transfer.source_warehouse_id, item.variant_id));
    statements.push(db.prepare(
      `INSERT INTO stock_balances(warehouse_id,variant_id,quantity)
       VALUES(?,?,?) ON CONFLICT(warehouse_id,variant_id)
       DO UPDATE SET quantity=quantity+excluded.quantity`,
    ).bind(transfer.destination_warehouse_id, item.variant_id, item.quantity));
  }
  statements.push(db.prepare(
    "UPDATE stock_transfers SET status='Confirmed',approved_by=?,confirmed_at=? WHERE id=? AND status IN('Draft','Pending')",
  ).bind(actorId, stamp, transfer.id));
  await db.batch(statements);
  return transfer;
}

routes.get("/distribution/summary", async (c) => {
  const denied = await guard(c, "distribution.view");
  if (denied && !current(c).admin) return denied;
  const p = current(c), db = c.env.DB, today = localDate();
  const scope = p.admin ? "1=1" : "w.rep_id=?";
  const args = p.admin ? [] : [p.id];
  const [warehouse, rep, vehicle, activeRoutes, loaded, sold, returned, variances] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(quantity),0) value FROM stock_balances b JOIN warehouse_metadata wm ON wm.warehouse_id=b.warehouse_id WHERE wm.location_type='warehouse'").first<any>(),
    db.prepare(`SELECT COALESCE(SUM(quantity),0) value FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN warehouse_metadata wm ON wm.warehouse_id=w.id WHERE wm.location_type='sales_rep' AND ${scope}`).bind(...args).first<any>(),
    db.prepare(`SELECT COALESCE(SUM(quantity),0) value FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN warehouse_metadata wm ON wm.warehouse_id=w.id WHERE wm.location_type='vehicle' AND ${scope}`).bind(...args).first<any>(),
    db.prepare("SELECT COUNT(*) value FROM daily_routes WHERE route_date=? AND status IN('Ready','In Progress') AND (?=1 OR sales_rep_id=?)").bind(today,p.admin,p.id).first<any>(),
    db.prepare("SELECT COALESCE(SUM(li.quantity),0) value FROM vehicle_loading_items li JOIN vehicle_loadings l ON l.id=li.loading_id WHERE l.loading_date=? AND l.status='Confirmed' AND (?=1 OR l.sales_rep_id=?)").bind(today,p.admin,p.id).first<any>(),
    db.prepare("SELECT COALESCE(SUM(ii.quantity),0) value FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id JOIN distribution_entity_routes er ON er.entity_type='invoice' AND er.entity_id=i.id JOIN daily_routes r ON r.id=er.route_id WHERE r.route_date=? AND i.status='posted' AND (?=1 OR r.sales_rep_id=?)").bind(today,p.admin,p.id).first<any>(),
    db.prepare("SELECT COALESCE(SUM(m.quantity),0) value FROM stock_movements m JOIN stock_movement_metadata mm ON mm.movement_id=m.id JOIN daily_routes r ON r.id=mm.route_id WHERE r.route_date=? AND m.reason IN('route_return','customer_return') AND (?=1 OR r.sales_rep_id=?)").bind(today,p.admin,p.id).first<any>(),
    db.prepare("SELECT COALESCE(SUM(ABS(ri.variance_quantity)),0) value FROM route_reconciliation_items ri JOIN route_reconciliations rr ON rr.id=ri.reconciliation_id JOIN daily_routes r ON r.id=rr.route_id WHERE r.route_date=? AND (?=1 OR r.sales_rep_id=?)").bind(today,p.admin,p.id).first<any>(),
  ]);
  return c.json({
    mainWarehouseStock: warehouse?.value || 0, totalSalesRepStock: rep?.value || 0,
    totalVehicleStock: vehicle?.value || 0, vehiclesOnRoute: activeRoutes?.value || 0,
    todayLoadedQuantity: loaded?.value || 0, todaySoldQuantity: sold?.value || 0,
    todayReturnedQuantity: returned?.value || 0, stockVariances: variances?.value || 0,
  });
});

routes.get("/distribution/locations", async (c) => {
  const denied = await guard(c, "stock.view");
  if (denied) return denied;
  const p = current(c);
  const rows = (await c.env.DB.prepare(
    `SELECT w.id,w.name,wm.location_type,w.rep_id,wm.active,
      u.name AS rep_name,v.id AS vehicle_id,v.registration_number,v.status AS vehicle_status,
      COALESCE(SUM(b.quantity),0) AS total_quantity
     FROM warehouses w JOIN warehouse_metadata wm ON wm.warehouse_id=w.id LEFT JOIN users u ON u.id=w.rep_id
     LEFT JOIN vehicles v ON v.stock_warehouse_id=w.id
     LEFT JOIN stock_balances b ON b.warehouse_id=w.id
     WHERE (?=1 OR w.rep_id=?) GROUP BY w.id ORDER BY wm.location_type,w.name`,
  ).bind(p.admin,p.id).all()).results;
  return c.json(rows);
});

routes.get("/vehicles", async (c) => {
  const p = current(c);
  if (!p.admin) {
    const denied = await guard(c, "distribution.view");
    if (denied) return denied;
  }
  return c.json((await c.env.DB.prepare(
    `SELECT v.*,d.name AS driver_name,r.name AS sales_rep_name,
      COALESCE(SUM(b.quantity),0) AS stock_quantity
     FROM vehicles v LEFT JOIN users d ON d.id=v.driver_id
     LEFT JOIN users r ON r.id=v.sales_rep_id
     LEFT JOIN stock_balances b ON b.warehouse_id=v.stock_warehouse_id
     WHERE (?=1 OR v.sales_rep_id=?) GROUP BY v.id ORDER BY v.registration_number`,
  ).bind(p.admin,p.id).all()).results);
});

routes.post("/vehicles", async (c) => {
  const denied = await requireAdmin(c); if (denied) return denied;
  const d = await parse(c, z.object({
    registrationNumber: safe, vehicleType: z.enum(["Van","Lorry","Three-Wheeler","Car","Motorcycle","Other"]),
    name: z.string().trim().max(120).default(""), driverId: z.string().nullable().optional(),
    salesRepId: z.string().nullable().optional(), status: z.enum(["Active","Inactive","Maintenance"]).default("Active"),
    notes: z.string().max(1000).default(""),
  }));
  const db=c.env.DB,p=current(c),id=uuid(),warehouseId=`vehicle-${id}`,stamp=now();
  try {
    await db.batch([
      db.prepare("INSERT INTO warehouses(id,name,rep_id) VALUES(?,?,?)")
        .bind(warehouseId, `${d.registrationNumber} vehicle stock`, d.salesRepId||null),
      db.prepare("INSERT INTO warehouse_metadata(warehouse_id,location_type,active) VALUES(?,'vehicle',?)")
        .bind(warehouseId,d.status==="Active"?1:0),
      db.prepare(`INSERT INTO vehicles(id,registration_number,vehicle_type,name,driver_id,sales_rep_id,status,notes,stock_warehouse_id,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,d.registrationNumber,d.vehicleType,d.name,d.driverId||null,d.salesRepId||null,d.status,d.notes,warehouseId,p.id,stamp,stamp),
    ]);
  } catch (e) { return c.json({error:(e as Error).message},409); }
  await audit(db,p.id,"vehicle.created",id,JSON.stringify({registrationNumber:d.registrationNumber}));
  return c.json({id,stockWarehouseId:warehouseId},201);
});

routes.patch("/vehicles/:id", async (c) => {
  const denied = await requireAdmin(c); if (denied) return denied;
  const d=await parse(c,z.object({driverId:z.string().nullable().optional(),salesRepId:z.string().nullable().optional(),status:z.enum(["Active","Inactive","Maintenance"]).optional(),name:z.string().max(120).optional(),notes:z.string().max(1000).optional()}));
  const db=c.env.DB,id=c.req.param("id"),vehicle=await db.prepare("SELECT * FROM vehicles WHERE id=?").bind(id).first<any>();
  if(!vehicle)return c.json({error:"Vehicle not found"},404);
  const rep=d.salesRepId===undefined?vehicle.sales_rep_id:d.salesRepId;
  const status=d.status||vehicle.status;
  await db.batch([
    db.prepare("UPDATE vehicles SET driver_id=?,sales_rep_id=?,status=?,name=?,notes=?,updated_at=? WHERE id=?")
      .bind(d.driverId===undefined?vehicle.driver_id:d.driverId,rep,status,d.name??vehicle.name,d.notes??vehicle.notes,now(),id),
    db.prepare("UPDATE warehouses SET rep_id=? WHERE id=?").bind(rep,vehicle.stock_warehouse_id),
    db.prepare("UPDATE warehouse_metadata SET active=? WHERE warehouse_id=?").bind(status==="Active"?1:0,vehicle.stock_warehouse_id),
  ]);
  await audit(db,current(c).id,"vehicle.updated",id);
  return c.json({ok:true});
});

routes.get("/stock-transfers", async (c) => {
  const p=current(c); if(!p.admin){const denied=await guard(c,"distribution.view");if(denied)return denied;}
  const q=c.req.query("status")||"";
  return c.json((await c.env.DB.prepare(
    `SELECT t.*,s.name AS source_name,d.name AS destination_name,u.name AS requested_by_name,a.name AS approved_by_name,
      COALESCE(SUM(i.quantity),0) AS total_quantity,COUNT(i.id) AS item_count
     FROM stock_transfers t JOIN warehouses s ON s.id=t.source_warehouse_id JOIN warehouses d ON d.id=t.destination_warehouse_id
     JOIN users u ON u.id=t.requested_by LEFT JOIN users a ON a.id=t.approved_by LEFT JOIN stock_transfer_items i ON i.transfer_id=t.id
     WHERE (?='' OR t.status=?) AND (?=1 OR s.rep_id=? OR d.rep_id=?) GROUP BY t.id ORDER BY t.created_at DESC LIMIT 300`,
  ).bind(q,q,p.admin,p.id,p.id).all()).results);
});

routes.post("/stock-transfers", async (c) => {
  const denied=await guard(c,"stock.allocate");if(denied)return denied;
  const d=await parse(c,z.object({sourceWarehouseId:z.string(),destinationWarehouseId:z.string(),routeId:z.string().nullable().optional(),items,notes:z.string().max(1000).default(""),idempotencyKey:key,confirm:z.boolean().default(false)}));
  if(d.sourceWarehouseId===d.destinationWarehouseId)return c.json({error:"Source and destination must differ"},400);
  if(new Set(d.items.map((x:any)=>x.variantId)).size!==d.items.length)return c.json({error:"Duplicate product variants"},400);
  const db=c.env.DB,p=current(c),existing=await db.prepare("SELECT id,reference_number,status FROM stock_transfers WHERE idempotency_key=?").bind(d.idempotencyKey).first();
  if(existing)return c.json(existing);
  const locations=(await db.prepare("SELECT w.id,wm.active FROM warehouses w JOIN warehouse_metadata wm ON wm.warehouse_id=w.id WHERE w.id IN(?,?)").bind(d.sourceWarehouseId,d.destinationWarehouseId).all()).results;
  if(locations.length!==2||locations.some((x:any)=>!x.active))return c.json({error:"Invalid or inactive stock location"},400);
  const id=uuid(),ref=reference("TRF",id),stamp=now();
  const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO stock_transfers(id,reference_number,source_warehouse_id,destination_warehouse_id,route_id,status,requested_by,approved_by,idempotency_key,notes,created_at,confirmed_at,cancelled_at) VALUES(?,?,?,?,?,'Draft',?,NULL,?,?,?,NULL,NULL)`).bind(id,ref,d.sourceWarehouseId,d.destinationWarehouseId,d.routeId||null,p.id,d.idempotencyKey,d.notes,stamp)];
  for(const item of d.items)statements.push(db.prepare("INSERT INTO stock_transfer_items(id,transfer_id,variant_id,quantity) VALUES(?,?,?,?)").bind(uuid(),id,item.variantId,item.quantity));
  try{await db.batch(statements);if(d.confirm)await confirmTransfer(db,id,p.id);}catch(e){return c.json({error:(e as Error).message},409);}
  await audit(db,p.id,d.confirm?"stock_transfer.confirmed":"stock_transfer.created",id,JSON.stringify({reference:ref}));
  return c.json({id,referenceNumber:ref,status:d.confirm?"Confirmed":"Draft"},201);
});

routes.post("/stock-transfers/:id/confirm", async (c) => {
  const denied=await requireAdmin(c);if(denied)return denied;
  const id=c.req.param("id");
  try{const transfer=await confirmTransfer(c.env.DB,id,current(c).id);await audit(c.env.DB,current(c).id,"stock_transfer.confirmed",id);return c.json({id,referenceNumber:transfer.reference_number,status:"Confirmed"});}
  catch(e){return c.json({error:(e as Error).message},409);}
});

routes.post("/stock-transfers/:id/cancel", async (c) => {
  const denied=await requireAdmin(c);if(denied)return denied;
  const id=c.req.param("id"),result=await c.env.DB.prepare("UPDATE stock_transfers SET status='Cancelled',cancelled_at=? WHERE id=? AND status IN('Draft','Pending')").bind(now(),id).run();
  if(!result.meta.changes)return c.json({error:"Only draft or pending transfers can be cancelled"},409);
  await audit(c.env.DB,current(c).id,"stock_transfer.cancelled",id);return c.json({ok:true});
});

routes.get("/daily-routes", async (c) => {
  const p=current(c);if(!p.admin){const denied=await guard(c,"distribution.view");if(denied)return denied;}
  const date=c.req.query("date")||"";
  return c.json((await c.env.DB.prepare(
    `SELECT r.*,v.registration_number,v.name AS vehicle_name,v.stock_warehouse_id,u.name AS sales_rep_name,d.name AS driver_name,
      COUNT(rc.customer_id) AS planned_shops
     FROM daily_routes r JOIN vehicles v ON v.id=r.vehicle_id JOIN users u ON u.id=r.sales_rep_id
     LEFT JOIN users d ON d.id=r.driver_id LEFT JOIN daily_route_customers rc ON rc.route_id=r.id
     WHERE (?='' OR r.route_date=?) AND (?=1 OR r.sales_rep_id=?) GROUP BY r.id ORDER BY r.route_date DESC,r.created_at DESC LIMIT 300`,
  ).bind(date,date,p.admin,p.id).all()).results);
});

routes.post("/daily-routes", async (c) => {
  const denied=await requireAdmin(c);if(denied)return denied;
  const d=await parse(c,z.object({routeName:safe,routeDate:z.string().date(),vehicleId:z.string(),driverId:z.string().nullable().optional(),salesRepId:z.string(),customerIds:z.array(z.string()).default([]),notes:z.string().max(1000).default("")}));
  if(new Set(d.customerIds).size!==d.customerIds.length)return c.json({error:"Duplicate shops in route"},400);
  const db=c.env.DB,p=current(c),vehicle=await db.prepare("SELECT * FROM vehicles WHERE id=? AND status='Active'").bind(d.vehicleId).first<any>();
  if(!vehicle)return c.json({error:"Active vehicle not found"},404);
  const id=uuid(),ref=reference("RTE",id,d.routeDate),stamp=now(),statements:D1PreparedStatement[]=[
    db.prepare(`INSERT INTO daily_routes(id,reference_number,route_name,route_date,vehicle_id,driver_id,sales_rep_id,status,start_time,end_time,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'Planned',NULL,NULL,?,?,?,?)`).bind(id,ref,d.routeName,d.routeDate,d.vehicleId,d.driverId||vehicle.driver_id||null,d.salesRepId,d.notes,p.id,stamp,stamp),
    db.prepare("UPDATE vehicles SET driver_id=COALESCE(?,driver_id),sales_rep_id=?,updated_at=? WHERE id=?").bind(d.driverId||null,d.salesRepId,stamp,d.vehicleId),
    db.prepare("UPDATE warehouses SET rep_id=? WHERE id=?").bind(d.salesRepId,vehicle.stock_warehouse_id),
  ];
  d.customerIds.forEach((customerId:string,index:number)=>statements.push(db.prepare("INSERT INTO daily_route_customers(route_id,customer_id,visit_order,status,notes) VALUES(?,?,?,'Planned','')").bind(id,customerId,index+1)));
  try{await db.batch(statements);}catch(e){return c.json({error:(e as Error).message},409);}
  await audit(db,p.id,"route.created",id,JSON.stringify({reference:ref}));return c.json({id,referenceNumber:ref},201);
});

routes.get("/daily-routes/:id", async (c) => {
  const p=current(c),db=c.env.DB,record=await routeForActor(db,c.req.param("id"),p.id,p.admin);
  if(!record)return c.json({error:"Route not found"},404);
  const [shops,stock,loadings,reconciliation]=await Promise.all([
    db.prepare("SELECT rc.*,c.shop_name,c.owner_name,c.phone,c.whatsapp,c.address FROM daily_route_customers rc JOIN customers c ON c.id=rc.customer_id WHERE rc.route_id=? ORDER BY rc.visit_order").bind(record.id).all(),
    db.prepare("SELECT b.variant_id,b.quantity,p.name,v.label,v.unit FROM stock_balances b JOIN product_variants v ON v.id=b.variant_id JOIN products p ON p.id=v.product_id WHERE b.warehouse_id=? ORDER BY p.name,v.label").bind(record.stock_warehouse_id).all(),
    db.prepare("SELECT l.*,SUM(li.quantity) total_quantity FROM vehicle_loadings l JOIN vehicle_loading_items li ON li.loading_id=l.id WHERE l.route_id=? GROUP BY l.id ORDER BY l.created_at").bind(record.id).all(),
    db.prepare("SELECT * FROM route_reconciliations WHERE route_id=?").bind(record.id).first(),
  ]);
  return c.json({record,shops:shops.results,stock:stock.results,loadings:loadings.results,reconciliation});
});

routes.patch("/daily-routes/:id/status", async (c) => {
  const d=await parse(c,z.object({status:z.enum(["Planned","Loading","Ready","In Progress","Completed"])})),p=current(c),db=c.env.DB,id=c.req.param("id"),record=await routeForActor(db,id,p.id,p.admin);
  if(!record)return c.json({error:"Route not found"},404);
  const transitions:Record<string,string[]>={Planned:["Loading"],Loading:["Ready"],Ready:["In Progress"],"In Progress":["Completed"]};
  if(!transitions[record.status]?.includes(d.status))return c.json({error:`Invalid route transition: ${record.status} → ${d.status}`},409);
  if(!p.admin&&!(["Ready","In Progress"].includes(record.status)))return c.json({error:"Admin approval required"},403);
  const start=d.status==="In Progress"?now():record.start_time,end=d.status==="Completed"?now():record.end_time;
  await db.prepare("UPDATE daily_routes SET status=?,start_time=?,end_time=?,updated_at=? WHERE id=? AND status=?").bind(d.status,start,end,now(),id,record.status).run();
  await audit(db,p.id,"route.status_changed",id,JSON.stringify({from:record.status,to:d.status}));return c.json({ok:true,status:d.status});
});

routes.post("/vehicle-loadings", async (c) => {
  const denied=await requireAdmin(c);if(denied)return denied;
  const d=await parse(c,z.object({loadingDate:z.string().date(),vehicleId:z.string(),routeId:z.string(),salesRepId:z.string(),sourceWarehouseId:z.string(),items,notes:z.string().max(1000).default(""),idempotencyKey:key,confirm:z.boolean().default(false)}));
  if(new Set(d.items.map((x:any)=>x.variantId)).size!==d.items.length)return c.json({error:"Duplicate product variants"},400);
  const db=c.env.DB,p=current(c),existing=await db.prepare("SELECT id,reference_number,status FROM vehicle_loadings WHERE idempotency_key=?").bind(d.idempotencyKey).first();if(existing)return c.json(existing);
  const route=await db.prepare("SELECT r.*,v.stock_warehouse_id FROM daily_routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=? AND r.vehicle_id=? AND r.sales_rep_id=? AND r.route_date=? AND r.status IN('Planned','Loading')").bind(d.routeId,d.vehicleId,d.salesRepId,d.loadingDate).first<any>();
  if(!route)return c.json({error:"Route, vehicle, rep, and loading date do not match"},409);
  const loadingId=uuid(),loadingRef=reference("LOD",loadingId,d.loadingDate),transferId=uuid(),transferRef=reference("TRF",transferId,d.loadingDate),stamp=now();
  const statements:D1PreparedStatement[]=[
    db.prepare(`INSERT INTO stock_transfers(id,reference_number,source_warehouse_id,destination_warehouse_id,route_id,status,requested_by,approved_by,idempotency_key,notes,created_at,confirmed_at,cancelled_at) VALUES(?,?,?,?,?,'Draft',?,NULL,?,?,?,NULL,NULL)`).bind(transferId,transferRef,d.sourceWarehouseId,route.stock_warehouse_id,d.routeId,p.id,`${d.idempotencyKey}:transfer`,d.notes,stamp),
    db.prepare(`INSERT INTO vehicle_loadings(id,reference_number,loading_date,vehicle_id,route_id,sales_rep_id,source_warehouse_id,transfer_id,status,idempotency_key,notes,created_by,created_at,confirmed_at,cancelled_at) VALUES(?,?,?,?,?,?,?,?, 'Draft',?,?,?,?,NULL,NULL)`).bind(loadingId,loadingRef,d.loadingDate,d.vehicleId,d.routeId,d.salesRepId,d.sourceWarehouseId,transferId,d.idempotencyKey,d.notes,p.id,stamp),
    db.prepare("UPDATE daily_routes SET status='Loading',updated_at=? WHERE id=? AND status='Planned'").bind(stamp,d.routeId),
  ];
  for(const item of d.items){statements.push(db.prepare("INSERT INTO stock_transfer_items(id,transfer_id,variant_id,quantity) VALUES(?,?,?,?)").bind(uuid(),transferId,item.variantId,item.quantity));statements.push(db.prepare("INSERT INTO vehicle_loading_items(id,loading_id,variant_id,quantity) VALUES(?,?,?,?)").bind(uuid(),loadingId,item.variantId,item.quantity));}
  try{await db.batch(statements);if(d.confirm){await confirmTransfer(db,transferId,p.id,"vehicle_loading");await db.batch([db.prepare("UPDATE vehicle_loadings SET status='Confirmed',confirmed_at=? WHERE id=? AND status='Draft'").bind(now(),loadingId),db.prepare("UPDATE daily_routes SET status='Ready',updated_at=? WHERE id=? AND status='Loading'").bind(now(),d.routeId)]);}}catch(e){return c.json({error:(e as Error).message},409);}
  await audit(db,p.id,d.confirm?"vehicle_loading.confirmed":"vehicle_loading.created",loadingId);return c.json({id:loadingId,referenceNumber:loadingRef,status:d.confirm?"Confirmed":"Draft"},201);
});

routes.post("/vehicle-loadings/:id/confirm", async (c) => {
  const denied=await requireAdmin(c);if(denied)return denied;const db=c.env.DB,p=current(c),id=c.req.param("id"),loading=await db.prepare("SELECT * FROM vehicle_loadings WHERE id=? AND status='Draft'").bind(id).first<any>();
  if(!loading)return c.json({error:"Loading is already confirmed, cancelled, or unavailable"},409);
  try{await confirmTransfer(db,loading.transfer_id,p.id,"vehicle_loading");await db.batch([db.prepare("UPDATE vehicle_loadings SET status='Confirmed',confirmed_at=? WHERE id=? AND status='Draft'").bind(now(),id),db.prepare("UPDATE daily_routes SET status='Ready',updated_at=? WHERE id=? AND status='Loading'").bind(now(),loading.route_id)]);}catch(e){return c.json({error:(e as Error).message},409);}
  await audit(db,p.id,"vehicle_loading.confirmed",id);return c.json({ok:true});
});

routes.post("/daily-routes/:id/reconciliation", async (c) => {
  const denied=await guard(c,"reconciliations.submit");if(denied&&!current(c).admin)return denied;
  const d=await parse(c,z.object({counts:z.array(z.object({variantId:z.string(),countedQuantity:z.number().int().nonnegative()})).min(1),varianceReason:z.string().max(1000).default(""),idempotencyKey:key})),db=c.env.DB,p=current(c),route=await routeForActor(db,c.req.param("id"),p.id,p.admin);
  if(!route||route.status!=="Completed")return c.json({error:"Completed assigned route required"},409);
  if(new Set(d.counts.map((x:any)=>x.variantId)).size!==d.counts.length)return c.json({error:"Duplicate product variants"},400);
  const existing=await db.prepare("SELECT id,status FROM route_reconciliations WHERE route_id=? OR idempotency_key=?").bind(route.id,d.idempotencyKey).first();if(existing)return c.json(existing);
  const metrics=(await db.prepare(
    `SELECT b.variant_id,b.quantity AS expected_quantity,
      COALESCE((SELECT SUM(li.quantity) FROM vehicle_loading_items li JOIN vehicle_loadings l ON l.id=li.loading_id WHERE l.route_id=? AND l.status='Confirmed' AND li.variant_id=b.variant_id),0) loaded_quantity,
      COALESCE((SELECT SUM(ii.quantity) FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id JOIN distribution_entity_routes er ON er.entity_type='invoice' AND er.entity_id=i.id WHERE er.route_id=? AND i.status='posted' AND ii.variant_id=b.variant_id),0) sold_quantity,
      COALESCE((SELECT SUM(fi.quantity) FROM free_issue_items fi JOIN free_issues f ON f.id=fi.free_issue_id JOIN distribution_entity_routes er ON er.entity_type='free_issue' AND er.entity_id=f.id WHERE er.route_id=? AND f.status='confirmed' AND fi.variant_id=b.variant_id),0) free_issue_quantity,
      COALESCE((SELECT SUM(ci.issued_quantity) FROM consignment_items ci JOIN consignments co ON co.id=ci.consignment_id JOIN distribution_entity_routes er ON er.entity_type='consignment' AND er.entity_id=co.id WHERE er.route_id=? AND co.status<>'cancelled' AND ci.variant_id=b.variant_id),0) consignment_quantity
     FROM stock_balances b WHERE b.warehouse_id=?`,
  ).bind(route.id,route.id,route.id,route.id,route.stock_warehouse_id).all<any>()).results;
  const map=new Map(metrics.map((x:any)=>[x.variant_id,x]));
  const reconciliationId=uuid(),ref=reference("REC",reconciliationId,route.route_date),stamp=now(),statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO route_reconciliations(id,route_id,reference_number,status,submitted_by,approved_by,variance_reason,approval_notes,idempotency_key,submitted_at,approved_at) VALUES(?,?,?,'Submitted',?,NULL,?,'',?,?,NULL)`).bind(reconciliationId,route.id,ref,p.id,d.varianceReason,d.idempotencyKey,stamp)];
  let hasVariance=false;
  for(const count of d.counts){const m:any=map.get(count.variantId);if(!m)return c.json({error:"Count includes product not held by vehicle"},400);const variance=count.countedQuantity-m.expected_quantity;hasVariance ||= variance!==0;statements.push(db.prepare(`INSERT INTO route_reconciliation_items(id,reconciliation_id,variant_id,opening_quantity,loaded_quantity,sold_quantity,free_issue_quantity,consignment_quantity,customer_return_quantity,damaged_quantity,transfer_out_quantity,expected_quantity,counted_quantity,variance_quantity) VALUES(?,?,?,0,?,?,?,?,0,0,0,?,?,?)`).bind(uuid(),reconciliationId,count.variantId,m.loaded_quantity,m.sold_quantity,m.free_issue_quantity,m.consignment_quantity,m.expected_quantity,count.countedQuantity,variance));}
  if(hasVariance&&!d.varianceReason.trim())return c.json({error:"A reason is required for stock variance"},400);
  try{await db.batch(statements);}catch(e){return c.json({error:(e as Error).message},409);}
  await audit(db,p.id,"route.reconciliation_submitted",reconciliationId,JSON.stringify({hasVariance}));return c.json({id:reconciliationId,referenceNumber:ref,hasVariance},201);
});

routes.post("/route-reconciliations/:id/approve", async (c) => {
  const denied=await requireAdmin(c);if(denied)return denied;const d=await parse(c,z.object({notes:z.string().max(1000).default("")})),db=c.env.DB,p=current(c),id=c.req.param("id"),record=await db.prepare("SELECT * FROM route_reconciliations WHERE id=? AND status='Submitted'").bind(id).first<any>();
  if(!record)return c.json({error:"Submitted reconciliation not found"},404);
  await db.batch([db.prepare("UPDATE route_reconciliations SET status='Approved',approved_by=?,approval_notes=?,approved_at=? WHERE id=? AND status='Submitted'").bind(p.id,d.notes,now(),id),db.prepare("UPDATE daily_routes SET status='Reconciled',updated_at=? WHERE id=? AND status='Completed'").bind(now(),record.route_id)]);
  await audit(db,p.id,"route.reconciliation_approved",id);return c.json({ok:true});
});

routes.get("/distribution/reports/:kind", async (c) => {
  const denied=await guard(c,"reports.view");if(denied)return denied;const kind=c.req.param("kind"),p=current(c),db=c.env.DB,from=c.req.query("from")||"2000-01-01",to=c.req.query("to")||"2100-01-01";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return c.json({error:"Invalid date range"},400);
  const reports:Record<string,string>={
    "warehouse-balances":`SELECT w.name,wm.location_type,p.name AS product,v.label,b.quantity,COALESCE(s.reserved_quantity,0) reserved_quantity,COALESCE(s.allocated_quantity,0) allocated_quantity,COALESCE(s.damaged_quantity,0) damaged_quantity FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN warehouse_metadata wm ON wm.warehouse_id=w.id JOIN product_variants v ON v.id=b.variant_id JOIN products p ON p.id=v.product_id LEFT JOIN stock_balance_status s ON s.warehouse_id=b.warehouse_id AND s.variant_id=b.variant_id WHERE (?=1 OR w.rep_id=?) ORDER BY w.name,p.name`,
    "route-sales":`SELECT r.route_date,r.route_name,v.registration_number,u.name AS sales_rep,COUNT(DISTINCT i.id) invoices,COALESCE(SUM(i.total_cents),0) revenue_cents FROM daily_routes r JOIN vehicles v ON v.id=r.vehicle_id JOIN users u ON u.id=r.sales_rep_id LEFT JOIN distribution_entity_routes er ON er.route_id=r.id AND er.entity_type='invoice' LEFT JOIN invoices i ON i.id=er.entity_id AND i.status='posted' WHERE r.route_date BETWEEN ? AND ? AND (?=1 OR r.sales_rep_id=?) GROUP BY r.id ORDER BY r.route_date DESC`,
    "reconciliation-differences":`SELECT r.route_date,r.route_name,v.registration_number,rr.reference_number,rr.status,p.name AS product,pv.label,ri.expected_quantity,ri.counted_quantity,ri.variance_quantity,rr.variance_reason FROM route_reconciliation_items ri JOIN route_reconciliations rr ON rr.id=ri.reconciliation_id JOIN daily_routes r ON r.id=rr.route_id JOIN vehicles v ON v.id=r.vehicle_id JOIN product_variants pv ON pv.id=ri.variant_id JOIN products p ON p.id=pv.product_id WHERE r.route_date BETWEEN ? AND ? AND ri.variance_quantity<>0 AND (?=1 OR r.sales_rep_id=?) ORDER BY r.route_date DESC`,
  };
  const sql=reports[kind];if(!sql)return c.json({error:"Unknown distribution report"},404);
  const args=kind==="warehouse-balances"?[p.admin,p.id]:[from,to,p.admin,p.id];
  return c.json((await db.prepare(sql).bind(...args).all()).results);
});

export default routes;

