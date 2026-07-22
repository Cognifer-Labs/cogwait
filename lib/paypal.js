'use strict';
// PayPal payout adapter — dependency-free. Uses the PayPal Payouts API when
// PAYPAL_CLIENT_ID + PAYPAL_SECRET are set; otherwise simulates a payout so the
// flow is testable without live credentials — exactly like lib/stripe.js does.
// Production: create a PayPal business account, enable Payouts, and set the two
// creds (and PAYPAL_ENV=live) — see docs/DEPLOY.md.

const https = require('https');
const { URL } = require('url');

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const SECRET = process.env.PAYPAL_SECRET || '';
const LIVE = !!(CLIENT_ID && SECRET);
// sandbox by default — real transfers only once the operator opts into live.
const HOST = process.env.PAYPAL_ENV === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';

// Send a payout to a PayPal email (real) or simulate one (no creds). Amount in USD.
// opts.idempotency_key, when present, becomes the payout's `sender_batch_id` —
// PayPal's native dedupe key — so a retried request never double-pays server-side.
// On the simulated (no-creds) path it's a no-op: the caller's own pending/settled
// marker carries idempotency there (see server/index.js).
function payout(email, amountUsd, opts, cb) {
  if (!LIVE) {
    return cb(null, { id: 'sim_pp_' + Date.now(), simulated: true, amount_usd: amountUsd, destination: email || 'unlinked' });
  }
  if (!email) return cb(new Error('no_paypal_email'));

  token((tErr, accessToken) => {
    if (tErr) return cb(tErr);
    const idempotencyKey = (opts && opts.idempotency_key) || ('pp_' + Date.now());
    const body = JSON.stringify({
      sender_batch_header: {
        sender_batch_id: String(idempotencyKey),
        email_subject: 'Cogwait publisher payout'
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: amountUsd.toFixed(2), currency: 'USD' },
        receiver: email,
        note: 'Cogwait publisher payout'
      }]
    });
    request('POST', `https://${HOST}/v1/payments/payouts`, body, {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    }, (err, status, json) => {
      if (err) return cb(err);
      // 201 Created with a payout_batch_id is success. PayPal processes the
      // transfer asynchronously, but the batch being accepted is what we settle on.
      const batchId = json && json.batch_header && json.batch_header.payout_batch_id;
      if (status >= 200 && status < 300 && batchId) {
        return cb(null, { id: batchId, simulated: false, amount_usd: amountUsd, destination: email });
      }
      cb(new Error((json && (json.message || json.name)) || ('paypal_' + status)));
    });
  });
}

// OAuth2 client-credentials token for the Payouts call.
function token(cb) {
  const creds = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
  request('POST', `https://${HOST}/v1/oauth2/token`, 'grant_type=client_credentials', {
    'Authorization': 'Basic ' + creds,
    'Content-Type': 'application/x-www-form-urlencoded'
  }, (err, status, json) => {
    if (err) return cb(err);
    if (status >= 200 && status < 300 && json && json.access_token) return cb(null, json.access_token);
    cb(new Error((json && (json.error_description || json.error)) || ('paypal_token_' + status)));
  });
}

// Minimal JSON/form HTTPS helper with a hard timeout.
function request(method, urlStr, body, headers, cb) {
  const u = new URL(urlStr);
  const h = Object.assign({ 'Content-Length': Buffer.byteLength(body || '') }, headers);
  const req = https.request(u, { method, headers: h, timeout: 8000 }, (res) => {
    let d = ''; res.on('data', (c) => d += c);
    res.on('end', () => {
      let j = null; try { j = JSON.parse(d); } catch (_) {}
      cb(null, res.statusCode, j);
    });
  });
  req.on('error', cb);
  req.on('timeout', () => req.destroy(new Error('paypal_timeout')));
  if (body) req.write(body);
  req.end();
}

module.exports = { payout, live: LIVE };
