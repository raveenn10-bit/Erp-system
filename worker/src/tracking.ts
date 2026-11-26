// Live GPS sales rep tracking. Reps report their own location while on duty;
// only admins can see locations. All ids are generated on the device, so every
// write can be replayed after being offline without creating duplicates.
import { Hono } from "hono";
import { z } from "zod";
import { current, now, type Env, type Principal } from "./security";
import { colomboDayRange, colomboToday, haversine, sessionsDistance, shouldStore, type GeoPoint } from "./geo";

const routes = new Hono<Env>();
const id = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const iso = z.string().datetime({ offset: true });
const source = z.enum(["web", "android"]);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const sessionRef = z.object({ id, startedAt: iso, source });

/** Online on the live map if a heartbeat arrived this recently. */
const ONLINE_MS = 2 * 60 * 1000;
/** Points from the far past/future are rejected (bad phone clock or corrupted queue). */
const MAX_AGE_MS = 14 * 24 * 3600 * 1000,
  MAX_FUTURE_MS = 10 * 60 * 1000;

async function body<T extends z.ZodTypeAny>(c: any, schema: T): Promise<z.infer<T> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}
const toIso = (s: string) => new Date(s).toISOString();
function timeOk(s: string) {
  const t = Date.parse(s),
    n = Date.now();
  return t > n - MAX_AGE_MS && t < n + MAX_FUTURE_MS;
}

/**
 * Statements that create the duty session if it doesn't exist yet. Starting a new
 * session closes any other open one of the same rep (a lost "End duty").
 */
async function ensureSession(db: D1Database, p: Principal, s: z.infer<typeof sessionRef>, extra?: { lat?: number; lng?: number }) {
  const row = await db.prepare("SELECT user_id FROM rep_duty_sessions WHERE id=?").bind(s.id).first<{ user_id: string }>();
  if (row && row.user_id !== p.id) throw new Error("Duty session belongs to another user");
  if (row) return [];
  const started = toIso(s.startedAt);
  return [
    db
      .prepare("UPDATE rep_duty_sessions SET ended_at=CASE WHEN started_at>? THEN started_at ELSE ? END,end_reason='superseded' WHERE user_id=? AND ended_at IS NULL AND id<>?")
      .bind(started, started, p.id, s.id),
    db
      .prepare("INSERT OR IGNORE INTO rep_duty_sessions(id,user_id,started_at,ended_at,end_reason,source,start_lat,start_lng,end_lat,end_lng,created_at) VALUES(?,?,?,NULL,NULL,?,?,?,NULL,NULL,?)")
      .bind(s.id, p.id, started, s.source, extra?.lat ?? null, extra?.lng ?? null, now()),
  ];
}

/* ------------------------------------------------------------- rep side */

