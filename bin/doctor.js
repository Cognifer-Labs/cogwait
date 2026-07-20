#!/usr/bin/env node
'use strict';
// cogwait --doctor — diagnose a Cogwait install.
// Checks: settings.json statusLine wiring, payout id, backend connectivity,
// backoff state. Read-only; prints a report and a non-zero exit on hard errors.

const fs = require('fs');
const path = require('path');
const os = require('os');
const client = require('../lib/client');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
let problems = 0;
const ok = (m) => console.log('  ✓', m);
const warn = (m) => console.log('  ⚠', m);
const bad = (m) => { console.log('  ✗', m); problems++; };

console.log('Cogwait doctor\n');

// 1. statusLine wired?
let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (_) {}
const cmd = settings.statusLine && settings.statusLine.command;
if (cmd && String(cmd).includes('statusline.js')) ok(`statusLine configured in ${SETTINGS}`);
else bad(`statusLine not configured — run: npx cogwait`);

// 2. payout id?
if (client.PAYOUT_ID) ok(`payout id set (${client.PAYOUT_ID})`);
else if (client.MOCK) warn('no payout id, but MOCK mode is on (demo only, no earnings)');
else bad('no payout id — set COGWAIT_PAYOUT_ID or add "payout_id" to ~/.cogwait/config.json');

// 3. disabled / ad level?
if (client.DISABLED) warn('COGWAIT_DISABLED=1 — ads are paused');
const levels = require('../lib/levels');
if (client.LEVEL === 0) warn('ad level 0 (Off) — nothing renders, nothing earns; raise with `npx cogwait --level 1`');
else ok(`ad level ${client.LEVEL} (${levels.level(client.LEVEL).label}) — $${levels.cpmForLevel(client.LEVEL)} CPM tier`);

// 4. backoff state?
if (client.inBackoff()) warn('in network backoff — recent ad fetches failed; check connectivity/API');
else ok('no active backoff');

// 5. backend connectivity (skip in mock).
function finish() {
  console.log(problems === 0 ? '\nAll good.' : `\n${problems} problem(s) found.`);
  process.exit(problems === 0 ? 0 : 1);
}
if (client.MOCK) { warn('MOCK mode — skipping live backend check'); return finish(); }
process.stdout.write(`  … pinging ${client.API_BASE}/health\n`);
client.request('GET', `${client.API_BASE}/health`, null, 3000, (err, code, json) => {
  if (!err && code === 200 && json && json.ok) ok(`backend reachable (per-impression $${json.per_impression_usd})`);
  else bad(`backend unreachable at ${client.API_BASE} (${err ? err.message : 'HTTP ' + code})`);
  finish();
});
