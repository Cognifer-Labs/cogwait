# Cogwait — Roadmap to Production

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
- [x] Data store — JSON file (single-node) + **Postgres adapter** (`store-pg.js`, auto-selected on `DATABASE_URL`); atomic dedupe + daily cap; parity enforced by `test/store-interface.js`
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
- [x] Config file `~/.cogwait/config.json` (env overrides config)
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
- [ ] `npm publish cogwait` — **needs your npm account** (test `npx` from clean machine after)
- [ ] Submit to community plugin registry — **after Phase 4 policy check**

## Phase 6 — Launch (DONE as materials)
- [x] Launch copy: Product Hunt, HN, X (`LAUNCH.md`), honest framing
- [ ] Beta cohort (10–50 devs), measure fill/earnings/churn — **after deploy**
- [ ] Lock v1.0.0 + launch — **after beta**

## Phase 7 — Cogwait Desktop (Tauri control panel) — DONE (v1)
Unifies the scattered `bin/*` CLI + `web/*` pages into one native GUI. It is a
**companion**, not the ad surface — the statusline hook stays the money-making
mechanism (a desktop window can't inject into Claude Code's status row).
- [x] Scaffold Tauri v2 app in `app/` (vanilla-TS + Vite frontend, Rust backend)
- [x] Rust commands: read/write `~/.cogwait/config.json` (0600), detect/patch
      `~/.claude/settings.json` statusLine (install/uninstall), call the API
      (earnings/payout/register/connect) with the key held Rust-side
- [x] UI: Status (doctor checks + install toggle + preview), Earnings (balance/
      payout/history/Stripe), Ad Level (0–3 picker w/ live sponsor-line preview +
      CPM/earn), Setup (payout id, register, pause, mock, CLI path), About/privacy
- [x] Shares the level model + sponsor-line rendering with the CLI (mirrors truth)
- [x] Compiles clean (cargo check + vite build), `npm run tauri dev` launches
- [x] Honest-earnings framing (tier CPMs, demand caveat) in the UI
- [x] Production hardening: brand icons (icon-src.svg → all sizes), strict CSP,
      bundle metadata (category/publisher/copyright/min-OS), release profile
      (LTO/strip/opt-s), prod API default (api.cogwait.io)
- [x] `tauri build` → Cogwait.app (4.5M) + verified .dmg (3.0M) produced
- [ ] Apple Developer ID signing + notarization — **needs your signing cert**

---

## Phase 8 — Fund-OSS Mode

**Goal:** a publisher can set `donate_pct` (0–100), and at `/payout` their balance
splits server-side into a cashout transfer (existing flow) + a directed transfer
to the pooled `COGWAIT_FUND_ACCOUNT`, recorded as `kind:'donation'` payout rows;
the CLI/dashboard can run a local npm dependency scan and print an honest
"receipt" of the maintainers your donated dollars represent — with no dependency
data ever leaving the machine, and no double-cashout possible on a retried
partial payout.

Design is locked: `.planning/fund-oss-mode/DESIGN.md`. Decision log (§9) is not
up for debate here — rail (directed Stripe transfer to a pooled fund), split
model (`donate_pct`, server-enforced), local-only attribution, and payout-row
storage shape are fixed. Steps below only decide *how* to build what's already
decided, plus **pin the mechanism for the one open item (§10): two-leg payout
idempotency.**

Tag on every step: **[money]** = touches `/payout`, Stripe, or balance —
concentrate review effort here. **[local]** = pure local computation, no payout
math, lower risk.

### 8.0 — Idempotency mechanism (pin before touching `/payout`) [money, design-only]
Open item from DESIGN.md §10: cashout leg succeeds, donation leg fails → balance
untouched → naive retry recomputes `keep`/`donate` from the (still non-zero)
balance and could resend the already-succeeded cashout.

**Alternatives weighed:**
- *Stripe `Idempotency-Key` alone* — dedupes Stripe-side retries of the exact
  same call, but doesn't stop **our own code** from issuing a *new* transfer
  call for an already-settled leg on the next `/payout` invocation, and gives no
  protection on the JSON store's simulated (no-key) path — fails the
  simulate-without-key parity invariant.
- *Per-leg settled marker only* — solves our own retry logic, but doesn't cover
  the case where our process dies after Stripe accepted the transfer but before
  we recorded it (Stripe-side retry still needed).
- *Both, combined* — **chosen.** The persisted marker is the source of truth for
  "did we already decide to attempt this leg," the Stripe idempotency key is the
  belt-and-suspenders for "did Stripe already receive this exact request."

**Concrete mechanism:**
1. `payouts` rows gain `id` (new — see 8.1), `status` (`'pending'|'settled'`,
   default `'settled'` for backward compat with pre-fund-oss rows), and
   `idempotency_key` (text).
