#!/usr/bin/env node
'use strict';
// Cogwait backend — reference implementation of the contract in README.md.
// Persistent store (JSON file, or Postgres when DATABASE_URL is set), rate
// limiting, atomic fraud dedupe/caps, campaign-based ad serving, Stripe payouts.

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const store = require('./store');
const stripe = require('../lib/stripe');
const paypal = require('../lib/paypal');
const levels = require('../lib/levels');

const PORT = Number(process.env.PORT || 8787);
// Base/fallback CPM for a campaign that doesn't set its own. Level-based pricing
// (lib/levels.js) is what a viewable impression is actually worth.
const CPM_USD = Number(process.env.COGWAIT_CPM || levels.cpmForLevel(levels.DEFAULT_LEVEL));
const PUBLISHER_SHARE = Number(process.env.COGWAIT_SHARE || 0.7);
const MIN_PAYOUT_USD = Number(process.env.COGWAIT_MIN_PAYOUT || 10);
// Fund-OSS: pooled destination for the donation leg of a payout. If unset, the
// donation leg simulates exactly like lib/stripe.js does without a key — the
// flow stays testable, and `stripe.live` stays the single source of truth for
// "are transfers real" (this env only decides the donation leg's destination).
const FUND_ACCOUNT = process.env.COGWAIT_FUND_ACCOUNT || '';
const FUND_LABEL = FUND_ACCOUNT || 'cogwait-oss-fund'; // symbolic label even when simulated

// Refuse to start without a real admin token — no default that ships open.
const ADMIN_TOKEN = process.env.COGWAIT_ADMIN_TOKEN || '';
if (!ADMIN_TOKEN || ADMIN_TOKEN === 'dev-admin') {
  throw new Error('COGWAIT_ADMIN_TOKEN is required and must not be the default. Set a strong random value (e.g. `openssl rand -hex 16`).');
}

// COGWAIT_TEST_FAIL_DONATE_ONCE forces a real Stripe donation transfer to fail —
// it exists purely to make the payout idempotency test deterministic. It must
// never be able to fire against a real prod payout, so refuse to start rather
// than risk a forced failure on a live donation leg.
if (process.env.COGWAIT_TEST_FAIL_DONATE_ONCE === '1' && process.env.NODE_ENV === 'production') {
  throw new Error('COGWAIT_TEST_FAIL_DONATE_ONCE must never be set with NODE_ENV=production — it forces real donation transfers to fail.');
}