routes.post("/tracking/duty", async (c) => {
  const p = current(c),
    db = c.env.DB;
  const d = await body(
    c,
    sessionRef.extend({
      endedAt: iso.optional(),
      endReason: z.enum(["user", "auto", "logout"]).optional(),
      lat: lat.optional(),
      lng: lng.optional(),
    }),
  );
  if (!d) return c.json({ error: "Invalid duty details" }, 400);
  if (!timeOk(d.startedAt) || (d.endedAt && !timeOk(d.endedAt))) return c.json({ error: "Phone date/time looks wrong. Fix the clock and try again." }, 400);
  try {
    const statements = await ensureSession(db, p, d, d.endedAt ? undefined : { lat: d.lat, lng: d.lng });
    if (d.endedAt) {
      const ended = toIso(d.endedAt);
      statements.push(
        db
          .prepare("UPDATE rep_duty_sessions SET ended_at=CASE WHEN started_at>? THEN started_at ELSE ? END,end_reason=?,end_lat=?,end_lng=? WHERE id=? AND user_id=? AND ended_at IS NULL")
          .bind(ended, ended, d.endReason || "user", d.lat ?? null, d.lng ?? null, d.id, p.id),
        db.prepare("UPDATE rep_presence SET session_id=NULL WHERE user_id=? AND session_id=?").bind(p.id, d.id),
      );
    }
    if (statements.length) await db.batch(statements);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});

routes.get("/tracking/duty", async (c) => {
  const p = current(c);
  const session = await c.env.DB.prepare("SELECT id,started_at,source FROM rep_duty_sessions WHERE user_id=? AND ended_at IS NULL").bind(p.id).first();
  return c.json({ session: session || null });
});

const pointSchema = z.object({
  id,
  recordedAt: iso,
  lat,
  lng,
  accuracy: z.number().nonnegative().max(100000).nullable().optional(),
  speed: z.number().min(0).max(1000).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  battery: z.number().int().min(0).max(100).nullable().optional(),
});

routes.post("/tracking/locations", async (c) => {
  const p = current(c),
    db = c.env.DB;
  const d = await body(
    c,
    z.object({
      session: sessionRef,
      points: z.array(pointSchema).max(500).default([]),
      heartbeat: z.object({ battery: z.number().int().min(0).max(100).nullable().optional() }).optional(),
    }),
  );
  if (!d) return c.json({ error: "Invalid location data" }, 400);
  let statements: D1PreparedStatement[];
  try {
    statements = await ensureSession(db, p, d.session);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  const received = now();
  const points = d.points
    .filter((x) => timeOk(x.recordedAt))
    .map((x) => ({ ...x, recordedAt: toIso(x.recordedAt) }))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  // Last stored point of this session, to thin out stationary points.
  let last: GeoPoint | null = null;
  if (points.length) {
    const r = await db
      .prepare("SELECT lat,lng,recorded_at AS t,accuracy_m AS acc FROM rep_locations WHERE session_id=? AND user_id=? ORDER BY recorded_at DESC LIMIT 1")
      .bind(d.session.id, p.id)
      .first<GeoPoint>();
    last = r || null;
  }
  let stored = 0;
  for (const x of points) {
    const gp: GeoPoint = { lat: x.lat, lng: x.lng, t: x.recordedAt, acc: x.accuracy ?? null };
    if (!shouldStore(last, gp)) continue;
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO rep_locations(id,user_id,session_id,recorded_at,lat,lng,accuracy_m,speed_mps,heading,battery,source,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(x.id, p.id, d.session.id, x.recordedAt, x.lat, x.lng, x.accuracy ?? null, x.speed ?? null, x.heading ?? null, x.battery ?? null, d.session.source, received),
    );
    if (!last || x.recordedAt >= last.t) last = gp;
    stored++;
  }
  // Presence: newest fix (if any) + heartbeat time, only while this session is open.
  const newest = points[points.length - 1];
  const open = await db.prepare("SELECT ended_at FROM rep_duty_sessions WHERE id=?").bind(d.session.id).first<{ ended_at: string | null }>();
  if (!open || open.ended_at === null) {
    const battery = newest?.battery ?? d.heartbeat?.battery ?? null;
    statements.push(
      db
        .prepare(
          `INSERT INTO rep_presence(user_id,session_id,lat,lng,accuracy_m,battery,source,recorded_at,received_at) VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,received_at=excluded.received_at,source=excluded.source,
             battery=COALESCE(excluded.battery,rep_presence.battery),
             lat=CASE WHEN excluded.recorded_at IS NOT NULL AND (rep_presence.recorded_at IS NULL OR excluded.recorded_at>=rep_presence.recorded_at) THEN excluded.lat ELSE rep_presence.lat END,
             lng=CASE WHEN excluded.recorded_at IS NOT NULL AND (rep_presence.recorded_at IS NULL OR excluded.recorded_at>=rep_presence.recorded_at) THEN excluded.lng ELSE rep_presence.lng END,
             accuracy_m=CASE WHEN excluded.recorded_at IS NOT NULL AND (rep_presence.recorded_at IS NULL OR excluded.recorded_at>=rep_presence.recorded_at) THEN excluded.accuracy_m ELSE rep_presence.accuracy_m END,
             recorded_at=CASE WHEN excluded.recorded_at IS NOT NULL AND (rep_presence.recorded_at IS NULL OR excluded.recorded_at>=rep_presence.recorded_at) THEN excluded.recorded_at ELSE rep_presence.recorded_at END`,
        )
        .bind(p.id, d.session.id, newest?.lat ?? null, newest?.lng ?? null, newest?.accuracy ?? null, battery, d.session.source, newest?.recordedAt ?? null, received),
    );
  }
  if (statements.length) await db.batch(statements);
  return c.json({ ok: true, received: d.points.length, stored });
});

routes.post("/tracking/visits", async (c) => {
  const p = current(c),
    db = c.env.DB;
  const d = await body(
    c,
    z.object({
      id,
      session: sessionRef.optional(),
      customerId: z.string().min(1).max(64),
      visitedAt: iso,
      lat: lat.nullable().optional(),
      lng: lng.nullable().optional(),
      accuracy: z.number().nonnegative().max(100000).nullable().optional(),
      note: z.string().trim().max(300).default(""),
    }),
  );
  if (!d) return c.json({ error: "Invalid visit details" }, 400);
  if (!timeOk(d.visitedAt)) return c.json({ error: "Phone date/time looks wrong. Fix the clock and try again." }, 400);
  const customer = await db.prepare("SELECT id FROM customers WHERE id=?").bind(d.customerId).first();
  if (!customer) return c.json({ error: "Customer unavailable" }, 404);
  if (!p.admin) {
    const assigned = await db.prepare("SELECT 1 FROM customer_assignments WHERE customer_id=? AND rep_id=?").bind(d.customerId, p.id).first();
    if (!assigned) return c.json({ error: "Customer not assigned" }, 403);
  }
  let statements: D1PreparedStatement[] = [];
  try {
    if (d.session) statements = await ensureSession(db, p, d.session);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  const geo = await db.prepare("SELECT lat,lng FROM customer_geo WHERE customer_id=?").bind(d.customerId).first<{ lat: number; lng: number }>();
  const hasFix = d.lat != null && d.lng != null;
  const distance = geo && hasFix ? Math.round(haversine(geo, { lat: d.lat!, lng: d.lng! })) : null;
  statements.push(
    db
      .prepare("INSERT OR IGNORE INTO customer_visits(id,user_id,customer_id,session_id,visited_at,lat,lng,accuracy_m,distance_m,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(d.id, p.id, d.customerId, d.session?.id ?? null, toIso(d.visitedAt), d.lat ?? null, d.lng ?? null, d.accuracy ?? null, distance, d.note, now()),
  );
  // First accurate check-in at a shop saves the shop's position.
  if (!geo && hasFix && (d.accuracy ?? 999) <= 50)
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO customer_geo(customer_id,lat,lng,accuracy_m,set_by,set_at) VALUES(?,?,?,?,?,?)")
        .bind(d.customerId, d.lat, d.lng, d.accuracy ?? null, p.id, now()),
    );
  await db.batch(statements);
  return c.json({ ok: true, distanceM: distance, shopLocationSaved: !geo && hasFix && (d.accuracy ?? 999) <= 50 });
});

routes.get("/tracking/my-visits", async (c) => {
  const p = current(c),
    { from, to } = colomboDayRange(colomboToday());
  const rows = await c.env.DB.prepare(
    "SELECT v.id,v.visited_at,v.distance_m,c.shop_name FROM customer_visits v JOIN customers c ON c.id=v.customer_id WHERE v.user_id=? AND v.visited_at>=? AND v.visited_at<? ORDER BY v.visited_at DESC LIMIT 100",
  )
    .bind(p.id, from, to)
    .all();
  return c.json(rows.results);
});

/* ----------------------------------------------------------- admin side */

const adminOnly = (c: any) => (current(c).admin ? null : c.json({ error: "Admin only" }, 403));

routes.get("/tracking/live", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const db = c.env.DB,
    { from, to } = colomboDayRange(colomboToday());
  const [reps, points, visits] = await Promise.all([
    db
      .prepare(
        `SELECT u.id,u.name,u.username,s.id AS session_id,s.started_at,s.source AS session_source,
           pr.lat,pr.lng,pr.accuracy_m,pr.battery,pr.recorded_at,pr.received_at,pr.source
         FROM users u JOIN roles r ON r.id=u.role_id
         LEFT JOIN rep_duty_sessions s ON s.user_id=u.id AND s.ended_at IS NULL
         LEFT JOIN rep_presence pr ON pr.user_id=u.id
         WHERE u.active=1 AND (r.admin=0 OR pr.user_id IS NOT NULL)
         ORDER BY u.name`,
      )
      .all<any>(),
    db.prepare("SELECT user_id,session_id,lat,lng,recorded_at AS t,accuracy_m AS acc FROM rep_locations WHERE recorded_at>=? AND recorded_at<? ORDER BY user_id,recorded_at").bind(from, to).all<any>(),
    db.prepare("SELECT user_id,COUNT(*) AS n FROM customer_visits WHERE visited_at>=? AND visited_at<? GROUP BY user_id").bind(from, to).all<any>(),
  ]);
  const byUser = new Map<string, GeoPoint[]>();
  for (const x of points.results) {
    const list = byUser.get(x.user_id) || [];
    list.push(x);
    byUser.set(x.user_id, list);
  }
  const visitCount = new Map(visits.results.map((v: any) => [v.user_id, v.n]));
  const t = Date.now();
  return c.json({
    serverTime: new Date(t).toISOString(),
    reps: reps.results.map((r: any) => {
      const online = !!r.session_id && !!r.received_at && t - Date.parse(r.received_at) < ONLINE_MS;
      return {
        id: r.id,
        name: r.name,
        username: r.username,
        onDuty: !!r.session_id,
        dutyStartedAt: r.started_at,
        status: online ? "online" : r.session_id ? "no_signal" : "off_duty",
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m,
        battery: r.battery,
        lastFixAt: r.recorded_at,
        lastSeenAt: r.received_at,
        source: r.source || r.session_source,
        todayDistanceM: sessionsDistance(byUser.get(r.id) || []),
        todayVisits: visitCount.get(r.id) || 0,
      };
    }),
  });
});

routes.get("/tracking/history", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const userId = c.req.query("userId") || "",
    date = c.req.query("date") || colomboToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "Invalid date" }, 400);
  const db = c.env.DB,
    { from, to } = colomboDayRange(date);
  const user = await db.prepare("SELECT id,name FROM users WHERE id=?").bind(userId).first();
  if (!user) return c.json({ error: "Sales rep not found" }, 404);
  const [points, sessions, visits, invoices] = await Promise.all([
    db
      .prepare("SELECT session_id,lat,lng,recorded_at AS t,accuracy_m AS acc,speed_mps AS speed,battery FROM rep_locations WHERE user_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at LIMIT 5000")
      .bind(userId, from, to)
      .all<any>(),
    db
      .prepare("SELECT id,started_at,ended_at,end_reason,source FROM rep_duty_sessions WHERE user_id=? AND started_at<? AND (ended_at IS NULL OR ended_at>=?) ORDER BY started_at")
      .bind(userId, to, from)
      .all<any>(),
    db
      .prepare(
        `SELECT v.id,v.visited_at,v.lat,v.lng,v.accuracy_m,v.distance_m,v.note,c.id AS customer_id,c.shop_name,g.lat AS shop_lat,g.lng AS shop_lng
         FROM customer_visits v JOIN customers c ON c.id=v.customer_id LEFT JOIN customer_geo g ON g.customer_id=c.id
         WHERE v.user_id=? AND v.visited_at>=? AND v.visited_at<? ORDER BY v.visited_at`,
      )
      .bind(userId, from, to)
      .all<any>(),
    db
      .prepare(
        `SELECT i.id,i.number,i.created_at,i.total_cents,c.shop_name,g.lat AS shop_lat,g.lng AS shop_lng
         FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN customer_geo g ON g.customer_id=c.id
         WHERE i.rep_id=? AND i.status='posted' AND i.created_at>=? AND i.created_at<? ORDER BY i.created_at`,
      )
      .bind(userId, from, to)
      .all<any>(),
  ]);
  const pts = points.results as GeoPoint[];
  // Where the rep was when each bill was made: closest point within 15 minutes.
  const near = (time: string) => {
    let best: GeoPoint | null = null,
      gap = 15 * 60 * 1000;
    for (const x of pts) {
      const g = Math.abs(Date.parse(x.t) - Date.parse(time));
      if (g <= gap) {
        gap = g;
        best = x;
      }
    }
    return best ? { lat: best.lat, lng: best.lng } : null;
  };
  return c.json({
    user,
    date,
    points: pts,
    distanceM: sessionsDistance(pts),
    sessions: sessions.results,
    visits: visits.results,
    invoices: invoices.results.map((i: any) => ({ ...i, at: near(i.created_at) })),
  });
});

routes.delete("/tracking/customers/:id/geo", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  await c.env.DB.prepare("DELETE FROM customer_geo WHERE customer_id=?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default routes;