2. `POST /payout` first calls a new `store.pendingPayoutsFor(pid)`. If pending
   rows already exist for this publisher, this is a **resume**: reuse their
   fixed `amount_usd`/`kind`/`idempotency_key` — do **not** recompute
   keep/donate from the current balance (balance hasn't moved; recomputing
   risks drift if `donate_pct` changed mid-flight).
3. If no pending rows exist, this is a **fresh** payout: snapshot the balance,
   compute `keep`/`donate` once, and **insert the pending row(s) before calling
   Stripe** (`store.recordPayout({..., status:'pending', idempotency_key})`) —
   durable before any network call, so a crash mid-transfer is safely resumable.
4. Attempt only legs not yet `'settled'`. Pass `idempotency_key` through to
   `stripeTransfer` → `lib/stripe.js` `transfer()` → forwarded as the Stripe
   `Idempotency-Key` header. On success: `store.settlePayout(id, {transfer, simulated})`.
   On failure: return `502` immediately; rows stay `'pending'`, safely retryable.
5. Only when **every** applicable leg (cashout if `keep>0`, donation if
   `donate>0`) is `'settled'` → `store.setBalance(pid, 0)`.
6. `payoutsFor(pid)` / `GET /earnings` filter to `status:'settled'` only — an
   in-flight pending row is never shown as a finished payout.

This directly kills the double-cashout scenario: on retry, the cashout row is
already `'settled'` → skipped; only the donation leg is retried.

### 8.1 — Storage + parity [local — schema/store only, no money movement]
- [ ] `server/schema.sql`: on `publishers`, add `donate_pct numeric NOT NULL
      DEFAULT 0`. On `payouts`, add `kind text NOT NULL DEFAULT 'cashout'`,
      `fund text`, `status text NOT NULL DEFAULT 'settled'`, `idempotency_key text`.
      Add `CREATE INDEX IF NOT EXISTS idx_payouts_pid_status ON payouts (pid, status);`
      for the pending-lookup query.
- [ ] `server/store-pg.js`: the `SCHEMA` const uses `CREATE TABLE IF NOT EXISTS`,
      which does **not** retrofit columns onto an already-deployed table — add
      explicit `ALTER TABLE publishers ADD COLUMN IF NOT EXISTS donate_pct ...`
      and equivalent `ALTER TABLE payouts ADD COLUMN IF NOT EXISTS kind/fund/status/idempotency_key ...`
      statements so existing prod databases upgrade in place. Update
      `mapPublisher`/`mapPayout` to surface the new fields (incl. `id` from the
      existing `bigserial`, not currently mapped). Add `setDonatePct(pid, pct)`
      (clamp 0–100 server-side, mirrors `levels.clampLevel` pattern at
      `server/index.js:169`), `pendingPayoutsFor(pid)`, `settlePayout(id, patch)`.
      `recordPayout` gains `status`/`idempotency_key` params and returns the
      inserted row's `id` (`RETURNING id`).
- [ ] `server/store-json.js`: add `donate_pct: 0` to the publisher default record
      (`store-json.js:52`). `recordPayout` (`store-json.js:91`) assigns an `id`
      (`crypto.randomBytes(12).toString('hex')`, already required in this file)
      and defaults `status:'settled'`, `kind:'cashout'`, `fund:null` when not
      specified — pass through explicit values otherwise. Add `setDonatePct`,
      `pendingPayoutsFor` (filter `payouts` by `pid`+`status:'pending'`),
      `settlePayout(id, patch)` (find by id, merge, persist).
- [ ] `lib/stripe.js`: `transfer(pid, amount, opts, cb)` gains support for
      `opts.idempotency_key` → forwarded as an `Idempotency-Key` request header
      on the real Stripe call. No-op on the simulated (no-key) path — the local
      pending/settled marker is what carries idempotency there.
- [ ] Verify parity: run `node test/store-interface.js` — it auto-diffs
      `Object.keys()` between the two stores, so it will fail loudly if
      `setDonatePct`/`pendingPayoutsFor`/`settlePayout` aren't mirrored on both.
      No changes needed to the test file itself.

### 8.2 — Server split + config endpoint [money — highest review priority]
- [ ] `server/index.js`: new env `COGWAIT_FUND_ACCOUNT`. If unset, the donation
      leg simulates exactly like `lib/stripe.js` does today without a key
      (`stripe.live` stays the single source of truth for "are transfers real").
- [ ] `server/index.js`: `POST /donate/config` (new, `authPublisher`-gated like
      `/payout` at `:189`) — body `{donate_pct}`, clamp integer 0–100 via the
      same clamp pattern as `levels.clampLevel` (`:169`), `store.setDonatePct(pid, pct)`,
      return `{ok, donate_pct}`.
