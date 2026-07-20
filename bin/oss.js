#!/usr/bin/env node
'use strict';
// cogwait --oss / --donate — Fund-OSS local dependency scan + give-back config.
//
// --oss     scans the CURRENT WORKING DIRECTORY's package-lock.json /
//           node_modules (lib/oss.js, entirely local), prints an honest
//           "receipt" of the maintainers your give-back represents, and writes
//           that receipt to ~/.cogwait/oss-receipt.json for the dashboard to
//           load (it has no filesystem access to your project — see
//           .planning/fund-oss-mode/DESIGN.md §7 / Phase 8 §8.4).
// --donate  <pct> sets the give-back percentage: writes it to
//           ~/.cogwait/config.json and syncs it to the backend via
//           POST /donate/config (server-clamped 0-100; the client can't be
//           trusted to move money — see DESIGN.md §2/§9).
//
// Privacy: the scan itself (package names, funding URLs, file contents) NEVER
// leaves this process. The only network calls here are GET /earnings (to read
// the live balance/donate_pct for dollar figures) and POST /donate/config
// (which carries only an integer percentage) — nothing dependency-related is
// ever in an outbound request body.

const fs = require('fs');
const path = require('path');
const client = require('../lib/client');
const oss = require('../lib/oss');

const RECEIPT_PATH = path.join(client.STATE_DIR, 'oss-receipt.json');

function parseFlagValue(flag) {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1] !== undefined) return argv[i + 1];
    const m = new RegExp(`^${flag}=(.+)$`).exec(argv[i]);
    if (m) return m[1];
  }
  return null;
}

function fmt(n) { return `$${Number(n).toFixed(2)}`; }

function printReceipt(receipt, donatePct, source, scan) {
  console.log('Cogwait — fund the open source you build on\n');
  console.log(`  give-back:  ${donatePct}% of your Cogwait balance`);
  if (receipt.totalUsd > 0) console.log(`  this snapshot represents: ${fmt(receipt.totalUsd)}`);
  console.log(`  coverage:   ${Math.round(receipt.coverage * 100)}% of scanned deps (${source}, ${scan.scanned} packages) declare a funding target`);
  console.log('');
  if (!receipt.maintainers.length) {
    console.log('  No funding targets found among this project\'s dependencies.');
  } else {
    for (const m of receipt.maintainers.slice(0, 25)) {
      const pct = `${m.pct.toFixed(1)}%`.padStart(6);
      const usd = receipt.totalUsd > 0 ? fmt(m.usd).padStart(8) : ''.padStart(8);
      const via = (m.packages || []).join(', ');
      console.log(`  ${pct}  ${usd}  ${m.name}   ${m.url}`);
      if (via) console.log(`          via: ${via}`);
    }
    if (receipt.maintainers.length > 25) console.log(`  … and ${receipt.maintainers.length - 25} more`);
  }
  console.log('');
  console.log('  Pooled fund, illustrative snapshot — Cogwait transfers your give-back to');
  console.log('  a single OSS fund; this receipt shows which dependencies it represents,');
  console.log('  not a guarantee any individual maintainer received a payment.');
}

function runOss() {
  const cwd = process.cwd();
  const scan = oss.scanDeps(cwd);
  const weighted = oss.weightFunding(scan.deps);
  const configuredPct = client.DONATE_PCT;

  function finish(amountUsd, donatePct) {
    const receipt = oss.buildReceipt(weighted, amountUsd);
    printReceipt(receipt, donatePct, scan.source, scan);
    try {
      client.writeSecret(RECEIPT_PATH, JSON.stringify({
        generated: Date.now(), donate_pct: donatePct, source: scan.source,
        scanned: scan.scanned, skipped: scan.skipped, truncated: scan.truncated,
        totalUsd: receipt.totalUsd, coverage: receipt.coverage, maintainers: receipt.maintainers
      }, null, 2) + '\n');
      console.log(`  receipt saved -> ${RECEIPT_PATH}`);
    } catch (_) { /* best-effort; the printed receipt is still useful */ }
  }

  // Offline / mock / unregistered: print a %-only breakdown, no live balance.
  if (client.MOCK || !client.PAYOUT_ID || !client.PUBLISHER_KEY) {
    return finish(0, configuredPct);
  }

  client.request('GET', `${client.API_BASE}/earnings`, null, 3000, (err, code, json) => {
    if (err || code !== 200 || !json) return finish(0, configuredPct);
    const pct = json.donate_pct !== undefined ? Number(json.donate_pct) : configuredPct;
    const donateUsd = Math.round(Number(json.balance_usd || 0) * pct / 100 * 1e6) / 1e6;
    finish(donateUsd, pct);
  });
}

function runDonate(pctArg) {
  const pct = client.clampPct(pctArg);
  if (!/^-?\d+(\.\d+)?$/.test(String(pctArg).trim())) {
    console.error('✗ --donate requires a number 0-100 (e.g. `npx cogwait --donate 20`).');
    process.exit(1);
  }
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(client.CONFIG_PATH, 'utf8')); } catch (_) {}
  cfg.donate_pct = pct;
  client.writeSecret(client.CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`✓ Give-back set to ${pct}% (saved to ${client.CONFIG_PATH})`);

  if (client.MOCK || !client.PAYOUT_ID || !client.PUBLISHER_KEY) {
    console.log('  (MOCK mode or no publisher key — not synced to the backend yet.)');
    return;
  }
  client.setDonatePct(pct, (err, code, json) => {
    if (err || code !== 200 || !json) {
      console.error('✗ Could not sync to backend:', err ? err.message : `HTTP ${code}`);
      process.exit(1);
    }
    console.log(`✓ Synced to backend (donate_pct=${json.donate_pct})`);
  });
}

const donateArg = parseFlagValue('--donate');
if (donateArg !== null) runDonate(donateArg);
else runOss();
