#!/usr/bin/env node
'use strict';
// PayPal adapter unit test — exercises the simulated (no-creds) path only, so it
// runs offline with no PayPal account. The live path (OAuth + Payouts API) is
// network-bound and covered by the simulate-without-creds contract, mirroring
// how lib/stripe.js is tested via the backend suite.

// Ensure no creds leak in from the environment — force the sim path deterministically.
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_SECRET;
const paypal = require('../lib/paypal');

let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
const payout = (email, amount, opts) => new Promise((res, rej) => paypal.payout(email, amount, opts, (e, r) => e ? rej(e) : res(r)));

(async () => {
  console.log('Cogwait PayPal adapter test');

  assert(paypal.live === false, 'adapter reports not-live without PAYPAL_CLIENT_ID/SECRET');

  const r = await payout('jane@example.com', 12.34, { idempotency_key: 'payout_pp_abc_cashout' });
  assert(r.simulated === true, 'simulated payout without creds');
  assert(/^sim_pp_/.test(r.id), `simulated transfer id is prefixed sim_pp_ (got ${r.id})`);
  assert(r.amount_usd === 12.34, 'simulated payout echoes the amount');
  assert(r.destination === 'jane@example.com', 'simulated payout targets the given email');

  // No email + sim path: still succeeds (marks destination 'unlinked'), same
  // shape as lib/stripe.js's simulated transfer to an unlinked account.
  const noEmail = await payout('', 5, {});
  assert(noEmail.simulated === true && noEmail.destination === 'unlinked', 'sim payout with no email marks destination unlinked');

  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
