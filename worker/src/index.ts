import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  allowedOrigin,
  audit,
  clearCookie,
  csrf,
  current,
  guard,
  now,
  passwordHash,
  permission,
  requireUser,
  sessionCookie,
  sha256,
  uuid,
  verifyPassword,
  type Env,
} from "./security";
import { asCents, dueDate, lineTotal, reminderDate, sumLines } from "./finance";
import distributionRoutes from "./distribution";
import logisticsRoutes from "./logistics";
import creditAlertsRoutes, { processReminders } from "./credit-alerts";
import { renderPublicInvoiceHtml } from "./public-invoice";
const app = new Hono<Env>();
const safe = z.string().trim().min(1).max(180);
const key = z.string().min(12).max(128);
const loginSchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  login: z.string().optional(),
  password: z.string().optional(),
  passcode: z.string().regex(/^\d{4}$/, "Passcode must be 4 digits").optional(),
});
const productSchema = z.object({
  name: safe,
  sku: safe,
  barcode: z.string().max(80).optional(),
  categoryId: z.string().optional(),
  variants: z
    .array(
      z.object({
        label: safe,
        unit: safe,
        grams: z.number().int().positive().optional(),
        retailCents: z.number().int().nonnegative(),
        wholesaleCents: z.number().int().nonnegative(),
        shopPriceCents: z.number().int().nonnegative().default(0),
        costCents: z.number().int().nonnegative(),
        lowStock: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
});
const customerSchema = z.object({
  shopName: safe,
  ownerName: safe,
  phone: z.string().max(40).default(""),
  whatsapp: z.string().max(40).default(""),
  address: z.string().max(300).default(""),
  location: z.string().max(200).default(""),
  type: z.enum(["wholesale", "retail"]),
  creditLimitCents: z.number().int().nonnegative().default(0),
  creditDays: z.number().int().min(0).max(45).default(0),
  repId: z.string().optional(),
});
const invoiceSchema = z.object({
  customerId: z.string().min(1),
  warehouseId: z.string().min(1),
  idempotencyKey: key,
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  initialPaymentCents: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(["cash", "bank", "other"]).default("cash"),
});
const paymentSchema = z.object({
  invoiceId: z.string(),
  amountCents: z.number().int().positive(),
  method: z.enum(["cash", "bank", "other"]),
  notes: z.string().max(300).optional().default(""),
  idempotencyKey: key,
});
const json = async <T extends z.ZodTypeAny>(
  c: any,
  schema: T,
): Promise<z.infer<T>> => schema.parse(await c.req.json());
app.use("*", async (c, next) =>
  cors({
    origin: (origin) => (allowedOrigin(c, origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type", "Idempotency-Key"],
  })(c, next),
);
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  c.header("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !csrf(c))
    return c.json({ error: "Invalid request origin" }, 403);
  await next();
});
app.get("/api/health", (c) => c.json({ ok: true }));
app.post("/api/setup", async (c) => {
  const secret = c.env.SETUP_TOKEN;
  if (!secret || c.req.header("X-Setup-Token") !== secret)
    return c.json({ error: "Setup unavailable" }, 403);
  const exists = await c.env.DB.prepare("SELECT id FROM users LIMIT 1").first();
  if (exists) return c.json({ error: "Already configured" }, 409);
  const data = await json(
    c,
    z.object({
      name: safe,
      email: z.email(),
      password: z.string().min(8).max(200),
    }),
  );
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").bind(
      uuid(),
      data.name,
      data.email.toLowerCase(),
      await passwordHash(data.password),
      "admin",
      1,
      now(),
    ),
    c.env.DB.prepare("INSERT INTO audit_logs VALUES(?,?,?,?,?,?)").bind(
      uuid(),
      null,
      "initial_setup",
      null,
      "",
      now(),
    ),
  ]);
  return c.json({ ok: true }, 201);
});
app.post("/api/login", async (c) => {
  const d = await json(c, loginSchema);
  const identifier = (d.username || d.login || d.email || "").trim();
  const db = c.env.DB;
  const rateKey = identifier ? identifier.toLowerCase() : `pin_${c.req.header("cf-connecting-ip") || "local"}`;

  const attempt = await db
    .prepare("SELECT attempts,window_start FROM login_attempts WHERE key=?")
    .bind(rateKey)
    .first<{ attempts: number; window_start: string }>();
  if (
    attempt &&
    Date.now() - Date.parse(attempt.window_start) < 900000 &&
    attempt.attempts >= 10
  )
    return c.json({ error: "Too many attempts. Try later." }, 429);

  type UserRow = {
    id: string;
    password_hash: string;
    passcode_hash: string | null;
    active: number;
    name: string;
    username: string | null;
    email: string;
  };
  let u: UserRow | null = null;

  if (d.passcode) {
    if (identifier) {
      const candidate = await db
        .prepare(
          "SELECT id,password_hash,passcode_hash,active,name,username,email FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)",
        )
        .bind(identifier, identifier)
        .first<UserRow>();
      if (
        candidate &&
        candidate.active &&
        candidate.passcode_hash &&
        (await verifyPassword(d.passcode, candidate.passcode_hash))
      ) {
        u = candidate;
      }
    } else {
      const candidates = await db
        .prepare(
          "SELECT id,password_hash,passcode_hash,active,name,username,email FROM users WHERE active=1 AND passcode_hash IS NOT NULL",
        )
        .all<UserRow>();
      for (const row of candidates.results || []) {
        if (
          row.passcode_hash &&
          (await verifyPassword(d.passcode, row.passcode_hash))
        ) {
          u = row;
          break;
        }
      }
    }
  } else if (d.password && identifier) {
    const candidate = await db
      .prepare(
        "SELECT id,password_hash,passcode_hash,active,name,username,email FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)",
      )
      .bind(identifier, identifier)
      .first<UserRow>();
    if (
      candidate &&
      candidate.active &&
      (await verifyPassword(d.password, candidate.password_hash))
    ) {
      u = candidate;
    }
  }

  if (!u || !u.active) {
    await db
      .prepare(
        `INSERT INTO login_attempts(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END`,
      )
      .bind(
        rateKey,
        now(),
        new Date(Date.now() - 900000).toISOString(),
        new Date(Date.now() - 900000).toISOString(),
      )
      .run();
    return c.json({ error: "Invalid credentials" }, 401);
  }

  await db.prepare("DELETE FROM login_attempts WHERE key=?").bind(rateKey).run();
  const token = uuid() + uuid();
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?,?)")
    .bind(
      uuid(),
      u.id,
      await sha256(token),
      new Date(Date.now() + 604800000).toISOString(),
      now(),
    )
    .run();
  c.header(
    "Set-Cookie",
    sessionCookie(token, new URL(c.req.url).protocol === "https:"),
  );
  await audit(db, u.id, "login", u.id);
  return c.json({
    ok: true,
    user: { id: u.id, name: u.name, username: u.username },
  });
});
app.get("/view/invoice/:token", async (c) => {
  const token = c.req.param("token");
  const db = c.env.DB;
  const invoice = await db
    .prepare(
      `SELECT i.*,c.shop_name,c.owner_name,c.address AS customer_address,c.phone AS customer_phone,c.whatsapp AS customer_profile_whatsapp,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp,b.email AS business_email,(SELECT value FROM system_settings WHERE key='invoice_show_shop_price') AS show_shop_price,(SELECT value FROM system_settings WHERE key='invoice_show_customer_whatsapp') AS show_customer_whatsapp FROM invoices i JOIN customers c ON c.id=i.customer_id CROSS JOIN business_settings b WHERE i.share_token=?`,
    )
    .bind(token)
    .first();
  if (!invoice) return c.html("<h1>Invoice Not Found</h1><p>The link is invalid or expired.</p>", 404);
  const items = (
    await db
      .prepare(
        "SELECT ii.*,p.name AS product_name,v.label AS variant_label,v.unit FROM invoice_items ii JOIN product_variants v ON v.id=ii.variant_id JOIN products p ON p.id=v.product_id WHERE ii.invoice_id=?",
      )
      .bind(invoice.id)
      .all()
  ).results;
  // The global CSP (default-src 'none') blocks this page's inline styles, so
  // customers saw unstyled HTML. This page only: allow its own inline styles,
  // same-origin images and one nonce'd script for the print button.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
  const html = renderPublicInvoiceHtml({
    invoice,
    items,
    showShopPrice: (invoice as any).show_shop_price === "true",
    showCustomerWhatsapp: (invoice as any).show_customer_whatsapp !== "false",
    nonce,
  });
  return c.html(html);
});

