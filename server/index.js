#!/usr/bin/env node
'use strict';
// Sponsoric backend — dependency-free reference implementation of the contract
// in README.md, now with a persistent store, rate limiting, fraud caps,
// campaign-based ad serving, and Stripe payouts. Single-node; for production
// swap store.js for Postgres and deploy behind the platform in docs/DEPLOY.md.

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const store = require('./store');
const stripe = require('../lib/stripe');
const levels = require('../lib/levels');

const PORT = Number(process.env.PORT || 8787);
// Base/fallback CPM for a campaign that doesn't set its own. Level-based pricing
// (lib/levels.js) is what a viewable impression is actually worth.
const CPM_USD = Number(process.env.SPONSORIC_CPM || levels.cpmForLevel(levels.DEFAULT_LEVEL));
const PUBLISHER_SHARE = Number(process.env.SPONSORIC_SHARE || 0.7);
const MIN_PAYOUT_USD = Number(process.env.SPONSORIC_MIN_PAYOUT || 10);

// Refuse to start without a real admin token — no default that ships open.
const ADMIN_TOKEN = process.env.SPONSORIC_ADMIN_TOKEN || '';
if (!ADMIN_TOKEN || ADMIN_TOKEN === 'dev-admin') {
  throw new Error('SPONSORIC_ADMIN_TOKEN is required and must not be the default. Set a strong random value (e.g. `openssl rand -hex 16`).');
}

// Constant-time string comparison to avoid timing side channels on secrets.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Authenticate a publisher from `Authorization: Publisher <id>:<secret>`.
// Returns the record only when the secret matches the stored one. Never creates.
function authPublisher(req) {
  const m = /^Publisher\s+([^:\s]+):(.+)$/.exec(req.headers['authorization'] || '');
  if (!m) return null;
  const rec = store.getPublisher(m[1]);
  if (!rec || !rec.secret) return null;
  return safeEqual(m[2], rec.secret) ? rec : null;
}

// Fraud/rate limits.
const DEDUPE_MS = 10000;                 // same tag+ad within window = not billable
const MAX_IMPRESSIONS_PER_SESSION_DAY = 500;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = Number(process.env.SPONSORIC_RATE_MAX || 20); // requests/sec per key

// What one viewable impression pays the publisher, by ad level. The level is
// client-declared but never trusted blindly: it's clamped to a valid tier and
// priced from the server's own CPM table, so a client can't invent a payout.
const perImpression = (level) => levels.perImpression(level, PUBLISHER_SHARE);
const rate = new Map();                   // key -> {count, reset}
const dedupe = new Map();                 // tag:ad -> ts