- [ ] `server/index.js`: rewrite `POST /payout` (`:188-206`) per the 8.0
      mechanism — resume-or-fresh pending rows, per-leg transfer with
      idempotency key, settle, zero balance only when fully settled. Threshold
      check (`MIN_PAYOUT_USD`) stays against total balance, unchanged. Response:
      `{ok, paid_usd:keep, donated_usd:donate, transfers:{cashout, donation}, simulated}`.
- [ ] `server/index.js`: extend `GET /earnings` (`:178-186`) to add `donate_pct`
      (from the authed publisher record) and a donations subset of
      `payoutsFor(auth.id)` (filter `kind:'donation'`) so the dashboard can show
      "funded to date" without a new endpoint.
- [ ] `test/backend.js` (extend, same isolated-tempdir/spawn pattern already in
      the file): `/donate/config` clamps out-of-range values and requires auth;
      `/payout` split math (`keep+donate === balance` after rounding); donation
      leg produces a `kind:'donation'` row with `fund` set; fund transfer
      simulates when `COGWAIT_FUND_ACCOUNT` is unset; **inject a forced donation-leg
      failure and assert balance is NOT zeroed, a retry does NOT re-transfer the
      already-settled cashout leg** (this is the idempotency regression test —
      non-negotiable, this is the flagged risk); `/earnings` returns `donate_pct`
      + `donations`.
- [ ] `test/adapter.js` / `test/store-interface.js`: confirm `setDonatePct` +
      payout `kind`/`status` parity across JSON and Postgres (store-interface
      already covers this automatically per 8.1's last item; adapter.js needs no
      change unless a JSON-store-specific pending/settle case is added there).

### 8.3 — Client: dependency scan + CLI [local — no network beyond existing impression/config calls]
- [ ] New `lib/oss.js` (pure, dependency-free, matching the style of
      `lib/levels.js`/`lib/client.js` — no npm deps, no network):
      - `scanDeps(cwd)` — read `package-lock.json` (v2/v3 `packages` map; fall
        back to `package.json` deps if no lockfile), then each resolved
        package's `node_modules/<name>/package.json` `funding` field. Guard
        rails: cap total packages scanned, cap per-file read size, skip
        unreadable/oversized/malformed manifests, resolve real paths and refuse
        anything outside `node_modules` (no symlink escape).
      - `normalizeFunding(field)` — string / `{type,url}` / array-of-either →
        de-duped URL list.
      - `weightFunding(deps)` — 1 share per package, split across its funding
        URLs if multiple; sum + normalize to percentages per URL.
      - `buildReceipt(weights, donateAmountUsd)` → `{totalUsd, maintainers:[{url,
        name, pct, usd}], coverage}` (`coverage` = fraction of deps with *any*
        funding target — must be the real, often-low number).
- [ ] New `test/oss.js` (new suite, wire into `package.json` `scripts.test`
      alongside the existing `test/platforms.js`/`test/e2e.js` chain): fixture
      project trees covering all three `funding` shapes, multi-URL weighting/
      ranking, dollar-allocation-sums-to-total, `coverage` correctness, no
      lockfile, zero funding fields anywhere (coverage 0), malformed manifest,
      duplicate/cyclic deps, symlink-escape rejected.