app.get("/api/public/invoices/:token", async (c) => {
  const token = c.req.param("token");
  const db = c.env.DB;
  const invoice = await db
    .prepare(
      `SELECT i.*,c.shop_name,c.owner_name,c.address AS customer_address,c.phone AS customer_phone,c.whatsapp AS customer_profile_whatsapp,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp,b.email AS business_email,(SELECT value FROM system_settings WHERE key='invoice_show_shop_price') AS show_shop_price,(SELECT value FROM system_settings WHERE key='invoice_show_customer_whatsapp') AS show_customer_whatsapp FROM invoices i JOIN customers c ON c.id=i.customer_id CROSS JOIN business_settings b WHERE i.share_token=?`,
    )
    .bind(token)
    .first();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  const items = (
    await db
      .prepare(
        "SELECT ii.*,p.name AS product_name,v.label AS variant_label,v.unit FROM invoice_items ii JOIN product_variants v ON v.id=ii.variant_id JOIN products p ON p.id=v.product_id WHERE ii.invoice_id=?",
      )
      .bind(invoice.id)
      .all()
  ).results;
  return c.json({ invoice, items });
});

app.use("/api/*", requireUser);
app.route("/api", distributionRoutes);
app.route("/api", logisticsRoutes);
app.route("/api", creditAlertsRoutes);
app.get("/api/me", async (c) => c.json({ user: current(c) }));
app.post("/api/logout", async (c) => {
  const token = c.req
    .header("Cookie")
    ?.match(/(?:^|;\s*)erp_session=([^;]+)/)?.[1];
  if (token)
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await sha256(token))
      .run();
  c.header("Set-Cookie", clearCookie(new URL(c.req.url).protocol === "https:"));
  return c.json({ ok: true });
});
app.post("/api/change-password", async (c) => {
  const p = current(c),
    d = await json(
      c,
      z.object({
        current: z.string().optional(),
        next: z.string().min(6).max(200).optional(),
        username: z.string().min(2).max(40).optional(),
        passcode: z.string().regex(/^\d{4}$/, "Passcode must be 4 digits").optional(),
      }),
    );
  const row = await c.env.DB.prepare(
    "SELECT password_hash, passcode_hash FROM users WHERE id=?",
  )
    .bind(p.id)
    .first<{ password_hash: string; passcode_hash: string | null }>();
  if (!row) return c.json({ error: "User not found" }, 404);

  if (d.next) {
    if (d.current) {
      if (!(await verifyPassword(d.current, row.password_hash))) {
        return c.json({ error: "Incorrect current password" }, 403);
      }
    } else if (!p.admin) {
      return c.json({ error: "Current password required" }, 400);
    }
  }

  if (d.username) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?",
    )
      .bind(d.username.trim(), p.id)
      .first();
    if (existing) return c.json({ error: "Username already taken" }, 400);
  }

  const newPwHash = d.next ? await passwordHash(d.next) : null;
  const newPinHash = d.passcode ? await passwordHash(d.passcode) : null;

  await c.env.DB.prepare(
    `UPDATE users SET
      username = COALESCE(?, username),
      password_hash = COALESCE(?, password_hash),
      passcode_hash = COALESCE(?, passcode_hash)
     WHERE id = ?`,
  )
    .bind(
      d.username ? d.username.trim() : null,
      newPwHash,
      newPinHash,
      p.id,
    )
    .run();

  await audit(c.env.DB, p.id, "user.credentials_changed", p.id);
  return c.json({ ok: true, relogin: false });
});
app.get("/api/settings", async (c) => {
  const denied = await guard(c, "settings.view");
  if (denied) return denied;
  return c.json(
    await c.env.DB.prepare(
      "SELECT * FROM business_settings WHERE id=1",
    ).first(),
  );
});
app.patch("/api/settings", async (c) => {
  const denied = await guard(c, "settings.edit");
  if (denied) return denied;
  const d = await json(
    c,
    z.object({
      name: safe,
      address: z.string().max(300),
      email: z.string().max(180),
      phone: z.string().max(40),
      whatsapp: z.string().max(40),
    }),
  );
  await c.env.DB.prepare(
    "UPDATE business_settings SET name=?,address=?,email=?,phone=?,whatsapp=? WHERE id=1",
  )
    .bind(d.name, d.address, d.email, d.phone, d.whatsapp)
    .run();
  await audit(c.env.DB, current(c).id, "business_settings", null);
  return c.json({ ok: true });
});
app.get("/api/users", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,name,username,email,role_id,active,created_at,(passcode_hash IS NOT NULL) AS has_passcode FROM users ORDER BY created_at DESC LIMIT 500",
      ).all()
    ).results,
  );
});
app.post("/api/users", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  const d = await json(
    c,
    z.object({
      name: safe,
      username: z.string().min(2).max(40),
      email: z.string().email().optional(),
      password: z.string().min(6).max(200),
      passcode: z.string().regex(/^\d{4}$/, "Passcode must be 4 digits").optional(),
      roleId: z.string().min(1),
    }),
  );
  const role = await c.env.DB.prepare("SELECT id FROM roles WHERE id=?")
    .bind(d.roleId)
    .first();
  if (!role) return c.json({ error: "Invalid role" }, 400);

  const cleanUsername = d.username.trim();
  const existingUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE LOWER(username)=LOWER(?)",
  )
    .bind(cleanUsername)
    .first();
  if (existingUser) return c.json({ error: "Username already taken" }, 400);

  const emailToUse = (d.email?.trim() || `${cleanUsername.toLowerCase()}@nugathalawa.erp`).toLowerCase();
  const existingEmail = await c.env.DB.prepare(
    "SELECT id FROM users WHERE LOWER(email)=LOWER(?)",
  )
    .bind(emailToUse)
    .first();
  if (existingEmail) return c.json({ error: "Email already taken" }, 400);

  const id = uuid();
  const stockWarehouseId = uuid();
  const pwHash = await passwordHash(d.password);
  const pinHash = d.passcode ? await passwordHash(d.passcode) : null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users(id,name,username,email,password_hash,passcode_hash,role_id,active,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      d.name,
      cleanUsername,
      emailToUse,
      pwHash,
      pinHash,
      d.roleId,
      1,
      now(),
    ),
    c.env.DB.prepare("INSERT INTO warehouses VALUES(?,?,?)").bind(
      stockWarehouseId,
      `${d.name} stock`,
      id,
    ),
    c.env.DB.prepare("INSERT INTO warehouse_metadata(warehouse_id,location_type,active) VALUES(?,'sales_rep',1)").bind(stockWarehouseId),
  ]);
  await audit(c.env.DB, current(c).id, "user.created", id);
  return c.json({ id }, 201);
});
app.patch("/api/users/:id", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id");
  const d = await json(
    c,
    z.object({
      name: safe.optional(),
      username: z.string().min(2).max(40).optional(),
      email: z.string().email().optional(),
      password: z.string().min(6).max(200).optional(),
      passcode: z.string().regex(/^\d{4}$/, "Passcode must be 4 digits").optional(),
      active: z.boolean().optional(),
      roleId: z.string().optional(),
    }),
  );
  if (id === current(c).id) {
    if (d.active === false) return c.json({ error: "Cannot deactivate own admin account" }, 400);
    if (d.roleId && d.roleId !== "admin") return c.json({ error: "Cannot change own admin role" }, 400);
  }
  if (d.username) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?",
    )
      .bind(d.username.trim(), id)
      .first();
    if (existing) return c.json({ error: "Username already taken" }, 400);
  }
  if (d.roleId) {
    const r = await c.env.DB.prepare("SELECT id FROM roles WHERE id=?")
      .bind(d.roleId)
      .first();
    if (!r) return c.json({ error: "Invalid role" }, 400);
  }

  const pwHash = d.password ? await passwordHash(d.password) : null;
  const pinHash = d.passcode ? await passwordHash(d.passcode) : null;

  await c.env.DB.prepare(
    `UPDATE users SET 
      name = COALESCE(?, name),
      username = COALESCE(?, username),
      email = COALESCE(?, email),
      password_hash = COALESCE(?, password_hash),
      passcode_hash = COALESCE(?, passcode_hash),
      active = COALESCE(?, active),
      role_id = COALESCE(?, role_id)
     WHERE id = ?`,
  ).bind(
    d.name ?? null,
    d.username ? d.username.trim() : null,
    d.email ? d.email.toLowerCase() : null,
    pwHash,
    pinHash,
    d.active === undefined ? null : Number(d.active),
    d.roleId ?? null,
    id,
  ).run();

  if (d.password || d.active === false) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash!=COALESCE((SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1), '')").bind(id, current(c).id).run();
  }

  await audit(c.env.DB, current(c).id, "user.updated", id);
  return c.json({ ok: true });
});
app.get("/api/permissions", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  return c.json(
    (await c.env.DB.prepare("SELECT * FROM permissions ORDER BY key").all())
      .results,
  );
});
app.get("/api/roles", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT r.id,r.name,r.admin,GROUP_CONCAT(rp.permission_key) AS permission_keys FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id GROUP BY r.id ORDER BY r.name",
      ).all()
    ).results,
  );
});
app.post("/api/roles", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  const d = await json(
    c,
    z.object({ name: safe, permissionKeys: z.array(z.string()).default([]) }),
  );
  const db = c.env.DB,
    id = uuid();
  await db.batch([
    db.prepare("INSERT INTO roles VALUES(?,?,0)").bind(id, d.name),
    ...d.permissionKeys.map((x) =>
      db.prepare("INSERT INTO role_permissions VALUES(?,?)").bind(id, x),
    ),
  ]);
  await audit(db, current(c).id, "role.created", id);
  return c.json({ id }, 201);
});
app.patch("/api/users/:id/permissions", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id"),
    d = await json(
      c,
      z.object({ key: z.string(), allowed: z.boolean().nullable() }),
    ),
    db = c.env.DB;
  if (d.allowed === null)
    await db
      .prepare(
        "DELETE FROM user_permissions WHERE user_id=? AND permission_key=?",
      )
      .bind(id, d.key)
      .run();
  else
    await db
      .prepare(
        "INSERT INTO user_permissions VALUES(?,?,?) ON CONFLICT(user_id,permission_key) DO UPDATE SET allowed=excluded.allowed",
      )
      .bind(id, d.key, Number(d.allowed))
      .run();
  await audit(db, current(c).id, "permission.changed", id, d.key);
  return c.json({ ok: true });
});
app.post("/api/users/:id/reset-password", async (c) => {
  if (!current(c).admin) return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id"),
    d = await json(
      c,
      z.object({
        newPassword: z.string().min(6).max(200).optional(),
        newPasscode: z.string().regex(/^\d{4}$/, "Passcode must be 4 digits").optional(),
        newUsername: z.string().min(2).max(40).optional(),
      }),
    );
  if (!d.newPassword && !d.newPasscode && !d.newUsername) {
    return c.json({ error: "No changes provided" }, 400);
  }
  if (d.newUsername) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?",
    )
      .bind(d.newUsername.trim(), id)
      .first();
    if (existing) return c.json({ error: "Username already taken" }, 400);
  }
  const pwHash = d.newPassword ? await passwordHash(d.newPassword) : null;
  const pinHash = d.newPasscode ? await passwordHash(d.newPasscode) : null;

  await c.env.DB.prepare(
    `UPDATE users SET
      username = COALESCE(?, username),
      password_hash = COALESCE(?, password_hash),
      passcode_hash = COALESCE(?, passcode_hash)
     WHERE id = ?`,
  )
    .bind(
      d.newUsername ? d.newUsername.trim() : null,
      pwHash,
      pinHash,
      id,
    )
    .run();

  if (d.newPassword) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
  }
  await audit(c.env.DB, current(c).id, "password.reset", id);
  return c.json({ ok: true });
});
app.get("/api/products", async (c) => {
  const denied = await guard(c, "products.view");
  if (denied) return denied;
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT p.id,p.name,p.sku,p.barcode,p.active,v.id AS variant_id,v.label,v.unit,v.grams,v.retail_cents,v.wholesale_cents,v.shop_price_cents,v.low_stock,COALESCE(s.quantity,0) AS main_stock FROM products p JOIN product_variants v ON v.product_id=p.id LEFT JOIN stock_balances s ON s.variant_id=v.id AND s.warehouse_id=? ORDER BY p.name LIMIT 500",
      )
        .bind("main")
        .all()
    ).results,
  );
});
app.post("/api/products", async (c) => {
  if (!current(c).admin) return c.json({ error: "Admin only" }, 403);
  const d = await json(c, productSchema),
    db = c.env.DB,
    id = uuid();
  const stmts = [
    db
      .prepare(
        "INSERT INTO products(id,category_id,name,sku,barcode,active,created_at) VALUES(?,?,?,?,?,1,?)",
      )
      .bind(id, d.categoryId ?? null, d.name, d.sku, d.barcode ?? null, now()),
    ...d.variants.map((v) =>
      db
        .prepare(
          "INSERT INTO product_variants(id,product_id,label,unit,grams,retail_cents,wholesale_cents,cost_cents,low_stock,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          id,
          v.label,
          v.unit,
          v.grams ?? null,
          v.retailCents,
          v.wholesaleCents,
          v.costCents,
          v.lowStock,
          v.shopPriceCents,
        ),
    ),
  ];
  await db.batch(stmts);
  await audit(db, current(c).id, "product.created", id);
  return c.json({ id }, 201);
});
app.get("/api/customers", async (c) => {
  const denied = await guard(c, "customers.view");
  if (denied) return denied;
  const p = current(c);
  const q =
    p.admin || (await permission(c, p, "customers.view_all"))
      ? "SELECT * FROM customers ORDER BY created_at DESC LIMIT 500"
      : "SELECT c.* FROM customers c JOIN customer_assignments a ON a.customer_id=c.id WHERE a.rep_id=? ORDER BY c.created_at DESC LIMIT 500";
  return c.json(
    (
      await c.env.DB.prepare(q)
        .bind(...(q.includes("a.rep_id=?") ? [p.id] : []))
        .all()
    ).results,
  );
});
app.post("/api/customers", async (c) => {
  const denied = await guard(c, "customers.create");
  if (denied) return denied;
  const d = await json(c, customerSchema),
    p = current(c),
    id = uuid(),
    db = c.env.DB;
  if (
    !p.admin &&
    ((d.repId && d.repId !== p.id) ||
      d.creditLimitCents > 0 ||
      d.creditDays > 0)
  )
    return c.json(
      { error: "Admin approval required for credit or assignment" },
      403,
    );
  const rep = p.admin ? d.repId : p.id;
  await db.batch([
    db
      .prepare("INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        id,
        d.shopName,
        d.ownerName,
        d.phone,
        d.whatsapp,
        d.address,
        d.location,
        d.type,
        d.creditLimitCents,
        d.creditDays,
        1,
        now(),
      ),
    ...(rep
      ? [
          db
            .prepare("INSERT INTO customer_assignments VALUES(?,?)")
            .bind(id, rep),
        ]
      : []),
  ]);
  await audit(db, p.id, "customer.created", id);
  return c.json({ id }, 201);
});
app.post("/api/stock/adjust", async (c) => {
  if (!current(c).admin) return c.json({ error: "Admin only" }, 403);
  const d = await json(
    c,
    z.object({
      warehouseId: z.string(),
      variantId: z.string(),
      delta: z
        .number()
        .int()
        .refine((x) => x !== 0),
      reason: safe,
    }),
  );
  const db = c.env.DB,
    id = uuid(),
    from = d.delta < 0 ? d.warehouseId : null,
    to = d.delta > 0 ? d.warehouseId : null;
  await db.batch([
    db
      .prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        id,
        d.variantId,
        from,
        to,
        Math.abs(d.delta),
        d.reason,
        null,
        now(),
      ),
    db
      .prepare(
        "INSERT INTO stock_balances VALUES(?,?,?) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET quantity=quantity+excluded.quantity",
      )
      .bind(d.warehouseId, d.variantId, d.delta),
  ]);
  await audit(db, current(c).id, "stock.adjusted", id);
  return c.json({ id }, 201);
});
app.post("/api/stock/transfer", async (c) => {
  const denied = await guard(c, "stock.allocate");
  if (denied) return denied;
  const d = await json(
    c,
    z.object({
      from: z.string(),
      to: z.string(),
      variantId: z.string(),
      quantity: z.number().int().positive(),
    }),
  );
  if (d.from === d.to)
    return c.json({ error: "Select different warehouses" }, 400);
  const db = c.env.DB,
    id = uuid();
  await db.batch([
    db
      .prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, d.variantId, d.from, d.to, d.quantity, "transfer", null, now()),
    db
      .prepare(
        "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
      )
      .bind(d.quantity, d.from, d.variantId),
    db
      .prepare(
        "INSERT INTO stock_balances VALUES(?,?,?) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET quantity=quantity+excluded.quantity",
      )
      .bind(d.to, d.variantId, d.quantity),
  ]);
  await audit(db, current(c).id, "stock.transferred", id);
  return c.json({ id }, 201);
});
app.get("/api/stock", async (c) => {
  const denied = await guard(c, "stock.view");
  if (denied) return denied;
  const p = current(c);
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT b.*,v.label,p.name,w.name AS warehouse,COALESCE(wm.location_type,CASE WHEN w.rep_id IS NULL THEN 'warehouse' ELSE 'sales_rep' END) AS location_type,
          COALESCE(s.reserved_quantity,0) AS reserved_quantity,COALESCE(s.allocated_quantity,0) AS allocated_quantity,COALESCE(s.damaged_quantity,0) AS damaged_quantity,
          MAX(0,b.quantity-COALESCE(s.reserved_quantity,0)-COALESCE(s.allocated_quantity,0)) AS available_quantity
         FROM stock_balances b JOIN product_variants v ON v.id=b.variant_id JOIN products p ON p.id=v.product_id JOIN warehouses w ON w.id=b.warehouse_id
         LEFT JOIN warehouse_metadata wm ON wm.warehouse_id=w.id LEFT JOIN stock_balance_status s ON s.warehouse_id=b.warehouse_id AND s.variant_id=b.variant_id
         WHERE (?=1 OR w.rep_id=?) ORDER BY p.name LIMIT 500`,
      )
        .bind(p.admin, p.id)
        .all()
    ).results,
  );
});
app.post("/api/invoices", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const d = await json(c, invoiceSchema),
    db = c.env.DB,
    p = current(c),
    existing = await db
      .prepare("SELECT id,number FROM invoices WHERE idempotency_key=?")
      .bind(d.idempotencyKey)
      .first();
  if (existing) return c.json(existing);
  const customer = await db
    .prepare("SELECT * FROM customers WHERE id=? AND active=1")
    .bind(d.customerId)
    .first<{
      id: string;
      type: string;
      credit_days: number;
      credit_limit_cents: number;
    }>();
  if (!customer) return c.json({ error: "Customer unavailable" }, 404);
  if (!p.admin) {
    const assigned = await db
      .prepare(
        "SELECT 1 FROM customer_assignments WHERE customer_id=? AND rep_id=?",
      )
      .bind(d.customerId, p.id)
      .first();
    if (!assigned) return c.json({ error: "Customer not assigned" }, 403);
    const wh = await db
      .prepare("SELECT 1 FROM warehouses WHERE id=? AND rep_id=?")
      .bind(d.warehouseId, p.id)
      .first();
    if (!wh) return c.json({ error: "Warehouse not assigned" }, 403);
  }
  if (new Set(d.items.map((x) => x.variantId)).size !== d.items.length)
    return c.json({ error: "Duplicate variants in invoice" }, 400);
  const items = [] as {
    variantId: string;
    quantity: number;
    unitPriceCents: number;
    costCents: number;
  }[];
  for (const x of d.items) {
    const v = await db
      .prepare(
        "SELECT v.retail_cents,v.wholesale_cents,v.cost_cents FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1",
      )
      .bind(x.variantId)
      .first<{
        retail_cents: number;
        wholesale_cents: number;
        cost_cents: number;
      }>();
    if (!v) return c.json({ error: "Variant unavailable" }, 400);
    items.push({
      variantId: x.variantId,
      quantity: x.quantity,
      unitPriceCents:
        customer.type === "wholesale" ? v.wholesale_cents : v.retail_cents,
      costCents: v.cost_cents,
    });
  }
  const total = sumLines(
    items.map((x) => ({
      unitPriceCents: x.unitPriceCents,
      quantity: x.quantity,
    })),
  );
  if (d.initialPaymentCents > total)
    return c.json({ error: "Initial payment exceeds total" }, 400);
  const days = customer.credit_days;
  const outstanding = total - d.initialPaymentCents;
  if (outstanding && days === 0)
    return c.json({ error: "Customer has no credit terms" }, 400);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const due = outstanding ? dueDate(date, days) : null;
  const id = uuid();
  const number = `SD-${date.replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;
  const created = now();
  const statements = [
    db
      .prepare(
        "INSERT INTO invoices(id,number,customer_id,rep_id,warehouse_id,total_cents,paid_cents,status,due_at,idempotency_key,created_at,cancelled_at,subtotal_cents,item_discount_cents,invoice_discount_cents,payment_method,payment_terms,notes,terms,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        number,
        d.customerId,
        p.id,
        d.warehouseId,
        total,
        d.initialPaymentCents,
        "posted",
        due,
        d.idempotencyKey,
        created,
        null,
        total,
        0,
        0,
        d.paymentMethod,
        "",
        "",
        "",
        "sale",
        null,
      ),
    ...items.flatMap((x) => [
      db
        .prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)")
        .bind(
          uuid(),
          x.variantId,
          d.warehouseId,
          null,
          x.quantity,
          "sale",
          id,
          created,
        ),
      db
        .prepare(
          "UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND variant_id=?",
        )
        .bind(x.quantity, d.warehouseId, x.variantId),
      db
        .prepare(
          "INSERT INTO invoice_items(id,invoice_id,variant_id,quantity,unit_price_cents,cost_cents,line_cents,price_type,item_discount_cents,shop_price_cents) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          id,
          x.variantId,
          x.quantity,
          x.unitPriceCents,
          x.costCents,
          lineTotal(x.unitPriceCents, x.quantity),
          customer.type === "wholesale" ? "wholesale" : "retail",
          0,
          0,
        ),
    ]),
    ...(d.initialPaymentCents
      ? [
          db
            .prepare("INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes) VALUES(?,?,?,?,?,?,?,?)")
            .bind(
              uuid(),
              id,
              d.initialPaymentCents,
              d.paymentMethod,
              `${d.idempotencyKey}:initial`,
              p.id,
              created,
              "Initial invoice payment",
            ),
        ]
      : []),
  ];
  try {
    await db.batch(statements);
  } catch (e) {
    const previous = await db
      .prepare("SELECT id,number FROM invoices WHERE idempotency_key=?")
      .bind(d.idempotencyKey)
      .first();
    if (previous) return c.json(previous);
    throw e;
  }
  await audit(db, p.id, "invoice.posted", id);
  return c.json(
    {
      id,
      number,
      totalCents: total,
      paidCents: d.initialPaymentCents,
      dueAt: due,
    },
    201,
  );
});
app.get("/api/invoices", async (c) => {
  const denied = await guard(c, "invoices.view");
  if (denied) return denied;
  const p = current(c);
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT i.id,i.number,i.total_cents,i.paid_cents,i.due_at,i.status,i.created_at,c.shop_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE (?=1 OR i.rep_id=?) ORDER BY i.created_at DESC LIMIT 200`,
      )
        .bind(p.admin, p.id)
        .all()
    ).results,
  );
});
app.get("/api/invoices/:id", async (c) => {
  const denied = await guard(c, "invoices.view");
  if (denied) return denied;
  const p = current(c),
    id = c.req.param("id"),
    db = c.env.DB;
  const invoice = await db
    .prepare(
      `SELECT i.*,c.shop_name,c.address,c.whatsapp,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.whatsapp AS business_whatsapp,b.email AS business_email FROM invoices i JOIN customers c ON c.id=i.customer_id CROSS JOIN business_settings b WHERE i.id=? AND (?=1 OR i.rep_id=?)`,
    )
    .bind(id, p.admin, p.id)
    .first();
  if (!invoice) return c.json({ error: "Not found" }, 404);
  const items = (
    await db
      .prepare(
        "SELECT ii.*,p.name,v.label FROM invoice_items ii JOIN product_variants v ON v.id=ii.variant_id JOIN products p ON p.id=v.product_id WHERE invoice_id=?",
      )
      .bind(id)
      .all()
  ).results;
  return c.json({ invoice, items });
});
app.post("/api/invoices/:id/cancel", async (c) => {
  if (!current(c).admin) return c.json({ error: "Admin only" }, 403);
  const id = c.req.param("id"),
    db = c.env.DB,
    invoice = await db
      .prepare("SELECT * FROM invoices WHERE id=?")
      .bind(id)
      .first<{ status: string; paid_cents: number; warehouse_id: string }>();
  if (!invoice || invoice.status !== "posted")
    return c.json({ error: "Invoice not found or already cancelled" }, 404);
  if (invoice.paid_cents)
    return c.json(
      { error: "Refund recorded payments before cancellation" },
      409,
    );
  const items = (
    await db
      .prepare(
        "SELECT variant_id,quantity FROM invoice_items WHERE invoice_id=?",
      )
      .bind(id)
      .all<{ variant_id: string; quantity: number }>()
  ).results;
  await db.batch([
    db
      .prepare(
        "UPDATE invoices SET status='cancelled',cancelled_at=? WHERE id=? AND status='posted' AND paid_cents=0",
      )
      .bind(now(), id),
    ...items.flatMap((x) => [
      db
        .prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)")
        .bind(
          uuid(),
          x.variant_id,
          null,
          invoice.warehouse_id,
          x.quantity,
          "invoice_reversal",
          id,
          now(),
        ),
      db
        .prepare(
          "INSERT INTO stock_balances VALUES(?,?,?) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET quantity=quantity+excluded.quantity",
        )
        .bind(invoice.warehouse_id, x.variant_id, x.quantity),
    ]),
  ]);
  await audit(db, current(c).id, "invoice.cancelled", id);
  return c.json({ ok: true });
});
app.post("/api/payments", async (c) => {
  const denied = await guard(c, "payments.create");
  if (denied) return denied;
  const d = await json(c, paymentSchema),
    db = c.env.DB,
    p = current(c),
    existing = await db
      .prepare("SELECT id FROM payments WHERE idempotency_key=?")
      .bind(d.idempotencyKey)
      .first();
  if (existing) return c.json(existing);
  const i = await db
    .prepare("SELECT * FROM invoices WHERE id=? AND status=?")
    .bind(d.invoiceId, "posted")
    .first<{
      id: string;
      rep_id: string;
      paid_cents: number;
      total_cents: number;
    }>();
  if (!i) return c.json({ error: "Invoice unavailable" }, 404);
  if (!p.admin && i.rep_id !== p.id)
    return c.json({ error: "Not your invoice" }, 403);
  if (d.amountCents > i.total_cents - i.paid_cents)
    return c.json({ error: "Amount exceeds outstanding" }, 400);
  const id = uuid();
  try {
    await db.batch([
      db
        .prepare(
          "UPDATE invoices SET paid_cents=paid_cents+? WHERE id=? AND status=? AND total_cents-paid_cents>=?",
        )
        .bind(d.amountCents, i.id, "posted", d.amountCents),
      db
        .prepare("INSERT INTO payments(id,invoice_id,amount_cents,method,idempotency_key,created_by,created_at,notes) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, i.id, d.amountCents, d.method, d.idempotencyKey, p.id, now(), d.notes || ""),
    ]);
  } catch (e) {
    const prev = await db
      .prepare("SELECT id FROM payments WHERE idempotency_key=?")
      .bind(d.idempotencyKey)
      .first();
    if (prev) return c.json(prev);
    throw e;
  }
  await audit(db, p.id, "payment.recorded", id);
  return c.json({ id }, 201);
});
app.get("/api/dashboard", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const p = current(c),
    db = c.env.DB,
    scope = p.admin ? "1=1" : "rep_id=?",
    args = p.admin ? [] : [p.id];
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const start = new Date(
    Date.parse(`${localDay}T00:00:00Z`) - 19800000,
  ).toISOString();
  const month = new Date(
    Date.parse(`${localDay.slice(0, 7)}-01T00:00:00Z`) - 19800000,
  ).toISOString();
  const [sales, today, monthly, outstanding, overdue, shops, reps, low] =
    await Promise.all([
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents),0) AS amount FROM invoices WHERE status='posted' AND ${scope}`,
        )
        .bind(...args)
        .first(),
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents),0) AS amount FROM invoices WHERE status='posted' AND created_at>=? AND ${scope}`,
        )
        .bind(start, ...args)
        .first(),
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents),0) AS amount FROM invoices WHERE status='posted' AND created_at>=? AND ${scope}`,
        )
        .bind(month, ...args)
        .first(),
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents-paid_cents),0) AS amount FROM invoices WHERE status='posted' AND ${scope}`,
        )
        .bind(...args)
        .first(),
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents-paid_cents),0) AS amount FROM invoices WHERE status='posted' AND due_at<? AND ${scope}`,
        )
        .bind(localDay, ...args)
        .first(),
      db
        .prepare(
          p.admin
            ? "SELECT COUNT(*) AS count FROM customers WHERE active=1"
            : "SELECT COUNT(*) AS count FROM customer_assignments a JOIN customers c ON c.id=a.customer_id WHERE c.active=1 AND a.rep_id=?",
        )
        .bind(...args)
        .first(),
      p.admin
        ? db
            .prepare(
              "SELECT COUNT(*) AS count FROM users WHERE role_id='sales_rep' AND active=1",
            )
            .first()
        : Promise.resolve({ count: 0 }),
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM stock_balances b JOIN product_variants v ON v.id=b.variant_id JOIN warehouses w ON w.id=b.warehouse_id WHERE b.quantity<=v.low_stock AND (?=1 OR w.rep_id=?)`,
        )
        .bind(p.admin, p.id)
        .first(),
    ]);
  return c.json({
    totalSalesCents: (sales as any)?.amount ?? 0,
    todaySalesCents: (today as any)?.amount ?? 0,
    monthlySalesCents: (monthly as any)?.amount ?? 0,
    outstandingCents: (outstanding as any)?.amount ?? 0,
    overdueCents: (overdue as any)?.amount ?? 0,
    activeShops: (shops as any)?.count ?? 0,
    activeReps: (reps as any)?.count ?? 0,
    lowStock: (low as any)?.count ?? 0,
  });
});
app.get("/api/reports/summary", async (c) => {
  const denied = await guard(c, "reports.view");
  if (denied) return denied;
  const p = current(c),
    db = c.env.DB;
  const from = c.req.query("from") || "2000-01-01",
    to = c.req.query("to") || "2100-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return c.json({ error: "Invalid date filter" }, 400);
  const q = await db
    .prepare(
      `SELECT COALESCE(SUM(i.total_cents),0) AS invoiced_cents,COALESCE(SUM(i.paid_cents),0) AS collected_cents,COALESCE(SUM(i.total_cents-i.paid_cents),0) AS receivables_cents,COALESCE(SUM((SELECT SUM((ii.unit_price_cents-ii.cost_cents)*ii.quantity) FROM invoice_items ii WHERE ii.invoice_id=i.id)),0) AS gross_profit_cents FROM invoices i WHERE i.status='posted' AND i.created_at>=? AND i.created_at<? AND (?=1 OR i.rep_id=?)`,
    )
    .bind(`${from}T00:00:00`, `${to}T23:59:59`, p.admin, p.id)
    .first();
  return c.json(q);
});
app.get("/api/reports/:kind", async (c) => {
  const denied = await guard(c, "reports.view");
  if (denied) return denied;
  const kind = c.req.param("kind"),
    db = c.env.DB,
    p = current(c),
    from = c.req.query("from") || "2000-01-01",
    to = c.req.query("to") || "2100-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return c.json({ error: "Invalid date range" }, 400);
  let sql = "";
  let args: (string | number)[] = [];
  const scope = " AND (?=1 OR i.rep_id=?)";
  const d = [`${from}T00:00:00`, `${to}T23:59:59`, p.admin, p.id];
  switch (kind) {
    case "daily-sales":
      sql = `SELECT substr(i.created_at,1,10) AS date,COUNT(*) AS invoices,SUM(i.total_cents) AS invoiced_cents,SUM(i.paid_cents) AS collected_cents FROM invoices i WHERE i.status='posted' AND i.created_at>=? AND i.created_at<=? ${scope} GROUP BY date ORDER BY date DESC LIMIT 500`;
      args = d;
      break;
    case "product-sales":
      sql = `SELECT pr.name,v.label,SUM(ii.quantity) AS units,SUM(ii.line_cents) AS revenue_cents,SUM((ii.unit_price_cents-ii.cost_cents)*ii.quantity) AS gross_profit_cents FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id JOIN product_variants v ON v.id=ii.variant_id JOIN products pr ON pr.id=v.product_id WHERE i.status='posted' AND i.created_at>=? AND i.created_at<=? ${scope} GROUP BY v.id ORDER BY revenue_cents DESC LIMIT 500`;
      args = d;
      break;
    case "outstanding":
      sql = `SELECT c.shop_name,i.number,i.due_at,i.total_cents-i.paid_cents AS outstanding_cents FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='posted' AND i.total_cents>i.paid_cents AND i.created_at>=? AND i.created_at<=? ${scope} ORDER BY i.due_at LIMIT 500`;
      args = d;
      break;
    case "collections":
      sql = `SELECT pay.created_at,i.number,pay.amount_cents,pay.method FROM payments pay JOIN invoices i ON i.id=pay.invoice_id WHERE pay.created_at>=? AND pay.created_at<=? ${scope} ORDER BY pay.created_at DESC LIMIT 500`;
      args = d;
      break;
    case "stock-movements":
      sql = `SELECT m.created_at,pr.name,v.label,m.reason,m.quantity,m.from_warehouse,m.to_warehouse FROM stock_movements m JOIN product_variants v ON v.id=m.variant_id JOIN products pr ON pr.id=v.product_id LEFT JOIN invoices i ON i.id=m.reference_id WHERE m.created_at>=? AND m.created_at<=? AND (?=1 OR i.rep_id=?) ORDER BY m.created_at DESC LIMIT 500`;
      args = d;
      break;
    default:
      return c.json({ error: "Unknown report" }, 404);
  }
  const rows = (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
  return c.json(rows);
});
// ── Customer Account Ledger ─────────────────────────────────────────────────
app.get("/api/customers/:id/account", async (c) => {
  const denied = await guard(c, "customers.view");
  if (denied) return denied;
  const db = c.env.DB, cid = c.req.param("id");
  const customer = await db
    .prepare("SELECT * FROM customers WHERE id=?")
    .bind(cid)
    .first();
  if (!customer) return c.json({ error: "Not found" }, 404);
  const [totals, invoiceRows, paymentRows, freeIssueRows, consignmentRows, creditNoteRows] =
    await Promise.all([
      db.prepare(`
        SELECT
          COALESCE(SUM(i.total_cents),0) AS total_invoiced,
          COALESCE(SUM(i.paid_cents),0) AS total_paid,
          COALESCE(SUM(CASE WHEN i.status='posted' THEN i.total_cents-i.paid_cents ELSE 0 END),0) AS outstanding,
          COALESCE(SUM(CASE WHEN i.status='posted' AND i.due_at IS NOT NULL AND i.due_at < date('now') THEN i.total_cents-i.paid_cents ELSE 0 END),0) AS overdue
        FROM invoices i WHERE i.customer_id=?`).bind(cid).first(),
      db.prepare(`SELECT i.id,i.number,i.total_cents,i.paid_cents,i.status,i.due_at,i.created_at,
        u.name AS rep_name FROM invoices i LEFT JOIN users u ON u.id=i.rep_id
        WHERE i.customer_id=? ORDER BY i.created_at DESC LIMIT 200`).bind(cid).all(),
      db.prepare(`SELECT p.id,p.amount_cents,p.method,p.notes,p.created_at,i.number AS invoice_number,u.name AS created_by
        FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN users u ON u.id=p.created_by
        WHERE i.customer_id=? ORDER BY p.created_at DESC LIMIT 200`).bind(cid).all(),
      db.prepare(`SELECT f.id,f.created_at,f.notes,f.issued_by,u.name AS rep_name,
        GROUP_CONCAT(pr.name||' '||v.label||' x'||fi.quantity,' | ') AS items
        FROM free_issues f JOIN free_issue_items fi ON fi.free_issue_id=f.id
        JOIN product_variants v ON v.id=fi.variant_id JOIN products pr ON pr.id=v.product_id
        LEFT JOIN users u ON u.id=f.rep_id
        WHERE f.customer_id=? GROUP BY f.id ORDER BY f.created_at DESC LIMIT 100`).bind(cid).all(),
      db.prepare(`SELECT c.id,c.created_at,c.status,c.issued_by,u.name AS rep_name,
        GROUP_CONCAT(pr.name||' '||v.label||' x'||ci.issued_quantity,' | ') AS items
        FROM consignments c JOIN consignment_items ci ON ci.consignment_id=c.id
        JOIN product_variants v ON v.id=ci.variant_id JOIN products pr ON pr.id=v.product_id
        LEFT JOIN users u ON u.id=c.rep_id
        WHERE c.customer_id=? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`).bind(cid).all(),
      db.prepare(`SELECT cn.id,cn.number,cn.total_cents,cn.reason,cn.status,cn.created_at
        FROM credit_notes cn WHERE cn.customer_id=? ORDER BY cn.created_at DESC LIMIT 100`).bind(cid).all(),
    ]);
  const t = totals as any;
  const creditLimit = (customer as any).credit_limit_cents || 0;
  const outstanding = t?.outstanding ?? 0;
  const availableCredit = Math.max(0, creditLimit - outstanding);
  // Build chronological ledger
  const ledger: Array<{date:string;type:string;ref:string;debit:number;credit:number;note:string}> = [];
  for (const inv of (invoiceRows.results as any[])) {
    ledger.push({ date: inv.created_at, type: "invoice", ref: inv.number, debit: inv.total_cents, credit: 0, note: `Invoice ${inv.number}` });
  }
  for (const pay of (paymentRows.results as any[])) {
    ledger.push({ date: pay.created_at, type: "payment", ref: pay.invoice_number, debit: 0, credit: pay.amount_cents, note: `Payment via ${pay.method}${pay.notes ? " — "+pay.notes : ""}` });
  }
  for (const cn of (creditNoteRows.results as any[])) {
    ledger.push({ date: cn.created_at, type: "credit_note", ref: cn.number, debit: 0, credit: cn.total_cents, note: `Credit note: ${cn.reason}` });
  }
  ledger.sort((a, b) => a.date < b.date ? -1 : 1);
  // Running balance
  let balance = 0;
  const ledgerWithBalance = ledger.map(e => {
    balance += e.debit - e.credit;
    return { ...e, balance };
  });
  return c.json({
    customer,
    summary: {
      totalInvoiced: t?.total_invoiced ?? 0,
      totalPaid: t?.total_paid ?? 0,
      outstanding,
      overdue: t?.overdue ?? 0,
      creditLimit,
      availableCredit,
    },
    ledger: ledgerWithBalance,
    invoices: invoiceRows.results,
    payments: paymentRows.results,
    freeIssues: freeIssueRows.results,
    consignments: consignmentRows.results,
    creditNotes: creditNoteRows.results,
  });
});

// ── Expenses ─────────────────────────────────────────────────────────────────
const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(["transport","fuel","salaries","utilities","marketing","maintenance","office","general","other"]),
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int().positive(),
  method: z.enum(["cash","bank","other"]).default("cash"),
  reference: z.string().max(100).default(""),
});
app.get("/api/expenses", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const from = c.req.query("from") || "2000-01-01",
    to = c.req.query("to") || "2100-01-01";
  const rows = await c.env.DB.prepare(
    `SELECT e.*,u.name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by
     WHERE e.date>=? AND e.date<=? ORDER BY e.date DESC, e.created_at DESC LIMIT 500`,
  ).bind(from, to).all();
  return c.json(rows.results);
});
app.post("/api/expenses", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const d = await json(c, expenseSchema), db = c.env.DB, p = current(c), id = uuid();
  await db.prepare(
    "INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?)",
  ).bind(id, d.date, d.category, d.description, d.amountCents, d.method, d.reference, p.id, now()).run();
  await audit(db, p.id, "expense.created", id);
  return c.json({ id }, 201);
});
app.delete("/api/expenses/:id", async (c) => {
  const denied = await guard(c, "settings.edit");
  if (denied) return denied;
  const db = c.env.DB, p = current(c), id = c.req.param("id");
  await db.prepare("DELETE FROM expenses WHERE id=?").bind(id).run();
  await audit(db, p.id, "expense.deleted", id);
  return c.json({ ok: true });
});

// ── Cashbook summary ─────────────────────────────────────────────────────────
app.get("/api/cashbook", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const from = c.req.query("from") || new Date(Date.now() - 30*86400000).toISOString().slice(0,10),
    to = c.req.query("to") || new Date().toISOString().slice(0,10);
  const [collections, expenses] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.amount_cents),0) AS total FROM payments p WHERE p.created_at>=? AND p.created_at<=?`
    ).bind(`${from}T00:00:00`, `${to}T23:59:59`).first(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(e.amount_cents),0) AS total FROM expenses e WHERE e.date>=? AND e.date<=?`
    ).bind(from, to).first(),
  ]);
  return c.json({
    collectionsCents: (collections as any)?.total ?? 0,
    expensesCents: (expenses as any)?.total ?? 0,
    netCents: ((collections as any)?.total ?? 0) - ((expenses as any)?.total ?? 0),
  });
});

// ── Credit Notes (Sales Returns) ──────────────────────────────────────────────
const creditNoteSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  items: z.array(z.object({
    variantId: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(),
    restock: z.boolean().default(true),
  })).min(1),
});
app.post("/api/credit-notes", async (c) => {
  const denied = await guard(c, "invoices.create");
  if (denied) return denied;
  const d = await json(c, creditNoteSchema), db = c.env.DB, p = current(c);
  const invoice = await db.prepare("SELECT * FROM invoices WHERE id=?").bind(d.invoiceId).first() as any;
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (invoice.status !== "posted") return c.json({ error: "Invoice is not posted" }, 400);
  const totalCents = d.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  if (totalCents <= 0) return c.json({ error: "Total must be positive" }, 400);
  const id = uuid();
  const num = `CN-${Date.now().toString(36).toUpperCase()}`;
  const stmts = [
    db.prepare("INSERT INTO credit_notes VALUES(?,?,?,?,?,?,?,?,?)").bind(
      id, num, d.invoiceId, invoice.customer_id, d.reason, totalCents, "posted", p.id, now()
    ),
    db.prepare("UPDATE invoices SET paid_cents=MIN(total_cents, paid_cents+?) WHERE id=?").bind(totalCents, d.invoiceId),
  ];
  for (const item of d.items) {
    const lineCents = item.quantity * item.unitPriceCents;
    stmts.push(db.prepare("INSERT INTO credit_note_items VALUES(?,?,?,?,?,?)").bind(
      uuid(), id, item.variantId, item.quantity, item.unitPriceCents, lineCents
    ));
    if (item.restock) {
      stmts.push(db.prepare(
        "INSERT INTO stock_balances VALUES('main',?,?) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET quantity=quantity+excluded.quantity"
      ).bind(item.variantId, item.quantity));
    }
  }
  await db.batch(stmts);
  await audit(db, p.id, "credit_note.created", id);
  return c.json({ id, number: num }, 201);
});
app.get("/api/credit-notes", async (c) => {
  const denied = await guard(c, "invoices.view");
  if (denied) return denied;
  const rows = await c.env.DB.prepare(
    `SELECT cn.*,c.shop_name,u.name AS created_by_name FROM credit_notes cn
     JOIN customers c ON c.id=cn.customer_id LEFT JOIN users u ON u.id=cn.created_by
     ORDER BY cn.created_at DESC LIMIT 200`
  ).all();
  return c.json(rows.results);
});

// ── Customer PATCH (edit whatsapp / credit) ───────────────────────────────────
app.patch("/api/customers/:id", async (c) => {
  const denied = await guard(c, "customers.edit");
  if (denied) return denied;
  const db = c.env.DB, p = current(c), id = c.req.param("id");
  const d = await json(c, z.object({
    shopName: z.string().trim().min(1).max(180).optional(),
    ownerName: z.string().trim().min(1).max(180).optional(),
    phone: z.string().max(40).optional(),
    whatsapp: z.string().max(40).optional(),
    address: z.string().max(300).optional(),
    location: z.string().max(180).optional(),
    type: z.enum(["wholesale","retail"]).optional(),
    creditLimitCents: z.number().int().nonnegative().optional(),
    creditDays: z.number().int().nonnegative().max(45).optional(),
    active: z.number().int().optional(),
  }));
  const sets: string[] = [], vals: (string|number)[] = [];
  if (d.shopName !== undefined) { sets.push("shop_name=?"); vals.push(d.shopName); }
  if (d.ownerName !== undefined) { sets.push("owner_name=?"); vals.push(d.ownerName); }
  if (d.phone !== undefined) { sets.push("phone=?"); vals.push(d.phone); }
  if (d.whatsapp !== undefined) { sets.push("whatsapp=?"); vals.push(d.whatsapp); }
  if (d.address !== undefined) { sets.push("address=?"); vals.push(d.address); }
  if (d.location !== undefined) { sets.push("location=?"); vals.push(d.location); }
  if (d.type !== undefined) { sets.push("type=?"); vals.push(d.type); }
  if (d.creditLimitCents !== undefined) { sets.push("credit_limit_cents=?"); vals.push(d.creditLimitCents); }
  if (d.creditDays !== undefined) { sets.push("credit_days=?"); vals.push(d.creditDays); }
  if (d.active !== undefined) { sets.push("active=?"); vals.push(d.active); }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);
  await db.prepare(`UPDATE customers SET ${sets.join(",")} WHERE id=?`).bind(...vals, id).run();
  await audit(db, p.id, "customer.updated", id);
  return c.json({ ok: true });
});

// ── Reports: add free-issues and expenses reports ─────────────────────────────
app.get("/api/reports/cashbook", async (c) => {
  const denied = await guard(c, "reports.view");
  if (denied) return denied;
  const from = c.req.query("from") || "2000-01-01",
    to = c.req.query("to") || "2100-01-01";
  const [payments, expenses] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.created_at AS date,'payment' AS type,i.number AS ref,p.method,p.amount_cents AS amount
       FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.created_at>=? AND p.created_at<=? ORDER BY p.created_at DESC LIMIT 500`
    ).bind(`${from}T00:00:00`, `${to}T23:59:59`).all(),
    c.env.DB.prepare(
      `SELECT e.created_at AS date,'expense' AS type,e.description AS ref,e.method,e.amount_cents AS amount FROM expenses e WHERE e.date>=? AND e.date<=? ORDER BY e.created_at DESC LIMIT 500`
    ).bind(from, to).all(),
  ]);
  const rows = [...(payments.results as any[]), ...(expenses.results as any[])];
  rows.sort((a,b) => b.date.localeCompare(a.date));
  return c.json(rows);
});

app.get("/api/reminders", async (c) => {
  const denied = await guard(c, "dashboard.view");
  if (denied) return denied;
  const p = current(c);
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT r.*,i.number,i.total_cents-i.paid_cents AS outstanding_cents FROM reminders r JOIN invoices i ON i.id=r.invoice_id WHERE (?=1 OR i.rep_id=?) ORDER BY r.created_at DESC LIMIT 100`,
      )
        .bind(p.admin, p.id)
        .all()
    ).results,
  );
});
app.onError((err, c) => {
  console.error(err);
  if (err instanceof z.ZodError || (err as any)?.name === "ZodError")
    return c.json(
      {
        error: "Invalid input",
        issues: (err as any).issues?.map((x: any) => ({
          path: x.path,
          message: x.message,
        })),
      },
      400,
    );
  return c.json({ error: "Request could not be completed" }, 500);
});
export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledEvent,
    env: Env["Bindings"],
    ctx: ExecutionContext,
  ) => {
    ctx.waitUntil(processReminders(env.DB));
  },
};