// Default house ads used when no advertiser campaign has budget (keeps fill at 100%).
const HOUSE_ADS = [
  { id: 'house-neon', text: 'Neon — serverless Postgres that scales to zero', url: 'https://neon.tech' },
  { id: 'house-warp', text: 'Warp — the terminal reimagined for AI-native devs', url: 'https://warp.dev' },
  { id: 'house-sentry', text: 'Sentry — see errors before your users do', url: 'https://sentry.io' }
];

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, cb) {
  let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(null, d ? JSON.parse(d) : {}); } catch (e) { cb(e); } });
}
function rateLimited(key) {
  const now = Date.now();
  let r = rate.get(key);
  if (!r || now > r.reset) { r = { count: 0, reset: now + RATE_WINDOW_MS }; rate.set(key, r); }
  r.count += 1;
  return r.count > RATE_MAX;
}
function clientKey(req) {
  return (req.socket && req.socket.remoteAddress) || 'local';
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function log(m) { if (process.env.SPONSORIC_QUIET !== '1') process.stderr.write(`[sponsoric] ${m}\n`); }

// Pick an ad: prefer an approved campaign with budget, else a house ad.
function pickAd(tag) {
  const camps = store.activeCampaigns();
  if (camps.length) {
    const c = camps[Math.abs(hash(tag + Math.floor(Date.now() / 20000))) % camps.length];
    return { id: c.id, text: c.text, url: c.url, campaign: true, cpm: c.cpm_usd };
  }
  const a = HOUSE_ADS[Math.abs(hash(tag + Math.floor(Date.now() / 20000))) % HOUSE_ADS.length];
  return Object.assign({ campaign: false, cpm: CPM_USD }, a);
}

function handler(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  if (rateLimited(clientKey(req))) return send(res, 429, { error: 'rate_limited' });

  if (p === '/health') return send(res, 200, {
    ok: true,
    publisher_share: PUBLISHER_SHARE,
    // Per-impression payout and gross CPM for every ad level.
    levels: levels.LEVELS.map((L) => ({
      id: L.id, key: L.key, label: L.label, cpm_usd: L.cpm,
      per_impression_usd: store.round(perImpression(L.id))
    })),
    per_impression_usd: store.round(perImpression(levels.DEFAULT_LEVEL)), // default tier, for back-compat
    stripe_live: stripe.live
  });

  if (p === '/ad/next' && req.method === 'GET') {
    const tag = u.searchParams.get('tag') || 'anon';
    return send(res, 200, pickAd(tag));
  }

  // POST /session/init — register a new publisher (returns the secret ONCE), or
  // start a session for an existing one (requires the secret). The secret is the
  // credential the client stores and sends on every publisher-scoped request.
  if (p === '/session/init' && req.method === 'POST') {
    return readBody(req, (err, b) => {
      if (err) return send(res, 400, { error: 'bad_json' });
      const pid = b.publisher_id;
      if (!pid) return send(res, 401, { error: 'missing_publisher_id' });
      const existing = store.getPublisher(pid);
      if (!existing) {
        const rec = store.publisher(pid); // creates with a fresh secret
        return send(res, 200, { ok: true, publisher_id: pid, secret: rec.secret, session: 'sess-' + hash(pid + Date.now()), registered: true });
      }
      const auth = authPublisher(req);
      if (!auth || auth.id !== pid) return send(res, 401, { error: 'invalid_credentials' });
      return send(res, 200, { ok: true, publisher_id: pid, session: 'sess-' + hash(pid + Date.now()) });
    });
  }

  if (p === '/impression' && req.method === 'POST') {
    return readBody(req, (err, b) => {
      if (err) return send(res, 400, { error: 'bad_json' });
      const auth = authPublisher(req);           // credit only the authenticated publisher
      if (!auth) return send(res, 401, { error: 'unauthorized' });
      const pid = auth.id;                        // ignore any body-supplied publisher_id
      if (b.surface !== 'statusline') return send(res, 422, { error: 'unsupported_surface' });

      // Fraud: dedupe replays.
      const key = `${b.session_tag}:${b.ad_id}`;
      const now = Date.now();
      const last = dedupe.get(key);
      if (last && now - last < DEDUPE_MS) {
        return send(res, 200, { ok: true, credited_usd: 0, balance_usd: store.publisher(pid).balance_usd, deduped: true });
      }
      // Fraud: per-session daily cap.
      if (store.impressionsInWindow(b.session_tag, 86400000) >= MAX_IMPRESSIONS_PER_SESSION_DAY) {
        return send(res, 200, { ok: true, credited_usd: 0, balance_usd: store.publisher(pid).balance_usd, capped: true });
      }
      dedupe.set(key, now);

      // Price by the ad level that rendered. Clamp the client-declared level to a
      // valid tier (never trust a raw number) and pay from the server's CPM table.
      const lvl = levels.clampLevel(b.level === undefined ? levels.DEFAULT_LEVEL : b.level);
      const amount = store.round(perImpression(lvl));
      const pub = store.creditImpression(pid, amount, { ad_id: b.ad_id, session_tag: b.session_tag, level: lvl });
      // If this ad was a paid campaign, decrement its budget by the gross CPM value at this level.
      const camp = store.load().campaigns[b.ad_id];
      if (camp) store.spendCampaign(b.ad_id, store.round(levels.cpmForLevel(lvl) / 1000));
      log(`impression pub=${pid} ad=${b.ad_id} L${lvl} +$${amount.toFixed(4)} bal=$${pub.balance_usd.toFixed(4)}`);
      return send(res, 200, { ok: true, credited_usd: amount, level: lvl, balance_usd: pub.balance_usd });
    });
  }

  if (p === '/earnings' && req.method === 'GET') {
    const auth = authPublisher(req);             // scope strictly to the authenticated publisher
    if (!auth) return send(res, 401, { error: 'unauthorized' });
    const pub = auth;                            // query-param publisher_id is ignored for scoping
    return send(res, 200, {
      publisher_id: pub.id, impressions: pub.impressions, balance_usd: pub.balance_usd,
      min_payout_usd: MIN_PAYOUT_USD, payouts: store.payoutsFor(pub.id)
    });
  }

  // POST /payout — pay out the publisher's balance via Stripe (real or simulated).
  if (p === '/payout' && req.method === 'POST') {
    return readBody(req, (err) => {
      if (err) return send(res, 400, { error: 'bad_json' });
      const pub = authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      const pid = pub.id;
      if (pub.balance_usd < MIN_PAYOUT_USD) {
        return send(res, 400, { error: 'below_minimum', balance_usd: pub.balance_usd, min_payout_usd: MIN_PAYOUT_USD });
      }
      const amount = pub.balance_usd;
      // Destination is the publisher's server-side connected account — never from the request body.
      stripe.transfer(pid, amount, { stripe_account: pub.stripe_account }, (e, result) => {
        if (e) return send(res, 502, { error: 'payout_failed', detail: e.message });
        pub.balance_usd = 0;
        const rec = { pid, amount_usd: amount, ts: Date.now(), transfer: result.id, simulated: !!result.simulated };
        store.recordPayout(rec);
        store.persist();
        log(`payout pub=${pid} $${amount.toFixed(2)} ${result.simulated ? '(simulated)' : ''} -> ${result.id}`);
        return send(res, 200, { ok: true, paid_usd: amount, transfer: result.id, simulated: !!result.simulated });
      });
    });
  }

  // POST /campaign — advertiser creates a campaign (admin-gated in this stub).
  if (p === '/campaign' && req.method === 'POST') {
    return readBody(req, (err, b) => {
      if (err) return send(res, 400, { error: 'bad_json' });
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
      store.addCampaign(c);
      return send(res, 200, { ok: true, campaign: c });
    });
  }

  // GET /campaign/stats — advertiser/admin view of campaign spend and fill (admin-gated).
  if (p === '/campaign/stats' && req.method === 'GET') {
    if (!safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN)) return send(res, 403, { error: 'forbidden' });
    const camps = Object.values(store.load().campaigns).map((c) => ({
      id: c.id, advertiser: c.advertiser, status: c.status, cpm_usd: c.cpm_usd,
      budget_usd: c.budget_usd, budget_remaining_usd: c.budget_remaining_usd,
      spent_usd: store.round(c.budget_usd - c.budget_remaining_usd)
    }));
    return send(res, 200, { campaigns: camps });
  }

  // POST /connect/onboard — start Stripe Connect onboarding for the authed publisher.
  // With a live Stripe key this returns a real AccountLink URL; without one it
  // simulates onboarding and marks a connected account so payouts can be tested.
  if (p === '/connect/onboard' && req.method === 'POST') {
    return readBody(req, (err) => {
      if (err) return send(res, 400, { error: 'bad_json' });
      const pub = authPublisher(req);
      if (!pub) return send(res, 401, { error: 'unauthorized' });
      stripe.onboard(pub.id, (e, result) => {
        if (e) return send(res, 502, { error: 'onboard_failed', detail: e.message });
        store.setStripeAccount(pub.id, result.account);
        return send(res, 200, { ok: true, url: result.url, account: result.account, simulated: !!result.simulated });
      });
    });
  }

  send(res, 404, { error: 'not_found' });
}

const server = http.createServer(handler);

process.on('SIGTERM', () => { store.flush(); process.exit(0); });
process.on('SIGINT', () => { store.flush(); process.exit(0); });

if (require.main === module) {
  server.listen(PORT, () => log(`backend on http://localhost:${PORT} (levels ${levels.LEVELS.filter(L => L.id > 0).map(L => `L${L.id}=$${L.cpm}`).join('/')} CPM, publisher ${PUBLISHER_SHARE * 100}%, min payout $${MIN_PAYOUT_USD})`));
}
// Export both the http.Server (for tests/self-host) and the bare handler
// (for serverless adapters, e.g. api/index.js on Vercel).
module.exports = server;
module.exports.handler = handler;