- [ ] New `bin/oss.js` (self-contained script, same shape as `bin/register.js`/
      `bin/doctor.js` — runs immediately on require): `--oss` scans `cwd`, pulls
      live `donate_pct` + balance from `GET /earnings` for dollar figures (falls
      back to a neutral %-only breakdown if offline/`MOCK`), prints the receipt
      with the "pooled fund, illustrative snapshot" disclaimer required by
      DESIGN.md §1/§6. `--donate <pct>` validates 0–100, writes `donate_pct` to
      `~/.cogwait/config.json` (via `client.writeSecret`, matching
      `bin/register.js`'s config-write pattern), and calls the new
      `POST /donate/config`.
- [ ] `bin/setup.js`: wire the two flags into the existing delegation block
      (`:12-15`, currently `--doctor`/`--register`) — add
      `if (process.argv.includes('--oss')) { require('./oss.js'); return; }` and
      the same for `--donate` (or have `bin/oss.js` itself branch on both flags
      internally and setup.js delegate to it for either — pick one, keep it
      consistent with how `--doctor`/`--register` are each their own file).
- [ ] `lib/client.js`: add `DONATE_PCT` to the config-precedence block
      (`client.js:24-34`, alongside `LEVEL` at `:39`) for display only; add a
      thin `setDonatePct(pct, cb)` that POSTs to `/donate/config` using the
      existing `request()` helper. Do **not** touch `getCachedAd`/
      `reportImpression` (the statusline hot path) — this is additive only.
- [ ] Privacy regression (extend existing no-payload assertions in
      `test/client.js`/`test/backend.js`): assert no dependency name, URL path,
      or file content ever appears in any request body sent to `/impression`,
      `/donate/config`, or `/payout` — the scan output only ever reaches
      `stdout` or the dashboard's local render.

### 8.4 — Dashboard UI [local rendering + existing authed endpoints, no new money paths]
- [ ] `web/dashboard.html`: add a "Fund open source" card following the existing
      `.card`/`.hero` visual pattern already in the file — donate-% slider
      (0–100) that POSTs to `/donate/config` on change (same `authHeaders()`/
      fetch pattern as the existing cash-out button), "funded to date" pulled
      from the extended `GET /earnings` `donations` field, and a receipt table
      (maintainer, %, $) rendered client-side by loading `lib/oss.js` logic —
      note: this file has zero build step (plain `<script>`), so either inline a
      browser-safe copy of the pure scan/weight/receipt functions or document
      that the receipt table here only renders server-supplied dollar figures
      and defers the actual filesystem scan to the CLI (`npx cogwait --oss`) —
      **flag this as an open call for the executor**, since `lib/oss.js` reads
      `node_modules` from disk and a browser page has no filesystem access to
      the user's project; the dashboard cannot literally run `scanDeps()`
      itself. Likely resolution: the CLI writes the receipt JSON to
      `~/.cogwait/oss-receipt.json` and the dashboard's "Connect" file-picker
      (already used for `config.json`) offers to load that file too, mirroring
      the existing local-file-only pattern in the page (no upload) — confirm
      this shape before building the UI.
      Every dollar/percentage figure must render the "pooled fund, illustrative
      snapshot — not a per-maintainer payment guarantee" caption per DESIGN.md.

### 8.5 — Desktop app parity (phase 3 / non-blocking, lower priority)
- [ ] `app/src-tauri/src/cogwait.rs` (the shared command module referenced by
      `app/src-tauri/src/lib.rs`): add `save_config`-style handling for
      `donate_pct` (already generic patch-based, may need no change) and a new
      Rust command wrapping the scan — reuses the "held Rust-side" pattern
      already used for the publisher key.
- [ ] `app/src-tauri/src/lib.rs`: add `#[tauri::command]` wrappers (`set_donate_pct`,
      `run_oss_scan` or similar) and register them in the `invoke_handler!`
      list (`:65-77`), mirroring `save_config`/`get_earnings`.
- [ ] `app/src/main.ts`: new Fund-OSS panel mirroring the web dashboard card,
      reusing the existing level/render mirroring pattern already shared
      between the CLI and the app.
- [ ] Do not block the rest of Phase 8 on this — ship 8.1–8.4 first, desktop
      parity lands after.

### Risks
- **Idempotency mechanism (8.0) is new plumbing on the money path** — the
  pending/settled row lifecycle is the single highest-risk piece of this
  feature; the forced-failure retry test in 8.2 must pass before this ships to
  prod, not just the happy path.
- **Postgres column retrofit** — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on a
  live prod table is the only safe path; forgetting it (relying on
  `CREATE TABLE IF NOT EXISTS` alone) silently no-ops on any already-deployed
  database and the feature fails at runtime, not at deploy time.
- **Dashboard scan (8.4)** — `web/dashboard.html` is a static, buildless page;
  it cannot read the user's `node_modules` off disk the way the CLI can. This
  needs a concrete resolution (see 8.4) before UI work starts, not an
  assumption baked into the build.
- **Min-transfer floors and multi-fund selection** (DESIGN.md §10, remaining
  open items) are explicitly out of scope for this phase — not a blocker, but
  don't let them silently creep into 8.2's scope.

### Verification
- [ ] `npm test` full suite green, including new `test/oss.js` wired into
      `package.json` `scripts.test`.
- [ ] `node test/store-interface.js` passes with the 3 new store methods present
      on both backends.
- [ ] `test/backend.js`'s forced-failure idempotency case passes: cashout
      settles, donation leg fails, balance stays non-zero, retry settles only
      the donation leg, no second cashout transfer is issued.
- [ ] Manual: `COGWAIT_MOCK=1 npx cogwait --oss` prints a receipt with an honest
      (likely low) `coverage` number and the pooled-fund disclaimer, entirely
      offline.
- [ ] `bin/statusline.js` / `lib/client.js` `getCachedAd`/`reportImpression`
      diffed against pre-Phase-8 behavior — zero changes, hot path proven
      untouched.
- [ ] Privacy assertion: `grep` outbound request bodies in test fixtures for any
      package name/path — none present.

---

## Phase 9 — UI System Redo

**Goal:** every Cogwait surface (landing, dashboard, desktop app, video) renders
one visual system — gold `#CA9A2B` + blue `#2B5BCA` on `app/`'s existing
structural language, repositioned Fund-OSS-first — with all four locked-design
invariants (local-only Connect, clean `cargo check`/`vite build`, system-font
video render, both-theme AA + reduced-motion) intact and verified, not assumed.

Design is locked: `.planning/ui-redo/DESIGN.md` (palette, structure-donor,
Fund-OSS-first, default-20%, don't-touch-70/30 — §8 decision log is not up for
debate). Fund-OSS UI content is scoped by `.planning/fund-oss-mode/DESIGN.md`.
Steps below decide *how* to build what's locked, plus flag two things
exploration surfaced that the design doc didn't anticipate (see Risks).

**Dependency flag (confirmed by exploration, not assumed):** `grep -n
"donate\|oss\|Fund" server/index.js lib/client.js bin/setup.js` returns nothing
— **Phase 8 (Fund-OSS backend) has not been built yet.** Every Fund-OSS UI
element in 9.2/9.3 below is built against the *documented* API shape
(`POST /donate/config`, `GET /earnings` + `donate_pct`/`donations`) with
graceful degradation (missing endpoint → "Fund-OSS not available on this
backend yet", not a broken page) rather than blocked on Phase 8 landing first.
Recolor/repositioning work (9.0, 9.1, 9.4, the non-Fund-OSS parts of 9.2/9.3) has
no such dependency and can ship independently.

### 9.0 — Canonical tokens + cross-surface consistency mechanism (build once, first)
The token set (DESIGN.md §3) becomes real CSS custom properties / a `COLORS`
object in each surface's native format, each headed by the same pointer comment
so no surface can silently fork a value.

- [x] Header comment convention: `/* palette: see .planning/ui-redo/DESIGN.md §3 —
      do not fork values */` (CSS) / `// palette: see .planning/ui-redo/DESIGN.md
      §3 — do not fork values` (theme.ts) — first line under each `:root`/`COLORS`.
- [x] `web/index.html` `:root` (currently inline `<style>` lines 9–10, cyan/cold
      palette): replace with §3.1 dark tokens + §3.2 light-mode override inside
      the existing `@media (prefers-color-scheme:light)` block (line 10).
- [x] `web/dashboard.html` `:root` (lines 8–9, same cyan/cold palette): same
      token replacement; keep the existing `@media` light override structure
      (line 9), repoint to §3.2.
- [x] `app/src/styles.css` `:root` (lines 1–26): replace the single `--accent`
      system with the full gold+blue set from §3.1. This is **not** a 1:1
      rename — `--accent` was used for every loud element regardless of
      semantics; §3.5 splits it. Concretely repoint, don't blanket-replace:
      - Value/give/brand-mark uses → `--gold` (brand-dot line 60-64, `.card > h3::before`
        marker line 148-149, `.view-head h2::before` kicker line 120-121, `.stat::before`
        hairline line 188-189, `#tabs button::after`/`::before` selection + index color
        lines 76-90, `.lvl.sel` + `.lvl.sel::after` "SET" flag lines 301-307, `input:focus`
        ring lines 239, `.switch input:checked` toggle lines 256-257, `.cursor`/`.term-body
        .prompt .caret` lines 275/279, `.spon-mag` sponsor-word marker line 284 — sponsor
        label reads as value/brand, not an action, per §3.5).
      - Action/"do it" uses → `--blue`: primary `button.btn`/`.btn` fill (lines
        209-217, currently orange for *every* button including Cash out/Connect/
        Install — per §3.4 item 5 these become blue, gold is reserved for
        value/give amounts only), `.btn.cyan` stays as the tertiary cyan accent
        for terminal-context actions or is reconsidered case-by-case — do not
        leave a 3rd unbranded accent color active outside the terminal preview.
      - Terminal-preview ANSI colors (`--t-cyan`, `--t-yellow`, `.spon-cyan`,
        `.spon-yellow`, `.spon-dim`) are **explicitly exempt** — §3.4 item 9:
        "the sponsor/terminal preview is the only place ANSI color lives." Do
        not recolor these to gold/blue; only the chrome *around* the terminal
        (buttons, panel headers, live-tag corner flags) takes the brand accents.
      - `--accent-deep`/`--accent-ink`/`--accent-wash` split into matching
        `--gold-deep/-ink/-wash` and `--blue-deep/-ink/-wash` per §3.1; every
        `box-shadow`/hover/focus consumer repointed to whichever new variable
        matches its element's semantic role above.
- [ ] `video/src/theme.ts` `COLORS` (lines 4-18) + add the `FONT`/mono-vs-sans
      split already present (`FONT_MONO`/`FONT_SANS`, lines 20-23, unchanged
      shape) — swap `sponsor`/`magenta` → gold, add a `blue` entry for action-ish
      video text (e.g. the `npx cogwait` CTA block), keep `cyan`/`yellow`/`green`/
      `red` as the terminal-internal ANSI-adjacent set per the same exemption
      rule as styles.css.
- [x] `lib/render.js` / `lib/platforms.js` / `bin/render-line.js` — **no color
      change**. These are real ANSI escape codes for actual terminals (tmux,
      shell prompts), not CSS; §3.4's "ANSI stays terminal-native" rule already
      covers them. Confirmed by reading both files — flagging explicitly so the
      executor doesn't attempt a rename pass here that doesn't apply.

### 9.1 — Landing (`web/index.html`)
- [x] Hero copy (`<title>` line 6, meta description line 7, `<h1>`/`.tag` lines
      35-36): replace "Your AI thinks. You earn." framing with §4's "Your AI
      thinks. Open source gets paid." tagline + sub-copy (default-on 20%,
      never reads your code).
- [x] Terminal demo block (line 37): add the give-back receipt tease line under
      the existing `[sponsor]` line, per §5.1's two-line example
      (`◇ 20% of this → the open source you build on   [ adjust ]`).
- [x] Section rebuild (lines 43-66, currently "Why it's different" / "Install in
      30 seconds" / "Honest about the risk"): restructure into §5.1's five
      sections — How the give-back works · Actually private · Viewable-only ·
      Keep the rest/set your split · Honest about the risk. Keep the existing
      `.grid`/`.card` markup pattern (lines 22-24), just re-author copy per §4/§5.1.
- [x] CTA buttons (lines 39-40): gold "Get it on GitHub" (`.cta`, primary/value
      read — getting the tool is the entry to giving back) + blue ghost "See a
      sample OSS receipt" (`.cta.ghost`) replacing "View earnings".
- [x] Footer (lines 68-70) — unchanged, only inherits new token colors.

### 9.2 — Dashboard (`web/dashboard.html`)
- [x] Token swap per 9.0; recolor `.cashout` button (line 39, currently
      `background:var(--good)` hardcoded green) to blue per §3.5 (Cash out is
      an action verb, not a value display — the dollar figure above it in `.v.pos`
      stays gold/green-adjacent per existing semantics, only the *button* moves).
- [x] **Invariant — do not touch:** the Connect flow (`<input id="cfg">` line 54,
      the `FileReader`-based local-only read at lines 218-241, the `ALLOWED_HOSTS`
      allowlist logic lines 105-118). Restyle only; the privacy assertion is
      "reads config locally, never uploaded" and must remain true post-redesign.
- [x] Add the "Fund open source" card (new, following the existing `.card`/
      `.card.hero` pattern lines 71-77): donate-% slider (0-100, default 20)
      POSTing to `/donate/config` on change (same `authHeaders()`/fetch pattern
      as the existing cash-out call at line 247); "funded to date" stat sourced
      from the `GET /earnings` `donations` field (Phase 8's extension — guard
      with `d.donate_pct === undefined` → render "Fund-OSS not available on this
      backend yet" instead of blank/broken UI); split preview (keep vs give,
      two `tabular-nums` figures side by side); maintainer receipt table
      (maintainer, %, $) with the "pooled fund, illustrative snapshot — not a
      per-maintainer payment guarantee" caption on every dollar/percentage row
      (per fund-oss-mode DESIGN.md §6/§7, ui-redo DESIGN.md §7 acceptance).
- [x] **Receipt data path (carried-forward open item, fund-oss-mode DESIGN.md
      §9 + Phase 8 §8.4):** this static page cannot run `lib/oss.js`'s
      `scanDeps()` — no filesystem access to the user's `node_modules`. Extend
      the existing Connect file-picker (`<input id="cfg">`, same `change`
      handler at lines 218-241) to also accept a receipt JSON written by
      `bin/oss.js --oss` to `~/.cogwait/oss-receipt.json` — detect by shape
      (`cfg.maintainers` present vs `cfg.payout_id` present) in the same
      `FileReader.onload`, mirroring the existing local-file-only pattern (no
      upload, no new input element). This wires the two locked designs together
      per the open item — confirm this exact shape holds before building, since
      it's the one part of 9.2 not fully pinned by either DESIGN.md.
- [ ] Level control + history — restyle to match tokens (no behavior change).

### 9.3 — Desktop app (`app/`)
- [x] Recolor `app/src/styles.css` per 9.0's semantic mapping (not a blanket
      var rename) — this is the largest single-file change; verify visually
      against every tab (Status/Earnings/Ad level/Setup/About) since the
      `--accent` var currently touches ~25 distinct rules.
- [x] **Correction to DESIGN.md §5.3:** the doc says "`app/src-tauri/src/cogwait.rs`
      sponsor-line preview recolored (sponsor = gold)" — confirmed by reading
      `cogwait.rs` (337 lines) that this file has **zero** rendering/color code;
      it only returns plain JSON (`state()`, `levels_json()`, `doctor()`). The
      actual sponsor-line HTML + color classes live in `app/src/main.ts`
      (`sponsorInner()`, lines 115-127) and `app/src/styles.css` (`.spon-*`
      rules, lines 277-291) — already covered by the 9.0 token repoint
      (`.spon-mag` → gold). Do not spend time editing `cogwait.rs` expecting a
      visual change; there is none to make there.
- [x] Add Fund-OSS tab: `app/index.html` `#tabs` (lines 14-19) gets a 6th
      `<button data-tab="oss">Fund OSS</button>`; `app/src/main.ts` `render()`
      (lines 94-100) gets a `renderOss()` branch mirroring `renderEarnings()`
      (lines 238-261) — donate-% control, split preview, "run local scan"
      button, receipt render. Add matching `demo`/`mockInvoke` cases (lines
      17-54) for `get_oss_config`/`set_donate_pct`/`run_oss_scan` so the
      browser-preview fallback (`!inTauri` path, already exercised by the
      existing mock system) keeps working without Tauri.
- [x] New Rust commands in `app/src-tauri/src/lib.rs` (mirrors `get_earnings`/
      `request_payout` shape, lines 41-49): `get_oss_config`, `set_donate_pct`,
      `run_oss_scan`, registered in `invoke_handler!` (lines 65-77). Implementation
      in `cogwait.rs` follows the existing `earnings()`/`payout()` pattern (lines
      261-283) — `donate_pct` mirrors config the same way `level` already does
      (held Rust-side, synced via `save_config`/a new `/donate/config` POST once
      Phase 8 ships; degrade to a local-only value with a "not synced" note if
      the endpoint 404s, consistent with the dashboard's graceful-degradation call).
      Local scan (`run_oss_scan`) reads the *current working directory* the Tauri
      process was launched from — same cwd-scoping caveat as `lib/oss.js`
      (fund-oss-mode DESIGN.md, Assumptions).
- [x] **Icon is a redesign, not a recolor.** `app/src-tauri/icon-src.svg`
      (confirmed by reading it) still uses the pre-rename magenta `#e64ec9`
      *with a radial-gradient glow* (`<radialGradient id="glow">`) — it was
      never migrated even to the app's current orange, and the glow directly
      violates the locked "zero glow" rule (DESIGN.md §3.1). Needs new flat
      art (hard-edged, gold mark per the brand-dot language in `styles.css`
      lines 59-65) rather than a find-replace hex swap, then full regeneration
      of all 13 files under `app/src-tauri/icons/` via the Tauri icon pipeline
      (`tauri icon` or equivalent) — budget this as real design work.

### 9.4 — Video (`video/src/theme.ts` + scenes)
- [x] `theme.ts` recolor covered by 9.0.
- [x] **Stale branding, found during exploration (not in DESIGN.md, fix while
      the files are open for recolor anyway):** `CliOnly.tsx` still says
      "SPONSORIC — NATIVE TO THE CLI" (line 180), "Sponsoric" (line 215), "npx
      sponsoric" (line 237); `AdLevels.tsx` line 105 says "npx sponsoric --level
      3". These are leftover from the in-flight (uncommitted) Sponsoric→Cogwait
      rename visible in `git status` — fix the on-screen copy to "Cogwait" / `npx
      cogwait` in the same pass, don't ship a recolored video with the old name.
- [x] `Comparison.tsx` `ROWS` (lines 6-13): the "Dev revenue share: 70% vs
      50-70%" row is **unchanged** (decision #5 — 70/30 is out of scope). Add a
      7th row reflecting the repositioning per §4: `{ label: "Funds open source
      out of the box", sponsoric: "yes, default 20%", incumbent: "no", win: true }`
      — this is the differentiator §4 says separates Cogwait from every
      incumbent listed in `COMPETITORS` (theme.ts lines 28-33).
- [x] Add the Fund-OSS beat (§5.4): extend `CliReveal` in `CliOnly.tsx` (lines
      166-208) with an additional post-sponsor-line reveal showing the give-back
      receipt tease (`◇ 20% → open source`), reusing the `Rise`/`Pop` primitives
      already in `anim.tsx`. Update `Root.tsx`'s `durationInFrames` for
      `CliOnly` (line 14, currently 420) if the new beat extends runtime.
- [x] **Video length budget (carried-forward open item, DESIGN.md §9):** adding
      a beat without trimming risks overrun. Recommend trimming `Competitors`
      (currently 120 frames, `CliOnly.tsx` line 17) rather than lengthening
      total runtime — flag as a call for the executor/user rather than silently
      picking, since it changes pacing of an already-approved scene.
- [x] Verify no `@font-face`/network font added — `FONT_MONO`/`FONT_SANS`
      (theme.ts lines 20-23) are already system-only; confirm the Fund-OSS beat
      doesn't introduce a new font reference.

### Cross-surface verification (final, before calling Phase 9 done)
- [x] Visual spot-check all four surfaces side by side: same two accents, same
      panel/kicker/stat/button/grain language (DESIGN.md §7).
- [x] Both themes AA: landing + dashboard light mode uses §3.2's darker gold
      `#a97d16` (not the dark-mode `#CA9A2B`, which DESIGN.md itself notes fails
      AA on the light bg) — verify the `@media (prefers-color-scheme:light)`
      override actually swaps the gold variable, not just bg/fg.
- [x] `prefers-reduced-motion` disables all animation — confirm the media query
      (already present `app/src/styles.css:336-338`) is mirrored into
      `web/index.html` and `web/dashboard.html`'s new `<style>` blocks once they
      gain any animation (countUp-equivalent, hover transitions, etc.).
- [x] `cd app && npm run build` (`tsc && vite build`) clean.
- [x] `cargo check` clean in `app/src-tauri`.
- [x] Dashboard Connect flow still reads config **locally only** — re-diff the
      `change` handler (lines 218-241 today) after edits; confirm no `fetch`/
      upload call was introduced alongside the new receipt-file branch.
- [x] `cd video && npx remotion render <comp> out/test.mp4` succeeds headless;
      confirm no network request fires during render (system fonts only).
- [x] Grep all touched Fund-OSS copy (landing, dashboard, app, video) for
      "received" / "maintainer X got" language — must be none; every figure is
      captioned pooled/snapshot.
- [ ] Confirm decision #5 (70/30 vs donate-pct interpretation, ui-redo DESIGN.md
      §9 open item) with the user before merging any landing/dashboard copy
      that could read as changing the publisher/operator split. **Left open
      deliberately — this is flagged for explicit user veto in both source
      DESIGN.md docs; an executor cannot self-approve it.** Copy audit done: no
      landing/dashboard/video text implies a change to the 70/30 split (the
      Comparison.tsx row stays literally "70%"), but the sign-off itself needs
      the user.

### Risks
- **Phase 8 backend doesn't exist yet** (confirmed via grep, not assumed) —
  every Fund-OSS UI element in 9.2/9.3 is speculative against a documented but
  unbuilt API. Ship with explicit graceful-degradation messaging, not a silent
  broken state, and re-test once Phase 8 lands.
- **DESIGN.md §5.3 misattributes the sponsor-line recolor to `cogwait.rs`** —
  confirmed empty of rendering code; the real surface is `main.ts` + `styles.css`.
  Following the doc literally would waste a step on a no-op file.
- **`icon-src.svg` needs a redesign, not a recolor** — it's still on the
  pre-rename magenta *and* uses a glow that violates the locked zero-glow rule;
  treat as new asset work with its own review, not a mechanical token swap.
- **Video carries stale "Sponsoric" branding** — a leftover of the in-flight,
  uncommitted rename; missing this fix ships a recolored video under the old name.
- **Uncommitted rename in progress:** `git status` shows the whole repo mid a
  Sponsoric→Cogwait rename (all files modified, `sponsoric.rs`→`cogwait.rs`
  renamed) not yet committed. Phase 9 lands on top of that diff — keep Phase 9
  commits separable from the rename commit(s) so either can be reviewed alone.
- **Revenue-share interpretation** (ui-redo DESIGN.md §9 / fund-oss-mode DESIGN.md
  decision #5) — flagged for user veto in both source docs; don't let landing/
  dashboard copy imply a change to the 70/30 split.
- **Video length budget** — the Fund-OSS beat needs a scene trimmed elsewhere or
  runtime creeps past the target.

### Verification
- [x] All eight cross-surface checklist items above pass (seven confirmed;
      the decision-#5 user-veto item is deliberately left for the user, see above).
- [x] `npm test` still green (Phase 9 touches no server/lib money-path code, but
      confirm zero collateral breakage from the token/CSS work — no test reads
      HTML/CSS today, but the client/backend suites must be untouched).
- [x] Manual side-by-side screenshot comparison: landing (dark+light), dashboard
      (dark+light), app (Status tab live-rendered in browser-preview mode; Fund
      OSS tab verified via clean `tsc`/`vite build` + code-pattern mirroring
      rather than a click-through screenshot — see report), three rendered video
      frames (Fund-OSS beat, Closing, Comparison 7-row table) — one system,
      confirmed by eye, not just code.

---

## Critical path to a real dollar (all external now)
1. Deploy backend + Postgres (your hosting)
2. Live Stripe Connect + one paying advertiser (your Stripe, business)
3. Anthropic marketplace policy confirmed OK

## What's proven locally today
- `npm test` — 6 suites green (smoke, client, backend, adapter, store-interface, e2e)
- Real impression settles end-to-end: tiered CPM credited (L1 $0.0056), throttle + atomic dedupe + cap enforced
- Backend runs on JSON (single-node) or Postgres (`DATABASE_URL`) with identical behavior
- Payout flow works (Stripe simulated without a key)
- `claude plugin validate .` passes
</content>
