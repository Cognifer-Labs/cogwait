#!/usr/bin/env node
'use strict';
// sponsoric --register — obtain a per-publisher secret from the backend and
// store it in ~/.sponsoric/config.json so impressions can be authenticated.
// Requires SPONSORIC_PAYOUT_ID (and SPONSORIC_API if self-hosting).

const fs = require('fs');
const path = require('path');
const os = require('os');
const client = require('../lib/client');

const CONFIG_PATH = path.join(os.homedir(), '.sponsoric', 'config.json');
const pid = client.PAYOUT_ID;

if (!pid) {
  console.error('✗ Set SPONSORIC_PAYOUT_ID first (your chosen publisher id).');
  process.exit(1);
}
if (client.PUBLISHER_KEY) {
  console.log('• Already registered (publisher key present in config/env). Nothing to do.');
  process.exit(0);
}

console.log(`Registering "${pid}" with ${client.API_BASE} …`);
client.request('POST', `${client.API_BASE}/session/init`, { publisher_id: pid }, 5000, (err, code, json) => {
  if (err) { console.error('✗ Cannot reach backend:', err.message); process.exit(1); }
  if (code === 200 && json && json.secret) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
    cfg.publisher_key = json.secret;
    cfg.payout_id = cfg.payout_id || pid;
    // Owner-only from creation (dir 0700, file 0600) — no default-umask window.
    client.writeSecret(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
    console.log('✓ Registered. Publisher key saved (0600) to', CONFIG_PATH);
    console.log('  Keep this key private — it authorizes your earnings and payouts.');
  } else if (code === 401) {
    console.error('✗ Publisher id already registered and no key on this machine.');
    console.error('  Recover the key from the machine you registered on, or contact support.');
    process.exit(1);
  } else {
    console.error('✗ Registration failed:', code, json && json.error);
    process.exit(1);
  }
});
