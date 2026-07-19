'use strict';
// Stripe payout adapter — dependency-free. Uses Stripe Connect transfers when
// STRIPE_SECRET_KEY is set; otherwise simulates a payout so the flow is testable
// without live credentials. Production: replace with the official `stripe` SDK
// and real Connect onboarding (see docs/DEPLOY.md).

const https = require('https');
const { URL } = require('url');

const KEY = process.env.STRIPE_SECRET_KEY || '';

// Publisher -> Stripe connected account id. In production this comes from the
// store after Connect onboarding; here it's read from env or config for testing.
function connectedAccount(pid, hint) {
  return hint || process.env.SPONSORIC_STRIPE_ACCT || null;
}

// Create a transfer (real) or simulate one (no key). Amount in USD.
function transfer(pid, amountUsd, opts, cb) {
  const acct = connectedAccount(pid, opts && opts.stripe_account);
  if (!KEY) {
    return cb(null, { id: 'sim_' + Date.now(), simulated: true, amount_usd: amountUsd, destination: acct || 'unlinked' });
  }
  if (!acct) return cb(new Error('no_connected_account'));

  const body = new URLSearchParams({
    amount: String(Math.round(amountUsd * 100)), // cents
    currency: 'usd',
    destination: acct,
    description: 'Sponsoric publisher payout'
  }).toString();

  const u = new URL('https://api.stripe.com/v1/transfers');
  const req = https.request(u, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    },
    timeout: 8000
  }, (res) => {
    let d = ''; res.on('data', (c) => d += c);
    res.on('end', () => {
      let j = null; try { j = JSON.parse(d); } catch (_) {}
      if (res.statusCode >= 200 && res.statusCode < 300 && j) return cb(null, { id: j.id, simulated: false, amount_usd: amountUsd, destination: acct });
      cb(new Error((j && j.error && j.error.message) || ('stripe_' + res.statusCode)));
    });
  });
  req.on('error', cb);
  req.on('timeout', () => req.destroy(new Error('stripe_timeout')));
  req.write(body);
  req.end();
}

// Start Connect onboarding. Real: create an Express account + AccountLink and
// return its URL. Simulated (no key): return a fake account id + placeholder URL
// so the payout flow is testable end-to-end without live credentials.
function onboard(pid, cb) {
  if (!KEY) {
    return cb(null, { account: 'acct_sim_' + Math.abs(hashStr(pid)), url: 'https://connect.stripe.com/setup/simulated', simulated: true });
  }
  // 1. Create the connected account.
  api('POST', 'https://api.stripe.com/v1/accounts', { type: 'express' }, (e1, acct) => {
    if (e1) return cb(e1);
    // 2. Create an onboarding AccountLink for it.
    const params = {
      account: acct.id,
      type: 'account_onboarding',
      refresh_url: (process.env.SPONSORIC_CONNECT_REFRESH || 'https://sponsoric.io/connect/refresh'),
      return_url: (process.env.SPONSORIC_CONNECT_RETURN || 'https://sponsoric.io/connect/done')
    };
    api('POST', 'https://api.stripe.com/v1/account_links', params, (e2, link) => {
      if (e2) return cb(e2);
      cb(null, { account: acct.id, url: link.url, simulated: false });
    });
  });
}

// Small form-encoded Stripe API helper.
function api(method, urlStr, fields, cb) {
  const body = new URLSearchParams(fields).toString();
  const u = new URL(urlStr);
  const req = https.request(u, {
    method,
    headers: {
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    },
    timeout: 8000
  }, (res) => {
    let d = ''; res.on('data', (c) => d += c);
    res.on('end', () => {
      let j = null; try { j = JSON.parse(d); } catch (_) {}
      if (res.statusCode >= 200 && res.statusCode < 300 && j) return cb(null, j);
      cb(new Error((j && j.error && j.error.message) || ('stripe_' + res.statusCode)));
    });
  });
  req.on('error', cb);
  req.on('timeout', () => req.destroy(new Error('stripe_timeout')));
  req.write(body);
  req.end();
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

module.exports = { transfer, onboard, live: !!KEY };