// CORS. web/dashboard.html is a static page that calls this API from another
// origin with `Authorization: Publisher <id>:<key>`, which makes every call a
// preflighted cross-origin request — without these headers the dashboard only
// ever works when served from the API's own origin.
//
//   COGWAIT_ALLOWED_ORIGINS  comma-separated allowlist of origins permitted to
//                            call the AUTHENTICATED routes, e.g.
//                            "https://cogwait.dev,http://localhost:5173".
//                            Unset = no cross-origin access to those routes
//                            (same-origin dashboards still work). The literal
//                            "*" allows any origin — opt-in, never the default.
//
// Genuinely public, unauthenticated routes (/health, /ad/next) answer `*`
// unconditionally: they carry no secrets and no per-caller data. Everything
// else echoes the request's Origin only when it is allowlisted, with
// `Vary: Origin` so a cached response for one origin is never reused for
// another. Access-Control-Allow-Credentials is never sent — this API
// authenticates with a header, not cookies, so credentialed CORS (which
// browsers forbid alongside `*` anyway) is not needed.
const ALLOWED_ORIGINS = (process.env.COGWAIT_ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// /campaign/submit is a public, unauthenticated endpoint (an advertiser
// submission form on the marketing site posts to it cross-origin) and carries no
// secrets, so it answers CORS `*` like the other public routes.
const PUBLIC_CORS_PATHS = new Set(['/health', '/ad/next', '/campaign/submit']);
const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const CORS_ALLOW_HEADERS = 'authorization, content-type, x-admin-token';
const CORS_MAX_AGE = String(Number(process.env.COGWAIT_CORS_MAX_AGE || 600));

// Set the CORS response headers for this request and return the granted
// Access-Control-Allow-Origin value (null = cross-origin access denied).
// Headers set here survive the later res.writeHead(...) in send() — Node merges
// setHeader values with the writeHead header object.
function applyCors(req, res, p) {
  if (PUBLIC_CORS_PATHS.has(p)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return '*';
  }
  res.setHeader('Vary', 'Origin'); // response depends on Origin — never share a cache entry
  const origin = req.headers['origin'];
  if (!origin) return null;       // same-origin / non-browser caller: nothing to grant
  if (!ALLOWED_ORIGINS.includes('*') && !ALLOWED_ORIGINS.includes(origin)) return null;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return origin;
}

// Constant-time string comparison to avoid timing side channels on secrets.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Authenticate a publisher from `Authorization: Publisher <id>:<secret>`.
async function authPublisher(req) {
  const m = /^Publisher\s+([^:\s]+):(.+)$/.exec(req.headers['authorization'] || '');
  if (!m) return null;
  const rec = await store.getPublisher(m[1]);
  if (!rec || !rec.secret) return null;
  return safeEqual(m[2], rec.secret) ? rec : null;
}

// Campaign moderation states (AD_POLICY.md). Only 'approved' is ever served —
// 'pending' is awaiting review, 'rejected' failed it, 'frozen' violated policy
// after the fact (budget preserved, serving stopped).
const CAMPAIGN_STATUSES = new Set(['pending', 'approved', 'rejected', 'frozen']);

// Fraud/rate limits.
const DEDUPE_MS = 10000;                 // same tag+ad within window = not billable (atomic in store)
const MAX_IMPRESSIONS_PER_SESSION_DAY = 500;
const DAY_MS = 86400000;
// Anti-abuse cap on the PUBLIC /campaign/submit endpoint: a single IP can create
// at most this many pending campaigns per rolling day. Mirrors the per-session
// daily impression cap above — same rolling-window count, keyed by IP. The
// per-second per-IP limiter (rateLimited) still applies on top of this.
const MAX_SUBMISSIONS_PER_IP_DAY = Number(process.env.COGWAIT_SUBMIT_CAP || 20);
const RATE_WINDOW_MS = 1000;
const RATE_MAX = Number(process.env.COGWAIT_RATE_MAX || 20); // requests/sec per key (per-instance)

// Email validation/normalization for the optional recovery address and the
// public-submission contact address. Deliberately the same simple, permissive
// shape the payout-rail email check uses (server-side plausibility, not RFC 5322
// perfection) — reject the obviously-broken, normalize the rest.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function validEmail(s) {
  if (typeof s !== 'string') return false;
  const e = s.trim();
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}
// Normalize for storage AND for the recovery match: trim + lowercase so a
// legitimate owner isn't locked out by a stray capital or trailing space. Both
// the stored value and the recovery input pass through this, so the compare is
// against like-for-like.
function normEmail(s) { return String(s || '').trim().toLowerCase(); }

const perImpression = (level) => levels.perImpression(level, PUBLISHER_SHARE);
const rate = new Map();                   // key -> {count, reset} (per-instance; see DEPLOY.md)

// Default house ads used when no advertiser campaign has budget (keeps fill at 100%).
const HOUSE_ADS = [
  { id: 'house-neon', text: 'Neon — serverless Postgres that scales to zero', url: 'https://neon.tech' },
  { id: 'house-warp', text: 'Warp — the terminal reimagined for AI-native devs', url: 'https://warp.dev' },
  { id: 'house-sentry', text: 'Sentry — see errors before your users do', url: 'https://sentry.io' }
];

// Initialize the store once (schema/connect). Lazy so serverless cold starts work.
let readyPromise = null;
function ensureReady() { return readyPromise || (readyPromise = store.init()); }

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function rateLimited(key) {
  const now = Date.now();
  let r = rate.get(key);
  if (!r || now > r.reset) { r = { count: 0, reset: now + RATE_WINDOW_MS }; rate.set(key, r); }
  r.count += 1;
  return r.count > RATE_MAX;
}
function clientKey(req) { return (req.socket && req.socket.remoteAddress) || 'local'; }
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function log(m) { if (process.env.COGWAIT_QUIET !== '1') process.stderr.write(`[cogwait] ${m}\n`); }

