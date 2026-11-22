# Sanjeewa Distribution ERP

Cloudflare D1 and Workers API, with a mobile responsive Next.js static frontend. Sri Lanka currency is stored as **integer cents** and displayed in LKR. Business identity is loaded from `business_settings`.

## Implemented

- One-time admin setup guarded by a Worker secret; PBKDF2 password hashes; HTTP-only session cookies; account deactivation revokes sessions; admin password reset and self-service change password.
- Server-enforced roles and per-user permission overrides, customer ownership checks, and warehouse ownership checks for Sales Representatives.
- Product variants, customer registry, stock adjustments and transfers, immutable posted invoice items, stock deduction, invoice cancellation before any payment, initial collections, partial payments and credit limit checks.
- Admin and Sales Representative dashboards with live D1 data, empty states, responsive navigation and reduced-motion support.
- 14-day-before-due dashboard reminder records via daily Cloudflare Cron Trigger; idempotent reminder index.
- Gross profit, invoiced and outstanding report API. Unit tests for integer financial calculations and credit dates.

## Setup

1. `npm install`
2. `npx wrangler d1 create sanjeewa-erp` in `worker/`; replace `REPLACE_WITH_D1_DATABASE_ID` in `worker/wrangler.jsonc`.
3. `npm run db:migrate:local -w worker` for local development; `npm run db:migrate:remote -w worker` for the hosted database.
4. Set `SETUP_TOKEN` using `npx wrangler secret put SETUP_TOKEN` for production. For local development put it in `worker/.dev.vars`, excluded from Git. Use a long random value. No password or token belongs in source control.
5. Set `FRONTEND_ORIGIN` to the exact frontend origin in `worker/wrangler.jsonc`; set `NEXT_PUBLIC_API_URL` in `web/.env.local` for the frontend build. For browser cookies, host both origins under the same registrable domain over HTTPS, such as `erp.example.lk` and `api.example.lk`.
6. Start `npm run dev -w worker` and `npm run dev -w web`. For one-time setup, POST `/api/setup` with `X-Setup-Token` and JSON `{ "name":"Admin", "email":"admin@example.lk", "password":"a-strong-unique-password" }` and `Origin` matching `FRONTEND_ORIGIN`. The endpoint rejects subsequent setup once any account exists.
7. `npm run typecheck && npm test && npm run build`. Deploy the Worker with `npm run deploy -w worker`. Deploy `web/out/` as a static Cloudflare Pages site and set the build environment variable before building. Apply migrations **before** publishing the Worker.

## Operations and limits

The frontend is statically exported Next.js App Router pages; the API is a separate Worker. This avoids requiring Next.js server APIs in the Worker. D1 batch writes are atomic, and SQL constraints/triggers enforce stock and payment limits. Deploy migrations before the new Worker version. Backup with `npx wrangler d1 export sanjeewa-erp --remote --output backup.sql` to a restricted location; test restores in a separate staging D1 database before any production recovery. Keep backups outside the public web root and record migration versions during restoration.

**Remaining before production use:** PDF invoice and CSV exports; complete profit/collection and per-product reports; accessible invoice link and WhatsApp sharing; barcode scanning; account recovery workflow; configurable role permissions UI; full integration/concurrency tests against D1; service worker icons; security review and staging load test. No production account or database has been configured from this repository alone. Do not enter live financial data before those checks and a backup policy are complete.
