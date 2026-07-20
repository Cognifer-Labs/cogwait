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

// Fraud/rate limits.
const DEDUPE_MS = 10000;                 // same tag+ad within window = not billable (atomic in store)
const MAX_IMPRESSIONS_PER_SESSION_DAY = 500;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = Number(process.env.COGWAIT_RATE_MAX || 20); // requests/sec per key (per-instance)

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
      stripe_live: stripe.live
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
      const stripeAccount = claim.pub ? claim.pub.stripe_account : pub.stripe_account;
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
          const result = await stripeTransfer(pid, cashoutRow.amount_usd, {
            stripe_account: stripeAccount, idempotency_key: cashoutRow.idempotency_key
          });
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

      log(`payout pub=${pid} keep=$${cashoutRow ? cashoutRow.amount_usd.toFixed(4) : '0'} donate=$${donationRow ? donationRow.amount_usd.toFixed(4) : '0'} ${simulated ? '(simulated)' : ''}`);
      return send(res, 200, {
        ok: true,
        paid_usd: cashoutRow ? cashoutRow.amount_usd : 0,
        donated_usd: donationRow ? donationRow.amount_usd : 0,
        transfers: { cashout: cashoutRow ? cashoutRow.transfer : null, donation: donationRow ? donationRow.transfer : null },
        simulated
      });
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
