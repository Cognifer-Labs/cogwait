#!/usr/bin/env node
'use strict';
// cogwait --status — print the current local configuration and nothing else.
// Strictly read-only and strictly offline: no network call, no file written, no
// settings touched. It is the "what is this install actually doing right now?"
// answer, safe to run before anything has been configured at all.
//
// The publisher key is never printed — only whether one is present, and where
// it came from. Printing it would leak the credential that authorizes payouts
// into scrollback, CI logs, and screen shares.

const fs = require('fs');
const path = require('path');
const os = require('os');
const client = require('../lib/client');
const levels = require('../lib/levels');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const STATUSLINE = path.resolve(__dirname, 'statusline.js');

const row = (k, v) => console.log('  ' + String(k).padEnd(14) + v);
// Where a value came from matters more than the value for debugging: env vars
// silently beat config.json (see lib/client.js `pick`).
const source = (envKey, cfgKey) => {
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') return `env ${envKey}`;
  try {
    const cfg = JSON.parse(fs.readFileSync(client.CONFIG_PATH, 'utf8'));
    if (cfg && cfg[cfgKey] !== undefined) return 'config.json';
  } catch (_) {}
  return 'default';
};

console.log('Cogwait status\n');

// --- ad tier -------------------------------------------------------------
const L = levels.level(client.LEVEL);
const cpm = L.cpm ? `$${L.cpm} CPM` : 'no CPM (nothing renders, nothing earns)';
row('ad level', `${L.id} · ${L.label} — ${cpm}   [${source('COGWAIT_LEVEL', 'level')}]`);
row('', '  ' + L.desc);

// --- Fund-OSS ------------------------------------------------------------
row('give-back', `${client.DONATE_PCT}% to open source   [${source('COGWAIT_DONATE_PCT', 'donate_pct')}]`);

// --- identity ------------------------------------------------------------
row('payout id', client.PAYOUT_ID
  ? `${client.PAYOUT_ID}   [${source('COGWAIT_PAYOUT_ID', 'payout_id')}]`
  : 'not set — export COGWAIT_PAYOUT_ID="your-id"');
row('publisher key', client.PUBLISHER_KEY
  ? `present (hidden)   [${source('COGWAIT_PUBLISHER_KEY', 'publisher_key')}]`
  : 'not registered — run `npx cogwait --register`');

// --- endpoint + modes ----------------------------------------------------
row('api', `${client.API_BASE}   [${source('COGWAIT_API', 'api')}]`);
const modes = [];
if (client.MOCK) modes.push('MOCK (local demo ads, nothing leaves this machine)');
if (client.DISABLED) modes.push('DISABLED (rendering and billing paused)');
row('mode', modes.length ? modes.join(' · ') : 'live');
row('chaining', client.CHAIN ? `on — runs first: ${client.CHAIN}` : 'off');
row('config', fs.existsSync(client.CONFIG_PATH) ? client.CONFIG_PATH : `${client.CONFIG_PATH} (none yet)`);

// --- is the status line actually wired in? -------------------------------
let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) || {}; } catch (_) {}
const cmd = settings.statusLine && settings.statusLine.command;
let install;
if (cmd && String(cmd).includes(STATUSLINE)) install = `installed in ${SETTINGS}`;
else if (cmd && String(cmd).includes('statusline.js')) install = `a different Cogwait checkout is installed in ${SETTINGS}`;
else if (cmd) install = 'another statusLine is configured — run `npx cogwait --chain` to keep both';
else install = 'not installed — run `npx cogwait`';
row('status line', install);

console.log('');
console.log('  Read-only: nothing was changed. `npx cogwait --doctor` also pings the backend.');
