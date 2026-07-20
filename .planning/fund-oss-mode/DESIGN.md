# DESIGN — Cogwait Fund-OSS Mode

**Status:** validated design, ready for planning · **Owner:** Cognifer Labs · **Date:** 2026-07-20
**Feature slug:** `fund-oss-mode`

---

## 1. Understanding summary

Fund-OSS mode lets a developer donate a **percentage** of their accrued Cogwait
balance to open source instead of cashing 100% to themselves. It reframes the
product from "ads in my terminal for pennies" to **"fund the OSS I depend on
while my agent thinks."**

- **Split at payout, server-enforced.** Balance divides `keep%` → dev's Stripe
  connected account (existing flow), `donate%` → a **directed transfer** to a
  Cogwait-run OSS fund. Reuses `lib/stripe.js` `transfer(pid, amount, {stripe_account})`.
- **Percentage is one config value** (`donate_pct`), stored server-side on the
  publisher record (client can't be trusted to move money), mirrored in
  `~/.cogwait/config.json` for display.
- **Local dependency attribution (npm, v1).** The client scans the current
  project's `package-lock.json` + `node_modules/*/package.json` `funding` fields,
  builds a dependency-weighted maintainer list, and renders a **receipt** —
  "your $6 represents these 8 maintainers." The scan is **local**; nothing but
  the existing anonymized impression payload ever leaves the machine.
- **Receipt is illustrative, not a payment ledger.** The transfer is pooled to
  the fund; the receipt is a representative snapshot of the OSS you build on, not
  a per-cent guarantee that maintainer X received money. Copy must say this.

### Assumptions
- Cogwait operates one fund destination (a Stripe connected account / org) as the
  pooled recipient (`COGWAIT_FUND_ACCOUNT`). Downstream redistribution to
  maintainers is a fund-operator concern, **out of scope for v1 code**, surfaced
  honestly in the UI — never faked.
- Dep scan runs **on demand** (payout time / dashboard / `npx cogwait --oss`),
  never in the hot `bin/statusline.js` path. It must never block the terminal.
- The receipt reflects the **current working directory's** project — a snapshot
  of "the OSS you're building on right now," not a precise allocation of each
  impression to the repo that earned it. Documented as such.

### Non-goals (v1)
- Direct per-maintainer transfers; GitHub Sponsors integration (no third-party
  "pay on behalf of" API exists); aggregator APIs (Open Collective / Drips /
  thanks.dev). All deferred to v2.
- pip / cargo / go / other ecosystems — **npm only** in v1.
- Cogwait as a money transmitter / regulated distributor.
- Desktop-app parity is phase 3, not a v1 blocker.

---

## 2. Approaches weighed

**A. Server-enforced split at payout + local attribution receipt — CHOSEN.**
The split happens where the money actually moves (`POST /payout`), so the client
never controls fund routing. Attribution is a pure client-side artifact, keeping
the privacy invariant intact. Reuses every existing rail (`stripeTransfer`,
balance model, payout ledger). Smallest trusted surface, real money moves now.

**B. Client computes split, sends two payout requests — REJECTED.**
Trusting the client to declare `donate_amount` lets a tampered client donate $0
while claiming the OSS-funder brand, or misroute funds. Money math must be
server-side. Violates the project's "server prices/moves, never trust the client"
principle (same rule that clamps impression levels in `server/index.js:169`).

**C. Attribution sent to server for a per-maintainer ledger — REJECTED.**
Would require uploading the dependency list — leaks what you're building.
Breaks the core "no payload" privacy promise (`lib/client.js` header comment,
PRIVACY.md). Attribution stays local.

---

## 3. Architecture

```
                       ┌─────────────────────────── LOCAL (nothing new leaves) ──┐
  cwd/package-lock.json│                                                          │
  cwd/node_modules/*   │  lib/oss.js          bin/oss.js / --oss                  │
   (funding fields) ───┼─▶ scanDeps() ─▶ weightFunding() ─▶ buildReceipt() ─▶ print receipt
                       │        └─ setDonatePct() ──POST /donate/config (auth)──┐ │
                       └───────────────────────────────────────────────────────┼─┘
                                                                                │
                        ┌──────────────────────── SERVER ──────────────────────▼─┐
                        │  POST /donate/config  → store.setDonatePct(pid, pct)    │
                        │  POST /payout         → split balance:                  │
                        │     keep   → transfer(pid, keep,   {stripe_account:acct})│
                        │     donate → transfer(pid, donate, {stripe_account:FUND})│
                        │     store.recordPayout({..kind:'cashout'|'donation'..}) │
                        │  GET  /earnings       → + donate_pct, donations[]        │
                        └─────────────────────────────────────────────────────────┘
```

The statusline hot path (`bin/statusline.js`, `lib/client.js` `getCachedAd`)
is **untouched**. All Fund-OSS work is on-demand or at payout.

---

## 4. Storage

Additions mirrored across `server/store-json.js`, `server/store-pg.js`,
`server/schema.sql`; parity enforced by the existing `test/store-interface.js`.

**`publishers`** — add `donate_pct` (numeric, **default `20`**, range 0–100).
Fund-OSS is **on by default** (per the `ui-redo` reposition); the dev dials it
down (to 0 = keep all). New publishers start at 20.
- `store-json.js`: add to the `publisher()` default record (`store-json.js:52`).
- `schema.sql`: `ALTER`/add column `donate_pct numeric NOT NULL DEFAULT 0`.
- New method `setDonatePct(pid, pct)` (clamped 0–100) in both stores.

**`payouts`** — add `kind` (`'cashout'` | `'donation'`) and `fund` (text, the
fund destination for donation rows; null for cashout).
- `store-json.js` `recordPayout` already stores an arbitrary object — pass the
  new fields through (`store-json.js:91`).
- `schema.sql`: `kind text NOT NULL DEFAULT 'cashout'`, `fund text`.
- `payoutsFor(pid)` unchanged; callers filter by `kind` for display.

No new tables. Donations are payout rows with `kind:'donation'`.

---

## 5. API surface (`server/index.js`)

**New env:** `COGWAIT_FUND_ACCOUNT` (Stripe connected account for the pooled OSS
fund). If unset, donation legs are **simulated** exactly like `lib/stripe.js`
already simulates transfers without a key — the flow stays testable.

**`POST /donate/config`** (authenticated, `authPublisher`):
- Body `{ donate_pct }`; clamp to integer 0–100; `store.setDonatePct(pid, pct)`.
- Returns `{ ok, donate_pct }`. Mirrors into client config on the CLI side.

**`POST /payout`** (modify existing, `server/index.js:188`):
- Threshold check on **total** balance unchanged (`MIN_PAYOUT_USD`).
- Compute `donate = round(balance * pct/100)`, `keep = round(balance - donate)`.
- `keep > 0` → `stripeTransfer(pid, keep, { stripe_account: pub.stripe_account })`
  → `recordPayout({ pid, amount_usd: keep, kind:'cashout', ... })`.
- `donate > 0` → `stripeTransfer(pid, donate, { stripe_account: FUND })`
  → `recordPayout({ pid, amount_usd: donate, kind:'donation', fund: FUND, ... })`.
- Only after both legs succeed: `store.setBalance(pid, 0)`. If the donation leg
  fails, do **not** zero the balance (no silent loss) — return `502`, both legs
  retried next call. (Detail: idempotency across a partial two-leg payout is an
  open item — see §9.)
- Response: `{ ok, paid_usd: keep, donated_usd: donate, transfers:{cashout, donation}, simulated }`.

**`GET /earnings`** (extend, `server/index.js:178`): add `donate_pct` and the
donation subset of the ledger so the dashboard can show "funded to date."

---

## 6. Client — dependency scan & receipt

**New module `lib/oss.js`** (pure, dependency-free, local-only, no network):

- `scanDeps(cwd)` — read `cwd/package-lock.json` (v2/v3 `packages` map; fall back
  to `package.json` deps if no lockfile). For each resolved package, read its
  `node_modules/<name>/package.json` `funding` field.
- `normalizeFunding(field)` — npm `funding` is a string, `{type,url}`, or an
  array of either → normalize to a de-duped list of URLs.
- `weightFunding(deps)` — each package contributes 1 share to each of its funding
  URLs (split evenly if it declares several). Sum shares per URL → normalize to
  percentages. A maintainer funding many of your deps ranks higher.
- `buildReceipt(weights, donateAmountUsd)` — allocate the donate dollars across
  the weighted URLs; return `{ totalUsd, maintainers:[{url, name, pct, usd}], coverage }`
  where `coverage` = share of your deps that declare *any* funding target
  (honesty: most won't — show the real number).
- Guard rails: bounded file reads, ignore unreadable/oversized manifests, hard
  cap on packages scanned, no symlink traversal outside `node_modules`.

**New CLI `bin/oss.js`** wired into the existing arg router (alongside
`--register`, `--doctor`, `--level` in `bin/`):
- `npx cogwait --oss` → run the scan for `cwd`, print the receipt (uses the live
  `donate_pct` and current balance from `/earnings` for the dollar figures, or a
  neutral "% breakdown" if offline).
- `npx cogwait --donate <pct>` → validate 0–100, write `donate_pct` to
  `~/.cogwait/config.json`, and sync to the server via `POST /donate/config`.

**`lib/client.js`** — add `DONATE_PCT` to the config load (`client.js:24`
precedence block) for display; add a thin `setDonatePct(pct, cb)` that POSTs to
`/donate/config`. Statusline path stays untouched.

---

## 7. UI

**`web/dashboard.html`** (v1): a "Fund open source" card — donate-% slider (0–100),
"funded to date" from `/earnings` donations, and the receipt table (maintainer,
%, $) from a `lib/oss.js` scan. Honest caption: pooled-fund + snapshot disclaimer.

**Desktop app `app/`** (phase 3, not a v1 blocker): a Fund-OSS section mirroring
the web card. New Rust command to set `donate_pct` (held Rust-side like the key)
and run the scan. Reuses the shared level/render mirroring pattern already in the app.

---

## 8. Testing

- **`test/oss.js`** (new): fixture project trees → `scanDeps`/`normalizeFunding`
  (all three `funding` shapes) / `weightFunding` (multi-URL split, ranking) /
  `buildReceipt` (dollar allocation sums to donate total, `coverage` correct).
  Edge cases: no lockfile, no funding fields anywhere (coverage 0), malformed
  manifest, cyclic/duplicate deps.
- **`test/backend.js`** (extend): `POST /donate/config` clamps; `/payout` split
  math (keep+donate = balance, rounding); donation leg → `kind:'donation'` row;
  fund transfer simulated without `COGWAIT_FUND_ACCOUNT`; partial-failure does
  **not** zero balance; `/earnings` returns `donate_pct` + donations.
- **`test/adapter.js` / `test/store-interface.js`**: `setDonatePct` + payout-kind
  parity across JSON and Postgres stores.
- **Privacy regression:** assert no dependency names/paths appear in any outbound
  request body (extend the existing no-payload assertions).

---

## 9. Decision log

| # | Decision | Alternatives | Why |
|---|----------|-------------|-----|
| 1 | Payout rail = directed Stripe transfer to a pooled fund/charity account | Aggregator API (Open Collective/Drips/thanks.dev); Cogwait-run distribution pool | *Delegated → user chose.* Ships on today's `stripeTransfer` code; no money-transmitter burden; real money moves in v1. Aggregators/direct = v2. |
| 2 | GitHub Sponsors NOT the rail | User's original framing | No third-party "pay on behalf of" API exists. Honesty over the nice-sounding label. |
| 3 | Allocation = percentage split (`donate_pct`), **default 20% (on)** | All-or-nothing toggle; round-up dust; default-off | *User chose split + default-on.* One config value, flexible, reuses the balance model. Default-on funds OSS out of the box; dev lowers it freely. |
| 4 | Split enforced **server-side** at `/payout` | Client computes & sends split | Client can't be trusted to move money; matches the existing "server prices, never trust client" rule. |
| 5 | Dep attribution = **local** scan + receipt, npm first | Upload dep list for a server ledger; defer attribution to v2 | *User chose include.* Keeps the "no payload" privacy invariant; the local receipt is the actual differentiator vs generic "donate to charity." |
| 6 | Receipt is illustrative (pooled transfer), scoped to **cwd** | Per-impression per-repo precise ledger | Precise allocation is infeasible and over-honest-cost; snapshot is truthful if labeled. Copy must not claim maintainer X *received* money. |
| 7 | Donations stored as `payouts` rows with `kind` | New `donations` table | Reuses ledger, dedupe, and `payoutsFor`; one column, not a table. |
| 8 | Fund destination via `COGWAIT_FUND_ACCOUNT`, simulated when unset | Hardcode; require live account for tests | Matches `lib/stripe.js` simulate-without-key pattern; flow testable offline. |

---

## 10. Open items for implementation planning

- **Two-leg payout idempotency.** If the cashout leg succeeds and the donation
  leg fails, balance is untouched and a retry re-sends both — double cashout risk.
  Needs a per-leg settled marker or a Stripe idempotency key before the split
  ships to prod. (Planner: pin the mechanism.)
- **Fund redistribution model** — how the pooled fund actually reaches
  maintainers (business/ops, not v1 code). UI must state "pooled, redistributed
  by the Cogwait OSS fund" and not overclaim.
- **Charity vs OSS-fund choice** — v1 is a single fund destination; letting the
  dev pick among several funds/charities is a natural v1.1 config extension.
- **Tax-receipt handling** if any destination is a registered charity.
- **Ecosystem expansion** — pip (`requirements`/`poetry.lock`), cargo
  (`Cargo.lock` + crates funding), go — v2, behind the same `lib/oss.js` shape.
- **Min-transfer floors** — Stripe has practical minimums; a tiny `keep` or
  `donate` leg may be below them. Decide: carry sub-floor legs to next payout.
```
