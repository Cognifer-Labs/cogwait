# Deploying the Sponsoric backend

The reference backend in `server/` is a dependency-free Node HTTP server with a
file-backed store. It runs as-is for self-hosting and local testing. For
production, do the three swaps below.

## 1. Run it (self-host / VM / container)

```bash
SPONSORIC_CPM=2 \
SPONSORIC_SHARE=0.7 \
SPONSORIC_MIN_PAYOUT=10 \
SPONSORIC_ADMIN_TOKEN="$(openssl rand -hex 16)" \
STRIPE_SECRET_KEY=sk_live_... \
PORT=8787 \
node server/index.js
```

Docker:

```bash
docker build -t sponsoric-backend .
docker run -p 8787:8787 --env-file .env sponsoric-backend
```

## 2. Production swaps

| Concern | PoC (now) | Production |
| --- | --- | --- |
| Store | `server/store.js` (JSON file) | Postgres — reimplement the same exported functions with SQL + migrations |
| Payouts | `lib/stripe.js` (simulated when no key) | Stripe Connect: `POST /connect/onboard` creates an AccountLink and stores the connected-account id; `POST /payout` transfers to it. Set `STRIPE_SECRET_KEY` + `SPONSORIC_CONNECT_RETURN`/`_REFRESH` URLs |
| Ad serving | in-memory house ads + campaigns | real campaign DB, targeting, budget pacing, review queue |
| Fraud | dedupe + per-session daily cap + rate limit | + IP reputation, publisher velocity anomaly detection, viewability sampling |
| Auth | `Authorization: Publisher <id>` + admin token | signed publisher tokens (rotate), scoped advertiser keys |

The store interface is deliberately small (`publisher`, `creditImpression`,
`addCampaign`, `activeCampaigns`, `spendCampaign`, `recordPayout`,
`impressionsInWindow`). Keep the signatures; change the bodies.

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
| `SPONSORIC_CPM` | 2 | Advertiser price per 1000 views (USD) |
| `SPONSORIC_SHARE` | 0.7 | Publisher revenue share (0–1) |
| `SPONSORIC_MIN_PAYOUT` | 10 | Minimum balance before payout (USD) |
| `SPONSORIC_ADMIN_TOKEN` | dev-admin | Required (`x-admin-token`) to create campaigns |
| `SPONSORIC_DATA_DIR` | `~/.sponsoric/server` | Store location |
| `STRIPE_SECRET_KEY` | — | Live Stripe key; absent → payouts simulated |
