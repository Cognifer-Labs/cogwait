# Deploying the Cogwait backend

The backend in `server/` is a Node HTTP server that **auto-selects its store**:
a file-backed JSON store for single-node self-host/local, or **Postgres** the
moment `DATABASE_URL` is set (multi-instance / serverless safe). Impression
dedupe and the per-session daily cap are atomic in the Postgres path, so
horizontally scaled instances can't double-bill.

## 1. Run it (self-host / VM / container)

Single node, file store (no database):

```bash
COGWAIT_ADMIN_TOKEN="$(openssl rand -hex 16)" \
STRIPE_SECRET_KEY=sk_live_... \
PORT=8787 \
node server/index.js
```

Production, Postgres-backed (schema is created automatically on first start;
`server/schema.sql` is provided for manual provisioning). `pg` is an optional
dependency — `npm install` pulls it:

```bash
DATABASE_URL="postgres://user:pass@host:5432/cogwait?sslmode=require" \
COGWAIT_ADMIN_TOKEN="$(openssl rand -hex 16)" \
STRIPE_SECRET_KEY=sk_live_... \
node server/index.js
# → logs: backend on http://localhost:8787 (store=postgres, ...)
```

Docker:

```bash
docker build -t cogwait-backend .
docker run -p 8787:8787 --env-file .env cogwait-backend
```

## 2. Production swaps

| Concern | PoC (now) | Production |
| --- | --- | --- |
| Store | JSON file (`store-json.js`, default) | **Postgres (`store-pg.js`) — done; set `DATABASE_URL`.** Same async interface, enforced by `test/store-interface.js` |
| Payouts | `lib/stripe.js` (simulated when no key) | Stripe Connect: `POST /connect/onboard` creates an AccountLink and stores the connected-account id; `POST /payout` transfers to it. Set `STRIPE_SECRET_KEY` + `COGWAIT_CONNECT_RETURN`/`_REFRESH` URLs |
| Ad serving | in-memory house ads + campaigns | real campaign DB, targeting, budget pacing, review queue |
| Fraud | dedupe + per-session daily cap + rate limit | + IP reputation, publisher velocity anomaly detection, viewability sampling |
| Auth | `Authorization: Publisher <id>` + admin token | signed publisher tokens (rotate), scoped advertiser keys |

The store interface is small and async (`init`, `publisher`, `getPublisher`,
`creditImpression`, `impressionsInWindow`, `dedupeSeen`, `addCampaign`,
`getCampaign`, `allCampaigns`, `activeCampaigns`, `spendCampaign`, `recordPayout`,
`payoutsFor`, `setBalance`, `setStripeAccount`, `close`). Both backends implement
it identically — add another (e.g. a different DB) by matching the same members;
`test/store-interface.js` fails the build if they drift.

## 3. Vercel option

Wrap `server/index.js` as a single Fluid Compute function and route all paths to
it, or split each endpoint into `api/*`. Move the store to a Marketplace
Postgres and secrets to `vercel env`. See the project's Vercel skills for the
current `vercel.ts` config shape. The in-memory `rate`/`dedupe` maps must move to
a shared store (Redis/Postgres) once you run more than one instance.

## Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8787 | Listen port |
| `COGWAIT_CPM` | 2 | Advertiser price per 1000 views (USD) |
| `COGWAIT_SHARE` | 0.7 | Publisher revenue share (0–1) |
| `COGWAIT_MIN_PAYOUT` | 10 | Minimum balance before payout (USD) |
| `COGWAIT_ADMIN_TOKEN` | — (required) | `x-admin-token` for campaign endpoints; refuses to start if unset/`dev-admin` |
| `COGWAIT_DATA_DIR` | `~/.cogwait/server` | JSON store location (ignored when `DATABASE_URL` is set) |
| `DATABASE_URL` | — | Postgres connection string; when set, the store switches to Postgres |
| `PGSSL` | verify | `disable` (no TLS, local), `no-verify` (encrypt, skip verify — MITM risk) |
| `PGSSLROOTCERT` | — | Path to a CA cert to verify the DB's TLS (preferred for hosted PG) |
| `PGPOOL_MAX` | 10 | Max Postgres pool connections |
| `STRIPE_SECRET_KEY` | — | Live Stripe key; absent → payouts simulated |
