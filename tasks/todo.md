# Sponsoric — Roadmap to Production

Status: `[x]` done · `[~]` partial · `[ ]` todo (external / needs your accounts)

## Phase 0 — Proof of Concept (DONE)
- [x] Verify statusline + hooks are the real mechanism (MCP can't see turn state)
- [x] Statusline ad surface, detached refresher, privacy client, setup writer
- [x] Plugin manifest + wait-timing hooks
- [x] Smoke test + MOCK end-to-end render

## Phase 1 — Backend (DONE as reference impl)
- [x] Persistent store (`server/store.js`, atomic JSON writes)
- [x] `/ad/next`, `/impression`, `/session/init`, `/earnings`, `/payout`, `/campaign`, `/health`
- [x] Rate limiting (per-IP/sec), server-side dedupe, per-session daily impression cap
- [x] Per-publisher secret auth on all scoped endpoints (register → key); no credit/earnings/payout without it
- [x] Fixed security-review findings: payout redirection, earnings enumeration (IDOR), default admin token (see SECURITY.md)
- [x] Campaign-based ad serving + budget decrement (house-ad fill)
- [x] Backend test suite (`test/backend.js`)
- [~] Data store — JSON file works single-node; swap for Postgres for prod (interface documented in docs/DEPLOY.md)
- [x] Serverless deploy adapter (`api/index.js` + `vercel.json`) + Dockerfile
- [x] Advertiser stats endpoint (`GET /campaign/stats`)
- [x] Configurable rate limit + explicit 429 test; offline-resilience test (renders cached ad when backend down)
- [ ] Deploy to prod (Vercel/Docker) — **needs your hosting account** (adapter ready)

## Phase 2 — Economics (DONE as reference impl)
- [x] Advertiser campaign create + review gate (pending→approved)
- [x] Fixed-CPM fill + revenue split (configurable)
- [x] Stripe payout adapter (`lib/stripe.js`) — real transfers with key, simulated without
- [x] Payout endpoint + min-threshold enforcement + payout ledger
- [x] Earnings/payout dashboard (`web/dashboard.html`)
- [ ] Validate advertiser demand — **business, pre-sell before scaling**
- [ ] Stripe Connect onboarding for real payouts — **needs live Stripe account + KYC**

## Phase 3 — Client hardening (DONE)
- [x] Config file `~/.sponsoric/config.json` (env overrides config)
- [x] Offline backoff after repeated fetch failures
- [x] `--chain` mode to keep an existing statusline
- [x] `--doctor` diagnostics command
- [x] Client unit tests (hash, config precedence, backoff, chaining)
- [x] CI workflow (Node 18/20/22, manifest validation)
- [~] Windows path handling — quoted/forward-slash paths written; verify on a real Windows box

## Phase 4 — Compliance (DONE as drafts)
- [x] PRIVACY.md, TERMS.md, AD_POLICY.md, SECURITY.md
- [x] Threat model + pre-launch security checklist
- [ ] Confirm Anthropic marketplace allows ad/monetization plugins — **ask before submitting**
- [ ] Legal review of privacy/terms — **needs counsel**

## Phase 5 — Distribution (DONE as artifacts)
- [x] `.claude-plugin/marketplace.json` (passes `claude plugin validate`)
- [x] Landing page (`web/index.html`)
- [x] Docs: README, DEPLOY, backend contract
- [ ] Publish repo public under Cognifer Labs — **needs your GitHub org**
- [ ] `npm publish sponsoric` — **needs your npm account** (test `npx` from clean machine after)
- [ ] Submit to community plugin registry — **after Phase 4 policy check**

## Phase 6 — Launch (DONE as materials)
- [x] Launch copy: Product Hunt, HN, X (`LAUNCH.md`), honest framing
- [ ] Beta cohort (10–50 devs), measure fill/earnings/churn — **after deploy**
- [ ] Lock v1.0.0 + launch — **after beta**

## Critical path to a real dollar (all external now)
1. Deploy backend + Postgres (your hosting)
2. Live Stripe Connect + one paying advertiser (your Stripe, business)
3. Anthropic marketplace policy confirmed OK

## What's proven locally today
- `npm test` — 4 suites green (smoke, client, backend, e2e)
- Real impression settles end-to-end: $0.0014 credited, throttle + dedupe + cap enforced
- Payout flow works (Stripe simulated without a key)
- `claude plugin validate .` passes