// Promisify the callback-based Stripe helpers.
function stripeTransfer(pid, amount, opts) {
  return new Promise((resolve, reject) => stripe.transfer(pid, amount, opts, (e, r) => e ? reject(e) : resolve(r)));
}
function stripeOnboard(pid) {
  return new Promise((resolve, reject) => stripe.onboard(pid, (e, r) => e ? reject(e) : resolve(r)));
}
function paypalPayout(email, amount, idempotencyKey) {
  return new Promise((resolve, reject) => paypal.payout(email, amount, { idempotency_key: idempotencyKey }, (e, r) => e ? reject(e) : resolve(r)));
}

// Mask a payout email for display — never echo the raw stored address back to
// the client verbatim (e.g. "jane@example.com" -> "j***@example.com").
function maskEmail(email) {
  if (typeof email !== 'string' || email.indexOf('@') < 1) return null;
  const [user, domain] = email.split('@');
  return user[0] + '***@' + domain;
}

// Test-only failure injection for the idempotency regression test (§8.0/§8.2):
// forces the donation leg to fail exactly once per idempotency key, so a test
// can exercise "cashout settles, donation fails, retry settles only the
// donation leg" without a real Stripe outage. Off unless explicitly opted in;
// never touches the cashout leg or any other request.
const FAILED_DONATE_KEYS = new Set();
function maybeForceDonateFailure(idempotencyKey) {
  if (process.env.COGWAIT_TEST_FAIL_DONATE_ONCE !== '1' || !idempotencyKey) return;
  if (FAILED_DONATE_KEYS.has(idempotencyKey)) return; // only the first attempt fails
  FAILED_DONATE_KEYS.add(idempotencyKey);
  throw new Error('test_forced_donation_failure');
}

// The donation leg transfers to the pooled Fund-OSS account. Simulated whenever
// COGWAIT_FUND_ACCOUNT is unset, independent of whether STRIPE_SECRET_KEY is
// live — a configured fund destination is required before donations go real.
function fundTransfer(pid, amount, idempotencyKey) {
  maybeForceDonateFailure(idempotencyKey);
  if (!FUND_ACCOUNT) {
    return Promise.resolve({ id: 'sim_fund_' + Date.now(), simulated: true, amount_usd: amount, destination: 'unlinked' });
  }
  return stripeTransfer(pid, amount, { stripe_account: FUND_ACCOUNT, idempotency_key: idempotencyKey });
}

// Pick an ad: prefer an approved campaign with budget, else a house ad.
async function pickAd(tag) {
  const camps = await store.activeCampaigns();
  if (camps.length) {
    const c = camps[Math.abs(hash(tag + Math.floor(Date.now() / 20000))) % camps.length];
    return { id: c.id, text: c.text, url: c.url, campaign: true, cpm: c.cpm_usd };
  }
  const a = HOUSE_ADS[Math.abs(hash(tag + Math.floor(Date.now() / 20000))) % HOUSE_ADS.length];
  return Object.assign({ campaign: false, cpm: CPM_USD }, a);
}

