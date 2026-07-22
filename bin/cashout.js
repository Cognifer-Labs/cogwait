#!/usr/bin/env node
'use strict';
// cogwait --cashout — pay your balance out from the terminal.
//
// This one moves real money, so it is deliberately the slowest command in the
// CLI: it reads the ledger first, prints the exact amount and the Fund-OSS
// split, and refuses to send anything until you type `y`. `--yes` skips the
// prompt for scripts; with no TTY and no `--yes` it aborts rather than guessing
// consent. The split shown is computed from the server's own donate_pct, but
// the server recomputes and clamps it under a row lock at /payout — the client
// never decides who gets paid what.

const readline = require('readline');
const client = require('../lib/client');

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const assumeYes = process.argv.includes('--yes') || process.argv.includes('-y');

if (!client.PAYOUT_ID || !client.PUBLISHER_KEY) {
  console.error('✗ Not registered. Run `npx cogwait --register` first (needs COGWAIT_PAYOUT_ID).');
  process.exit(1);
}
if (client.MOCK) {
  console.error('✗ COGWAIT_MOCK=1 — demo mode has no real balance and cannot cash out.');
  process.exit(1);
}

function confirm(question, cb) {
  if (assumeYes) { console.log(question + ' y   (--yes)'); return cb(true); }
  if (!process.stdin.isTTY) {
    console.error('✗ Not a terminal — refusing to move money without confirmation.');
    console.error('  Re-run interactively, or pass --yes if you are scripting this deliberately.');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question + ' ', (answer) => {
    rl.close();
    cb(String(answer).trim().toLowerCase() === 'y');
  });
}

console.log(`Cogwait cash-out — ${client.PAYOUT_ID} @ ${client.API_BASE}\n`);

// 1. Read the ledger so the confirmation shows real numbers, not a guess.
client.request('GET', `${client.API_BASE}/earnings`, null, 8000, (err, code, json) => {
  if (err) { console.error(`✗ Cannot reach ${client.API_BASE}: ${err.message}`); process.exit(1); }
  if (code === 401) { console.error('✗ Rejected (401) — the stored publisher key does not match this payout id.'); process.exit(1); }
  if (code !== 200 || !json) { console.error('✗ Unexpected response:', code, (json && json.error) || ''); process.exit(1); }

  const balance = Number(json.balance_usd) || 0;
  const min = Number(json.min_payout_usd) || 0;
  const pct = Math.max(0, Math.min(100, Number(json.donate_pct) || 0));
  if (balance < min) {
    console.log(`• Balance ${usd(balance)} is below the ${usd(min)} minimum — ${usd(min - balance)} to go.`);
    console.log('  Nothing was sent.');
    return;
  }
  const donate = Math.round(balance * pct) / 100;
  const keep = Math.round((balance - donate) * 100) / 100;
  const rail = json.payout_method === 'paypal'
    ? `PayPal → ${json.paypal_email || '(none set!)'}`
    : (json.stripe_linked ? 'bank/card via Stripe Connect' : 'bank/card via Stripe Connect (NOT linked yet)');

  const lbl = (s) => ('  ' + s).padEnd(18);
  console.log(lbl('balance') + usd(balance));
  console.log(lbl('→ you') + usd(keep) + `   via ${rail}`);
  console.log(lbl('→ open source') + usd(donate) + `   your ${pct}% give-back`);
  console.log('');
  console.log('  This moves real money and cannot be undone from here.');

  confirm('  Cash out ' + usd(balance) + '? [y/N]', (yes) => {
    if (!yes) { console.log('• Cancelled. Nothing was sent.'); return; }
    console.log('  Requesting payout …');
    client.requestPayout((e2, c2, j2) => {
      if (e2) {
        console.error('✗ Cannot reach backend:', e2.message);
        console.error('  Nothing is lost — the balance is untouched unless the server accepted the request.');
        process.exit(1);
      }
      if (c2 === 400 && j2 && j2.error === 'below_minimum') {
        console.error(`✗ Below the ${usd(j2.min_payout_usd)} minimum (balance ${usd(j2.balance_usd)}).`);
        process.exit(1);
      }
      if (c2 !== 200 || !j2 || !j2.ok) {
        console.error('✗ Payout failed:', c2, (j2 && j2.error) || '');
        if (j2 && j2.partial) console.error('  Partially settled — re-run `npx cogwait --cashout` to resume the outstanding leg (it is idempotent).');
        process.exit(1);
      }
      const t = j2.transfers || {};
      console.log('');
      console.log(`✓ Paid out ${usd(j2.paid_usd)} to you, ${usd(j2.donated_usd)} to open source.`);
      console.log('  cash-out transfer: ' + (t.cashout || '—'));
      console.log('  give-back transfer: ' + (t.donation || '—'));
      if (j2.simulated) console.log('  (simulated — the backend has no live payout key set, so no money actually moved)');
    });
  });
});
