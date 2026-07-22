'use strict';
// Stripe payout adapter — dependency-free (raw https, no SDK).
//
// Connect model: Cogwait is the PLATFORM. Each publisher is a v2 RECIPIENT
// account (Accounts v2, `/v2/core/accounts`) that requests the `stripe_transfers`
// capability on its `stripe_balance`. The platform holds the earned balance and
// pays a publisher with a v1 Transfer to their recipient account. This is the
// current Stripe-mandated pattern — the deprecated v1 `type: 'express'` account
// creation was removed (Stripe: never use type express/custom/standard).
//
// Live vs simulated: real calls fire only when STRIPE_SECRET_KEY (an `sk_`/`rk_`
// key) is set. Without it every call is simulated so the whole payout flow stays
// testable with no credentials — the simulate return shapes are byte-identical to
// before, so the server tests are unaffected.
//
// Env:
//   STRIPE_SECRET_KEY        sk_live_… or (recommended) a restricted rk_live_…
//                            scoped to Connect (accounts + account_links) + Transfers.
//   STRIPE_API_VERSION       pinned API version for the v2 calls (default below).
//   COGWAIT_ACCOUNT_COUNTRY  recipient account country (default US).
//   COGWAIT_CONNECT_RETURN   onboarding return_url  (HTTPS required in live mode).
//   COGWAIT_CONNECT_REFRESH  onboarding refresh_url (HTTPS required in live mode).

const https = require('https');
const { URL } = require('url');

const KEY = process.env.STRIPE_SECRET_KEY || '';
// v2 core endpoints are version-gated; pin one so responses are stable. Overridable.
const API_VERSION = process.env.STRIPE_API_VERSION || '2026-06-24.dahlia';
const COUNTRY = process.env.COGWAIT_ACCOUNT_COUNTRY || 'US';
const RETURN_URL = process.env.COGWAIT_CONNECT_RETURN || 'https://cogwait.io/connect/done';
const REFRESH_URL = process.env.COGWAIT_CONNECT_REFRESH || 'https://cogwait.io/connect/refresh';

// Publisher -> Stripe connected account id. In production this comes from the
// store after Connect onboarding; env override kept for local/manual testing.
function connectedAccount(pid, hint) {
  return hint || process.env.COGWAIT_STRIPE_ACCT || null;
}

// ---- Pay a publisher: v1 Transfer to their recipient account. Amount in USD. ----
// opts.idempotency_key, when present, is forwarded as Stripe's Idempotency-Key so a
// retried request never double-transfers server-side. On the simulated path it's a
// no-op — the caller's pending/settled marker carries idempotency there (server/index.js).
function transfer(pid, amountUsd, opts, cb) {
  const acct = connectedAccount(pid, opts && opts.stripe_account);
  if (!KEY) {
    return cb(null, { id: 'sim_' + Date.now(), simulated: true, amount_usd: amountUsd, destination: acct || 'unlinked' });
  }
  if (!acct) return cb(new Error('no_connected_account'));

  // Fail fast if the recipient can't yet receive transfers, so we never fire a
  // doomed live transfer (Stripe would reject it, but this gives a clear reason).
  recipientReady(acct, (rerr, ready) => {
    if (rerr) return cb(rerr);
    if (!ready) return cb(new Error('recipient_not_ready'));

    const fields = {
      amount: String(Math.round(amountUsd * 100)), // cents
      currency: 'usd',
      destination: acct,
      description: 'Cogwait publisher payout'
    };
    const extra = {};
    const idem = opts && opts.idempotency_key;
    if (idem) extra['Idempotency-Key'] = String(idem);

    apiForm('POST', 'https://api.stripe.com/v1/transfers', fields, extra, (e, j) => {
      if (e) return cb(e);
      cb(null, { id: j.id, simulated: false, amount_usd: amountUsd, destination: acct });
    });
  });
}

// ---- Onboard a publisher: create a v2 recipient account + a hosted onboarding link. ----
function onboard(pid, cb) {
  if (!KEY) {
    return cb(null, { account: 'acct_sim_' + Math.abs(hashStr(pid)), url: 'https://connect.stripe.com/setup/simulated', simulated: true });
  }
  // 1. Create the recipient account (Accounts v2). Request stripe_transfers so the
  //    platform can pay it; the platform is the fees/losses collector (dashboard: express).
  const account = {
    identity: { country: COUNTRY },
    dashboard: 'express',
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    include: ['configuration.recipient', 'requirements']
  };
  apiJson('POST', 'https://api.stripe.com/v2/core/accounts', account, {}, (e1, acct) => {
    if (e1) return cb(e1);
    // 2. Create a hosted onboarding Account Link (Accounts v2) for that account.
    const link = {
      account: acct.id,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          return_url: RETURN_URL,
          refresh_url: REFRESH_URL
        }
      }
    };
    apiJson('POST', 'https://api.stripe.com/v2/core/account_links', link, {}, (e2, l) => {
      if (e2) return cb(e2);
      cb(null, { account: acct.id, url: l.url, simulated: false });
    });
  });
}

// ---- Is a recipient account ready to receive transfers? (v2 capability status) ----
// Simulated (no key) accounts are always "ready" so the local flow completes.
function recipientReady(acct, cb) {
  if (!KEY) return cb(null, true);
  if (String(acct).startsWith('acct_sim_')) return cb(null, true);
  const url = 'https://api.stripe.com/v2/core/accounts/' + encodeURIComponent(acct) + '?include=configuration.recipient';
  apiJson('GET', url, null, {}, (e, a) => {
    if (e) return cb(e);
    const st = a && a.configuration && a.configuration.recipient
      && a.configuration.recipient.capabilities
      && a.configuration.recipient.capabilities.stripe_balance
      && a.configuration.recipient.capabilities.stripe_balance.stripe_transfers
      && a.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status;
    cb(null, st === 'active');
  });
}

// ---- HTTP helpers ----

// v1 form-encoded (transfers).
function apiForm(method, urlStr, fields, extraHeaders, cb) {
  const body = new URLSearchParams(fields).toString();
  send(method, urlStr, body, Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, extraHeaders || {}), cb);
}

// v2 JSON (core accounts + account links). `obj` null for GET.
function apiJson(method, urlStr, obj, extraHeaders, cb) {
  const body = obj ? JSON.stringify(obj) : null;
  const headers = Object.assign({ 'Stripe-Version': API_VERSION }, extraHeaders || {});
  if (body) headers['Content-Type'] = 'application/json';
  send(method, urlStr, body, headers, cb);
}

function send(method, urlStr, body, headers, cb) {
  const u = new URL(urlStr);
  const h = Object.assign({ 'Authorization': 'Bearer ' + KEY }, headers);
  if (body) h['Content-Length'] = Buffer.byteLength(body);
  const req = https.request(u, { method, headers: h, timeout: 8000 }, (res) => {
    let d = ''; res.on('data', (c) => d += c);
    res.on('end', () => {
      let j = null; try { j = d ? JSON.parse(d) : {}; } catch (_) {}
      if (res.statusCode >= 200 && res.statusCode < 300 && j) return cb(null, j);
      cb(new Error((j && j.error && (j.error.message || j.error.code)) || ('stripe_' + res.statusCode)));
    });
  });
  req.on('error', cb);
  req.on('timeout', () => req.destroy(new Error('stripe_timeout')));
  if (body) req.write(body);
  req.end();
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

module.exports = { transfer, onboard, recipientReady, live: !!KEY };
