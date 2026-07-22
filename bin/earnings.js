#!/usr/bin/env node
'use strict';
// cogwait --earnings — read your ledger from the backend and print it.
// Read-only: GET /earnings, scoped server-side to the authenticated publisher
// (the id in a request is ignored; identity comes from the key). Nothing is
// written locally and no money moves — see `npx cogwait --cashout` for that.

const client = require('../lib/client');
const levels = require('../lib/levels');

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const usd4 = (n) => `$${(Number(n) || 0).toFixed(4)}`;
const when = (ts) => (ts ? new Date(Number(ts)).toISOString().slice(0, 10) : '—');

if (!client.PAYOUT_ID || !client.PUBLISHER_KEY) {
  console.error('✗ Not registered — there is no ledger to read yet.');
  console.error('  1. export COGWAIT_PAYOUT_ID="your-id"');
  console.error('  2. npx cogwait --register');
  process.exit(1);
}
if (client.MOCK) {
  console.log('• COGWAIT_MOCK=1 — demo mode never contacts the backend, so there are no earnings to report.');
  console.log('  Unset COGWAIT_MOCK to read your real ledger.');
  return;
}

console.log(`Cogwait earnings — ${client.PAYOUT_ID} @ ${client.API_BASE}\n`);
client.request('GET', `${client.API_BASE}/earnings`, null, 8000, (err, code, json) => {
  if (err) {
    console.error(`✗ Cannot reach ${client.API_BASE}: ${err.message}`);
    console.error('  Check your connection, or point elsewhere with COGWAIT_API.');
    process.exit(1);
  }
  if (code === 401) {
    console.error('✗ Rejected (401). The stored publisher key does not match this payout id.');
    console.error('  Re-register on this machine, or restore the key you registered with.');
    process.exit(1);
  }
  if (code !== 200 || !json) {
    console.error('✗ Unexpected response:', code, (json && json.error) || '');
    process.exit(1);
  }

  const balance = Number(json.balance_usd) || 0;
  const impressions = Number(json.impressions) || 0;
  const min = Number(json.min_payout_usd) || 0;
  const payouts = Array.isArray(json.payouts) ? json.payouts : [];
  // Lifetime = what's still in the balance plus everything already paid out
  // (both legs — a Fund-OSS donation was still earned by this publisher).
  const paidOut = payouts.reduce((s, p) => s + (Number(p.amount_usd) || 0), 0);
  const lifetime = balance + paidOut;
  // Effective net CPM: what 1000 viewable impressions actually earned, after
  // the revenue share. Compare it against the gross tier CPM below it.
  const effCpm = impressions > 0 ? (lifetime / impressions) * 1000 : 0;

  const row = (k, v) => console.log('  ' + String(k).padEnd(16) + v);
  row('balance', usd(balance) + '  (unpaid)');
  row('lifetime', usd(lifetime) + `  (${usd(paidOut)} already paid out)`);
  row('impressions', String(impressions));
  row('effective CPM', impressions > 0
    ? `${usd4(effCpm)} net per 1000 — gross tier is $${levels.cpmForLevel(client.LEVEL)} at level ${client.LEVEL}`
    : 'n/a — no viewable impressions recorded yet');
  row('give-back', `${json.donate_pct}% of each cash-out goes to open source`);
  row('rail', json.payout_method === 'paypal'
    ? `PayPal → ${json.paypal_email || '(no email set — npx cogwait --paypal you@example.com)'}`
    : (json.stripe_linked ? 'bank/card via Stripe Connect (linked)' : 'bank/card via Stripe Connect (not linked — npx cogwait --connect)'));

  const gap = min - balance;
  row('minimum', usd(min) + (gap > 0
    ? `  — ${usd(gap)} to go`
    : '  — reached; cash out with `npx cogwait --cashout`'));

  console.log('');
  if (!payouts.length) {
    console.log('  No payouts yet.');
  } else {
    console.log('  Recent payouts');
    const recent = payouts.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 10);
    for (const p of recent) {
      const kind = p.kind === 'donation' ? `give-back → ${p.fund || 'OSS fund'}` : 'cash-out';
      const sim = p.simulated ? ' (simulated)' : '';
      console.log(`    ${when(p.ts)}  ${usd(p.amount_usd).padStart(10)}  ${kind}${sim}`);
    }
    if (payouts.length > recent.length) console.log(`    … and ${payouts.length - recent.length} more`);
  }
});
