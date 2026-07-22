#!/usr/bin/env node
'use strict';
// cogwait --connect / --paypal <email> — link a cash-out destination.
//   --connect          start Stripe Connect onboarding (bank account or card)
//                      and print the hosted URL to finish it.
//   --paypal <email>   set PayPal as the cashout rail, paying out to <email>.
// Both require a registered publisher (run `npx cogwait --register` first).

const client = require('../lib/client');

if (!client.PAYOUT_ID || !client.PUBLISHER_KEY) {
  console.error('✗ Not registered. Run `npx cogwait --register` first (needs COGWAIT_PAYOUT_ID).');
  process.exit(1);
}

const argv = process.argv;
function flagValue(name) {
  const eq = argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (argv.includes('--paypal')) {
  const email = (flagValue('--paypal') || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('✗ Usage: npx cogwait --paypal you@example.com');
    process.exit(1);
  }
  console.log(`Setting PayPal payout for "${client.PAYOUT_ID}" (${email}) …`);
  client.setPayoutMethod('paypal', email, (err, code, json) => {
    if (err) { console.error('✗ Cannot reach backend:', err.message); process.exit(1); }
    if (code === 200 && json && json.ok) {
      console.log(`✓ PayPal set. Cash-outs go to ${json.paypal_email || email}. Minimum cash-out is $10.`);
    } else {
      console.error('✗ Failed:', code, json && json.error);
      process.exit(1);
    }
  });
} else {
  // --connect: Stripe Connect onboarding for a bank account or card.
  console.log(`Starting bank/card onboarding for "${client.PAYOUT_ID}" …`);
  client.connectStripe((err, code, json) => {
    if (err) { console.error('✗ Cannot reach backend:', err.message); process.exit(1); }
    if (code === 200 && json && json.url) {
      console.log('✓ Open this link to finish linking your bank account or card:');
      console.log('  ' + json.url);
      if (json.simulated) console.log('  (simulated — the backend has no live Stripe key set)');
      console.log('  Once linked, cash out from the dashboard. Minimum cash-out is $10.');
    } else {
      console.error('✗ Onboarding failed:', code, json && json.error);
      process.exit(1);
    }
  });
}