async function handler(req, res) {
  try {
    await ensureReady();
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    const allowOrigin = applyCors(req, res, p);

    // Preflight. Answered before rate limiting: a browser sends one per
    // authenticated call and it touches no store, so counting it against the
    // caller's budget would halve the effective rate limit. A disallowed origin
    // gets a bare 403 with no Access-Control-* grant, so the real request is
    // never even attempted.
    if (req.method === 'OPTIONS') {
      if (!allowOrigin) { res.writeHead(403, { 'Content-Length': '0' }); return res.end(); }
      res.writeHead(204, {
        'Access-Control-Allow-Methods': CORS_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Max-Age': CORS_MAX_AGE,
        'Content-Length': '0'
      });
      return res.end();
    }

    if (rateLimited(clientKey(req))) return send(res, 429, { error: 'rate_limited' });

    if (p === '/health') return send(res, 200, {
      ok: true,
      store: store.backend,
      publisher_share: PUBLISHER_SHARE,
      levels: levels.LEVELS.map((L) => ({
        id: L.id, key: L.key, label: L.label, cpm_usd: L.cpm,
        per_impression_usd: store.round(perImpression(L.id))
      })),
      per_impression_usd: store.round(perImpression(levels.DEFAULT_LEVEL)),
      stripe_live: stripe.live,
      paypal_live: paypal.live
    });

    if (p === '/ad/next' && req.method === 'GET') {
      const tag = u.searchParams.get('tag') || 'anon';
      return send(res, 200, await pickAd(tag));
    }

    // POST /session/init — register a new publisher (returns the secret ONCE), or
    // start a session for an existing one (requires the secret).
    if (p === '/session/init' && req.method === 'POST') {
      const b = await readBody(req);
      const pid = b.publisher_id;
      if (!pid) return send(res, 401, { error: 'missing_publisher_id' });
      const existing = await store.getPublisher(pid);
      if (!existing) {
        const rec = await store.publisher(pid); // creates with a fresh secret
        // Optional recovery email captured at registration (validated + normalized;
        // silently ignored if malformed — registration still succeeds). Never
        // echoed back here: the registration response is unauthenticated.
        if (validEmail(b.recovery_email)) await store.setRecoveryEmail(pid, normEmail(b.recovery_email));
        return send(res, 200, { ok: true, publisher_id: pid, secret: rec.secret, session: 'sess-' + hash(pid + Date.now()), registered: true });
      }
      const auth = await authPublisher(req);
      if (!auth || auth.id !== pid) return send(res, 401, { error: 'invalid_credentials' });
      return send(res, 200, { ok: true, publisher_id: pid, session: 'sess-' + hash(pid + Date.now()) });
    }

    if (p === '/impression' && req.method === 'POST') {
      const b = await readBody(req);
      const auth = await authPublisher(req);          // credit only the authenticated publisher
      if (!auth) return send(res, 401, { error: 'unauthorized' });
      const pid = auth.id;                             // ignore any body-supplied publisher_id
      if (b.surface !== 'statusline') return send(res, 422, { error: 'unsupported_surface' });

      // Fraud: atomic dedupe of replays (works across instances).
      const key = `${b.session_tag}:${b.ad_id}`;
      if (await store.dedupeSeen(key, DEDUPE_MS)) {
        const pub = await store.getPublisher(pid);
        return send(res, 200, { ok: true, credited_usd: 0, balance_usd: pub ? pub.balance_usd : 0, deduped: true });
      }
      // Fraud: per-session daily cap.
      if (await store.impressionsInWindow(b.session_tag, 86400000) >= MAX_IMPRESSIONS_PER_SESSION_DAY) {
        const pub = await store.getPublisher(pid);
        return send(res, 200, { ok: true, credited_usd: 0, balance_usd: pub ? pub.balance_usd : 0, capped: true });
      }

      // Price by the ad level that rendered — clamp the client-declared level and
      // pay from the server's CPM table (never trust a raw number).
      const lvl = levels.clampLevel(b.level === undefined ? levels.DEFAULT_LEVEL : b.level);
      const amount = store.round(perImpression(lvl));
      const pub = await store.creditImpression(pid, amount, { ad_id: b.ad_id, session_tag: b.session_tag, level: lvl });
      const camp = await store.getCampaign(b.ad_id);
      if (camp) await store.spendCampaign(b.ad_id, store.round(levels.cpmForLevel(lvl) / 1000));
      log(`impression pub=${pid} ad=${b.ad_id} L${lvl} +$${amount.toFixed(4)} bal=$${pub.balance_usd.toFixed(4)}`);
      return send(res, 200, { ok: true, credited_usd: amount, level: lvl, balance_usd: pub.balance_usd });
    }

    if (p === '/earnings' && req.method === 'GET') {
      const auth = await authPublisher(req);           // scope strictly to the authenticated publisher
      if (!auth) return send(res, 401, { error: 'unauthorized' });
      const payouts = await store.payoutsFor(auth.id); // settled only — pending legs never show as finished
      return send(res, 200, {
        publisher_id: auth.id, impressions: auth.impressions, balance_usd: auth.balance_usd,
        min_payout_usd: MIN_PAYOUT_USD, created: auth.created || null,
        donate_pct: auth.donate_pct,
        payout_method: auth.payout_method || 'stripe',
        paypal_email: maskEmail(auth.paypal_email),   // masked — never the raw address
        recovery_email: auth.recovery_email || null,  // authed route only — never in an unauth response
        stripe_linked: !!auth.stripe_account,
        payouts,
        donations: payouts.filter((r) => r.kind === 'donation')
      });
    }

    // POST /donate/config — set the Fund-OSS give-back percentage (0-100, server-clamped).
    if (p === '/donate/config' && req.method === 'POST') {
      const b = await readBody(req);
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      const n = Math.round(Number(b.donate_pct));
      const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : pub.donate_pct;
      const updated = await store.setDonatePct(pub.id, pct);
      return send(res, 200, { ok: true, donate_pct: updated.donate_pct });
    }

    // POST /payout/method — choose the cashout rail. body { method, paypal_email? }.
    // 'stripe' cashes out to the Connect account linked via /connect/onboard;
    // 'paypal' cashes out to the given PayPal email. The store validates the
    // method and email — a bad method leaves the rail unchanged, a bad email is
    // dropped (never persisted), so money can't be aimed at a fat-fingered target.
    if (p === '/payout/method' && req.method === 'POST') {
      const b = await readBody(req);
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      if (b.method !== 'stripe' && b.method !== 'paypal') return send(res, 400, { error: 'invalid_method' });
      if (b.method === 'paypal' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.paypal_email || ''))) {
        return send(res, 400, { error: 'invalid_paypal_email' });
      }
      const updated = await store.setPayoutMethod(pub.id, b.method, b.paypal_email);
      return send(res, 200, {
        ok: true,
        payout_method: updated.payout_method,
        paypal_email: maskEmail(updated.paypal_email),
        paypal_email_set: !!updated.paypal_email
      });
    }

    // POST /publisher/rotate-key — issue a fresh publisher key for the authed
    // publisher (same gate as /payout). The new key is returned ONCE; the old key
    // stops authenticating immediately (auth reads the current secret). Same
    // generation+storage mechanism as registration (store.rotateKey mirrors
    // store.publisher's crypto.randomBytes(24) hex secret). Use this to roll a
    // leaked key without losing the account's balance or history.
    if (p === '/publisher/rotate-key' && req.method === 'POST') {
      await readBody(req);
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      const rec = await store.rotateKey(pub.id);
      log(`publisher key rotated pub=${pub.id}`);
      return send(res, 200, { ok: true, publisher_key: rec.secret });
    }

    // POST /publisher/recovery-email — set or change the authed publisher's
    // account-recovery email (body { recovery_email }). Validated + normalized;
    // stored on the publisher record. Never exposed on any unauthenticated
    // response — it is the sole secondary factor for admin-assisted recovery.
    if (p === '/publisher/recovery-email' && req.method === 'POST') {
      const b = await readBody(req);
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      if (!validEmail(b.recovery_email)) return send(res, 400, { error: 'invalid_email' });
      const updated = await store.setRecoveryEmail(pub.id, normEmail(b.recovery_email));
      log(`recovery email set pub=${pub.id}`);
      return send(res, 200, { ok: true, recovery_email: updated.recovery_email });
    }

    // POST /payout — pay out the publisher's balance via Stripe (real or simulated),
    // split server-side into a cashout leg (keep) and a donation leg (Fund-OSS give-back).
    // Idempotency mechanism (§8.0, DESIGN.md §10): a payout row is inserted with
    // status:'pending' BEFORE any Stripe call. A retry resumes those pending rows
    // rather than recomputing keep/donate from the (possibly already-moved)
    // balance, so a failed sibling leg can never cause a double cashout.
    //
    // The resume-or-fresh decision itself (store.claimPayoutBatch) is a SINGLE
    // atomic store operation — Postgres does it under a row-locked transaction
    // (SELECT ... FOR UPDATE on the publisher) — so two near-simultaneous
    // /payout calls for the same publisher can never both observe "nothing
    // pending" and both compute+insert a fresh batch (which would fire two
    // real Stripe transfers off the same un-moved balance).
    if (p === '/payout' && req.method === 'POST') {
      await readBody(req);
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      const pid = pub.id;

      // computeLegs runs INSIDE the store's atomic claim, against the row-locked
      // publisher record — never against the (possibly stale) `pub` fetched above.
      const claim = await store.claimPayoutBatch(pid, (lockedPub) => {
        if (!lockedPub || lockedPub.balance_usd < MIN_PAYOUT_USD) return null;
        const pct = Math.max(0, Math.min(100, Number(lockedPub.donate_pct) || 0));
        const donate = store.round(lockedPub.balance_usd * pct / 100);
        const keep = store.round(lockedPub.balance_usd - donate);
        if (keep <= 0 && donate <= 0) return null;
        return { keep, donate, fund: FUND_LABEL };
      });

      if (claim.belowMinimum || (!claim.cashoutRow && !claim.donationRow)) {
        const balance = claim.pub ? claim.pub.balance_usd : pub.balance_usd;
        return send(res, 400, { error: 'below_minimum', balance_usd: balance, min_payout_usd: MIN_PAYOUT_USD });
      }

      let cashoutRow = claim.cashoutRow, donationRow = claim.donationRow;
      const clPub = claim.pub || pub;
      const stripeAccount = clPub.stripe_account;
      const payoutMethod = clPub.payout_method === 'paypal' ? 'paypal' : 'stripe';
      const paypalEmail = clPub.paypal_email;
      let failed = false, simulated = false;

      // Attempt only legs not yet settled (claimPayoutBatch's resume path only
      // returns 'pending' rows, so an already-settled sibling from a prior partial
      // failure is simply absent here — never retransferred).
      //
      // settlePayoutLeg marks the leg settled AND, only if this was the last
      // outstanding leg, zeroes the balance — atomically, under the same
      // publisher row lock claimPayoutBatch uses. That closes the second half
      // of the double-payout race: "settle" and "zero the balance" used to be
      // two separate unlocked steps, and a concurrent claimPayoutBatch could
      // acquire the row lock in the gap between them and see an empty pending
      // set alongside a still-unzeroed balance — a second real payout from the
      // same money. There is no such gap anymore.
      if (cashoutRow && cashoutRow.status !== 'settled') {
        try {
          // Route the cashout (keep) leg to the publisher's chosen rail. A live
          // rail with no linked destination throws inside the adapter
          // (no_connected_account / no_paypal_email) → caught below → 502, row
          // stays pending, safely retryable — never a transfer to nowhere.
          const result = payoutMethod === 'paypal'
            ? await paypalPayout(paypalEmail, cashoutRow.amount_usd, cashoutRow.idempotency_key)
            : await stripeTransfer(pid, cashoutRow.amount_usd, { stripe_account: stripeAccount, idempotency_key: cashoutRow.idempotency_key });
          const settled = await store.settlePayoutLeg(pid, cashoutRow.id, {
            transfer: result.id, simulated: !!result.simulated, status: 'settled'
          });
          cashoutRow = settled.row;
          simulated = simulated || !!result.simulated;
        } catch (e) {
          failed = true;
          log(`payout cashout leg failed pub=${pid}: ${e.message}`);
        }
      }
      if (!failed && donationRow && donationRow.status !== 'settled') {
        try {
          const result = await fundTransfer(pid, donationRow.amount_usd, donationRow.idempotency_key);
          const settled = await store.settlePayoutLeg(pid, donationRow.id, {
            transfer: result.id, simulated: !!result.simulated, status: 'settled'
          });
          donationRow = settled.row;
          simulated = simulated || !!result.simulated;
        } catch (e) {
          failed = true;
          log(`payout donation leg failed pub=${pid}: ${e.message}`);
        }
      }

      if (failed) return send(res, 502, { error: 'payout_failed', partial: true });

      log(`payout pub=${pid} rail=${payoutMethod} keep=$${cashoutRow ? cashoutRow.amount_usd.toFixed(4) : '0'} donate=$${donationRow ? donationRow.amount_usd.toFixed(4) : '0'} ${simulated ? '(simulated)' : ''}`);
      return send(res, 200, {
        ok: true,
        paid_usd: cashoutRow ? cashoutRow.amount_usd : 0,
        donated_usd: donationRow ? donationRow.amount_usd : 0,
        transfers: { cashout: cashoutRow ? cashoutRow.transfer : null, donation: donationRow ? donationRow.transfer : null },
        simulated
      });
    }

    // DELETE /publisher — erase the authenticated publisher and their records
    // (PRIVACY.md: "request removal of your publisher_id and its records at any
    // time"). Requires the publisher's own key — there is no admin override, so
    // nobody else can delete an account out from under them.
    //
    // Refuses while money is still owed: an unsettled payout leg is mid-flight
    // at Stripe/PayPal (deleting it would strand a transfer with no ledger row
    // to resume from), and a non-zero balance is the publisher's money. Both
    // return 409 telling them to cash out first — deletion must never be a
    // silent way to destroy a balance.
    if (p === '/publisher' && req.method === 'DELETE') {
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      const pending = await store.pendingPayoutsFor(pub.id);
      if (pending.length) {
        return send(res, 409, {
          error: 'payout_pending',
          detail: 'A payout is still in flight. Retry POST /payout until it settles, then delete.',
          pending_legs: pending.length
        });
      }
      if (pub.balance_usd > 0) {
        return send(res, 409, {
          error: 'balance_outstanding',
          detail: 'Cash out your balance with POST /payout before deleting your account.',
          balance_usd: pub.balance_usd,
          min_payout_usd: MIN_PAYOUT_USD
        });
      }
      await store.deletePublisher(pub.id);
      log(`publisher deleted pub=${pub.id}`);
      return send(res, 200, { ok: true, deleted: true, publisher_id: pub.id });
    }

    // POST /campaign — advertiser creates a campaign (admin-gated in this stub).
    if (p === '/campaign' && req.method === 'POST') {
      const b = await readBody(req);
      if (!safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN)) return send(res, 403, { error: 'forbidden' });
      if (!b.text || !b.budget_usd) return send(res, 400, { error: 'missing_fields' });
      const c = {
        id: b.id || ('camp-' + Math.abs(hash(b.text + Date.now()))),
        advertiser: b.advertiser || 'unknown',
        text: String(b.text).slice(0, 80),
        url: b.url || null,
        cpm_usd: Number(b.cpm_usd || CPM_USD),
        budget_usd: Number(b.budget_usd),
        budget_remaining_usd: Number(b.budget_usd),
        status: b.status === 'approved' ? 'approved' : 'pending', // review gate
        created: Date.now()
      };
      await store.addCampaign(c);
      return send(res, 200, { ok: true, campaign: c });
    }

    // POST /campaign/submit — PUBLIC (no auth): let an advertiser self-submit a
    // campaign for review. It is created 'pending' and is therefore NEVER served
    // (store.activeCampaigns only returns 'approved') until an admin approves it
    // via POST /campaign/status. Inputs are validated/clamped exactly like the
    // admin POST /campaign path (a public caller is fully untrusted).
    //
    // Anti-abuse, two layers: the global per-IP per-second limiter (rateLimited,
    // applied above) throttles bursts, and a per-IP rolling-daily cap
    // (submissionsInWindow, mirroring the per-session impression cap) bounds the
    // total a single IP can create per day. cpm_usd/budget_usd are advisory here
    // (an admin reviews before serving) and are clamped non-negative.
    if (p === '/campaign/submit' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.text || !validEmail(b.contact_email)) return send(res, 400, { error: 'missing_fields' });
      const ip = clientKey(req);
      if (await store.submissionsInWindow(ip, DAY_MS) >= MAX_SUBMISSIONS_PER_IP_DAY) {
        return send(res, 429, { error: 'daily_cap' });
      }
      const budget = Math.max(0, Number(b.budget_usd) || 0);
      const c = {
        id: 'camp-' + Math.abs(hash(String(b.text) + Date.now())),
        advertiser: String(b.name || 'unknown').slice(0, 80),
        text: String(b.text).slice(0, 80),
        url: b.url ? String(b.url).slice(0, 300) : null,
        cpm_usd: Math.max(0, Number(b.cpm_usd) || CPM_USD),
        budget_usd: budget,
        budget_remaining_usd: budget,
        status: 'pending', // review gate — never served until an admin approves
        created: Date.now(),
        contact_email: normEmail(b.contact_email).slice(0, 254)
      };
      await store.addCampaign(c);
      await store.recordSubmission(ip); // count only accepted submissions toward the cap
      log(`campaign submitted (pending) id=${c.id} ip=${ip}`);
      return send(res, 200, { ok: true, id: c.id, status: 'pending' });
    }

    // POST /campaign/status — moderation (AD_POLICY.md): approve a reviewed
    // campaign, reject it, or freeze one that turns out to violate policy.
    // Admin-gated, same token as campaign creation. Only 'approved' campaigns
    // with budget left are ever served (store.activeCampaigns), so freezing or
    // rejecting takes a campaign out of rotation immediately without touching
    // its budget — a frozen campaign's remaining budget is preserved so it can
    // be un-frozen (back to 'pending'/'approved') or refunded out of band.
    if (p === '/campaign/status' && req.method === 'POST') {
      const b = await readBody(req);
      if (!safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN)) return send(res, 403, { error: 'forbidden' });
      if (!b.id) return send(res, 400, { error: 'missing_fields' });
      if (!CAMPAIGN_STATUSES.has(b.status)) {
        return send(res, 400, { error: 'invalid_status', allowed: [...CAMPAIGN_STATUSES] });
      }
      const c = await store.setCampaignStatus(b.id, b.status);
      if (!c) return send(res, 404, { error: 'unknown_campaign' });
      log(`campaign ${c.id} status=${c.status}`);
      return send(res, 200, { ok: true, campaign: c });
    }

    // POST /admin/publisher/recover — admin-assisted key recovery for a
    // publisher who lost their key. Same admin gate as POST /campaign
    // (x-admin-token). Body { payout_id, recovery_email }: on an EXACT match of
    // BOTH the publisher id and their stored recovery email, rotate the key and
    // return the new one once (same mechanism as /publisher/rotate-key).
    //
    // Enumeration resistance (same posture as the earnings IDOR fix): any
    // failure — unknown payout_id, no recovery email on file, or a mismatched
    // email — returns the SAME generic 404, so an admin-token holder can't probe
    // which publisher ids exist or brute-force recovery addresses field by field.
    // The per-IP limiter (rateLimited, applied above) bounds guessing rate.
    if (p === '/admin/publisher/recover' && req.method === 'POST') {
      const b = await readBody(req);
      if (!safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN)) return send(res, 403, { error: 'forbidden' });
      const rec = (typeof b.payout_id === 'string' && b.payout_id) ? await store.getPublisher(b.payout_id) : null;
      const match = rec && rec.recovery_email && validEmail(b.recovery_email) &&
        safeEqual(normEmail(b.recovery_email), rec.recovery_email);
      if (!match) return send(res, 404, { error: 'not found' });
      const rotated = await store.rotateKey(rec.id);
      log(`admin recover: key rotated pub=${rec.id}`);
      return send(res, 200, { ok: true, publisher_key: rotated.secret });
    }

    // GET /campaign/stats — advertiser/admin view of campaign spend and fill (admin-gated).
    if (p === '/campaign/stats' && req.method === 'GET') {
      if (!safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN)) return send(res, 403, { error: 'forbidden' });
      const camps = (await store.allCampaigns()).map((c) => ({
        id: c.id, advertiser: c.advertiser, status: c.status, cpm_usd: c.cpm_usd,
        budget_usd: c.budget_usd, budget_remaining_usd: c.budget_remaining_usd,
        spent_usd: store.round(c.budget_usd - c.budget_remaining_usd)
      }));
      return send(res, 200, { campaigns: camps });
    }

    // POST /connect/onboard — start Stripe Connect onboarding for the authed publisher.
    if (p === '/connect/onboard' && req.method === 'POST') {
      await readBody(req);
      const pub = await authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      let result;
      try { result = await stripeOnboard(pub.id); }
      catch (e) { return send(res, 502, { error: 'onboard_failed', detail: e.message }); }
      await store.setStripeAccount(pub.id, result.account);
      await store.setPayoutMethod(pub.id, 'stripe'); // linking a bank/card selects the Stripe rail
      return send(res, 200, { ok: true, url: result.url, account: result.account, simulated: !!result.simulated });
    }

    send(res, 404, { error: 'not_found' });
  } catch (e) {
    if (/JSON/i.test(e.message || '')) return send(res, 400, { error: 'bad_json' });
    log(`error ${e.message}`);
    return send(res, 500, { error: 'internal_error' });
  }
}

const server = http.createServer(handler);

process.on('SIGTERM', () => { Promise.resolve(store.close && store.close()).finally(() => process.exit(0)); });
process.on('SIGINT', () => { Promise.resolve(store.close && store.close()).finally(() => process.exit(0)); });

if (require.main === module) {
  ensureReady().then(() => {
    server.listen(PORT, () => log(`backend on http://localhost:${PORT} (store=${store.backend}, levels ${levels.LEVELS.filter(L => L.id > 0).map(L => `L${L.id}=$${L.cpm}`).join('/')} CPM, publisher ${PUBLISHER_SHARE * 100}%, min payout $${MIN_PAYOUT_USD})`));
  }).catch((e) => { log(`failed to start: ${e.message}`); process.exit(1); });
}
// Export both the http.Server (for tests/self-host) and the bare handler
// (for serverless adapters, e.g. api/index.js on Vercel).
module.exports = server;
module.exports.handler = handler;
