# Sanjeewa Distribution ERP

Cloudflare D1 and a Hono Workers API, with a mobile responsive Next.js 16 static frontend served by the same Worker. Sri Lanka currency is stored as **integer cents** and displayed in LKR. Business identity is loaded from `business_settings`.

## Implemented

- One-time admin setup guarded by a Worker secret; PBKDF2 password hashes; HTTP-only session cookies; account deactivation revokes sessions; admin password reset and self-service change password.
- Server-enforced roles and per-user permission overrides, customer ownership checks, and warehouse ownership checks for Sales Representatives.
- Product variants, customer registry, stock adjustments and transfers, immutable posted invoice items, stock deduction, invoice cancellation before any payment, initial collections, partial payments and credit limit checks.
- Admin and Sales Representative dashboards with live D1 data, empty states, responsive navigation and reduced-motion support.
- 14-day-before-due dashboard reminder records via daily Cloudflare Cron Trigger; idempotent reminder index.
- Gross profit, invoiced and outstanding report API, operational CSV exports, browser PDF invoice download and WhatsApp click-to-chat invoice summaries. Unit tests for integer financial calculations and credit dates.

## Setup

1. Run `npm ci` from the repository root.
2. Apply migrations locally with `npm run db:migrate:local -w worker` or to the configured production D1 database with `npm run db:migrate:remote -w worker`.
3. Set `SETUP_TOKEN` using `npx wrangler secret put SETUP_TOKEN` for production. For local development put it in `.dev.vars`, excluded from Git. Use a long random value. No password or token belongs in source control.
4. Run `npm run typecheck && npm test && npm run build`.
5. Run the combined frontend/API locally with `npm run preview` and deploy it with `npm run deploy`.
6. For one-time setup, POST `/api/setup` with `X-Setup-Token` and JSON `{ "name":"Admin", "email":"admin@example.lk", "password":"a-strong-unique-password" }` and a same-origin `Origin` header. The endpoint rejects subsequent setup once any account exists.

### Cloudflare Workers Builds

Connect `raveenn10-bit/Erp-system`, branch `main`, and keep the repository root as the build root.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler preview`

The tracked root `wrangler.jsonc` deploys the Hono API and `web/out` static export as one Worker named `sanjeewa-distribution-erp`. `NEXT_PUBLIC_API_URL` is intentionally optional because production API calls are same-origin. If a separate frontend origin is introduced, configure its exact origin in the `FRONTEND_ORIGIN` runtime variable.

## Operations and limits

The frontend uses supported Next.js static export output, so no Next.js server adapter is required. Wrangler uploads `web/out` as Worker static assets and routes `/api/*` to the existing Hono Worker. D1 batch writes are atomic, and SQL constraints/triggers enforce stock and payment limits. Deploy migrations before the new Worker version. Backup with `npx wrangler d1 export sanjeewa-erp-db --remote --output backup.sql` to a restricted location; test restores in a separate staging D1 database before any production recovery. Keep backups outside the public web root and record migration versions during restoration.

**Remaining before production use:** Accessible invoice link or official WhatsApp messaging integration; barcode scanning; account recovery workflow; configurable role permissions UI; full integration/concurrency tests against D1; service worker and PWA icons; security review and staging load test. No production account or database has been configured from this repository alone. Do not enter live financial data before those checks and a backup policy are complete.
