#!/usr/bin/env node
'use strict';
// cogwait setup — writes the statusLine entry into ~/.claude/settings.json.
// A Claude Code plugin's bundled settings.json cannot ship the main `statusLine`
// (only `agent` / `subagentStatusLine` are supported), so — like idlepay/idlen —
// the setup step injects it into the user's settings, merging non-destructively.

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- flag surface -------------------------------------------------------
// Every flag Cogwait accepts, in one place, so `--help` can print them and an
// unknown flag can be rejected. Without this, ANY unrecognized argument fell
// through to the default action — installing the statusLine — so a typo or a
// plain `--help` silently rewrote the user's ~/.claude/settings.json.
const FLAGS = [
  ['--help, -h', 'Show this help and exit.'],
  ['--status', 'Print current config: level, give-back %, payout id, install state.'],
  ['--version', 'Print the Cogwait version.'],
  ['--doctor', 'Diagnose the install (same checks as the desktop app Status tab).'],
  ['--register', 'Register with the backend and store your publisher key.'],
  ['--earnings', 'Print your balance, impressions, effective CPM and payout history.'],
  ['--cashout', 'Pay your balance out (asks for confirmation; --yes to skip).'],
  ['--level <0-5>', 'Set the ad tier. Higher = more prominent line = higher CPM.'],
  ['--chain', 'Keep an existing statusLine; render the sponsor line below it.'],
  ['--uninstall', 'Remove the Cogwait statusLine from ~/.claude/settings.json.'],
  ['--oss', 'Scan this project locally and print a maintainer give-back receipt.'],
  ['--donate <pct>', 'Set the Fund-OSS give-back percentage (0-100).'],
  ['--connect', 'Link a bank account or card for cash-outs (Stripe Connect).'],
  ['--paypal <email>', 'Use PayPal for cash-outs.'],
];
const KNOWN = new Set([
  '--help', '-h', '--status', '--version', '--doctor', '--register', '--level',
  '--chain', '--uninstall', '--oss', '--donate', '--connect', '--paypal',
  '--earnings', '--cashout', '--yes', '-y',
]);

function usage() {
  const pkg = require('../package.json');
  console.log(`cogwait ${pkg.version} — one opt-in sponsor line in your Claude Code status row.`);
  console.log('');
  console.log('Usage:  npx cogwait [flags]');
  console.log('        npx cogwait            install the status line (no flags)');
  console.log('');
  console.log('Flags:');
  for (const [flag, desc] of FLAGS) console.log(`  ${flag.padEnd(18)} ${desc}`);
  console.log('');
  console.log('Environment:');
  console.log('  COGWAIT_MOCK=1        local demo ads, nothing sent to any backend');
  console.log('  COGWAIT_DISABLED=1    pause rendering and billing');
  console.log('  COGWAIT_PAYOUT_ID     your publisher id');
  console.log('  COGWAIT_LEVEL         override the ad tier for one run');
  console.log('');
  console.log('Privacy: your prompts, code, and files are never sent. See PRIVACY.md.');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) { usage(); return; }
if (process.argv.includes('--version')) { console.log(require('../package.json').version); return; }

// Reject anything we don't know rather than falling through to "install".
const unknown = process.argv.slice(2).filter((a) => a.startsWith('-') && !KNOWN.has(a.split('=')[0]));
if (unknown.length) {
  console.error('Unknown option: ' + unknown.join(', '));
  console.error('Run `npx cogwait --help` to see the available flags.');
  process.exit(2);
}

// Report the current state without changing anything.
if (process.argv.includes('--status')) { require('./status.js'); return; }
// Delegate to the doctor if requested.
if (process.argv.includes('--doctor')) { require('./doctor.js'); return; }
// Register with the backend to obtain a publisher key, then store it in config.
if (process.argv.includes('--register')) { require('./register.js'); return; }
// Read the ledger (--earnings), or move the money (--cashout, confirmation-gated).
if (process.argv.includes('--earnings')) { require('./earnings.js'); return; }
if (process.argv.includes('--cashout')) { require('./cashout.js'); return; }
// Fund-OSS: local dependency scan + receipt (--oss), or set the give-back % (--donate <pct>).
if (process.argv.includes('--oss') || process.argv.some((a) => a === '--donate' || a.startsWith('--donate='))) {
  require('./oss.js'); return;
}
// Cash-out rails: link a bank/card via Stripe Connect (--connect), or set the
// PayPal payout email (--paypal <email>).
if (process.argv.includes('--connect') || process.argv.some((a) => a === '--paypal' || a.startsWith('--paypal='))) {
  require('./connect.js'); return;
}

const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const STATUSLINE = path.resolve(__dirname, 'statusline.js');
const uninstall = process.argv.includes('--uninstall');
const chain = process.argv.includes('--chain');
const CONFIG_PATH = path.join(HOME, '.cogwait', 'config.json');
const levels = require('../lib/levels');
const client = require('../lib/client');

// --level N (or --level=N): pick the ad tier. Higher = more prominent + higher CPM.
function parseLevelArg() {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--level' && argv[i + 1] !== undefined) return argv[i + 1];
    const m = /^--level=(.+)$/.exec(argv[i]);
    if (m) return m[1];
  }
  return null;
}

function saveConfig(patch) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  Object.assign(cfg, patch);
  // config.json can hold the publisher key — owner-only (dir 0700, file 0600).
  client.writeSecret(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}
function saveChain(cmd) { saveConfig({ chain: cmd }); }

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (_) { return {}; }
}

// The backup exists to recover the user's settings as they were BEFORE Cogwait
// ever touched them. Re-running install must therefore never overwrite it — the
// second run would replace the pristine snapshot with an already-modified one
// and the original statusLine would be unrecoverable.
function backup() {
  if (!fs.existsSync(SETTINGS)) return null;
  const bak = `${SETTINGS}.cogwait-bak`;
  if (fs.existsSync(bak)) return bak;
  try { fs.copyFileSync(SETTINGS, bak); return bak; } catch (_) { return null; }
}

function write(obj) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + '\n');
}

// Persist a chosen ad level to config (used at render + pricing time).
const levelArg = parseLevelArg();
let chosenLevel = null;
if (levelArg !== null) {
  chosenLevel = levels.clampLevel(levelArg);
  saveConfig({ level: chosenLevel });
}

const s = readSettings();
const bak = backup();

if (uninstall) {
  if (s.statusLine && typeof s.statusLine.command === 'string' &&
      s.statusLine.command.includes(STATUSLINE)) {
    delete s.statusLine;
    write(s);
    console.log('✓ Removed Cogwait statusLine from', SETTINGS);
  } else {
    console.log('• No Cogwait statusLine found; left settings untouched.');
  }
  if (bak) console.log('• Backup:', bak);
  process.exit(0);
}

if (s.statusLine && !String(s.statusLine.command || '').includes(STATUSLINE)) {
  if (chain && s.statusLine.type === 'command' && s.statusLine.command) {
    saveChain(s.statusLine.command);
    console.log('✓ Chaining your existing statusLine (saved to', CONFIG_PATH + ').');
    console.log('  Your row renders first; the sponsor line appears below it.');
  } else {
    console.log('⚠ You already have a custom statusLine:');
    console.log('   ', JSON.stringify(s.statusLine));
    console.log('  Cogwait will not overwrite it. Re-run with --chain to keep both:');
    console.log('    npx cogwait --chain');
    console.log('  or remove yours first. Aborting.');
    process.exit(1);
  }
}

s.statusLine = {
  type: 'command',
  command: `node "${STATUSLINE}"`,
  refreshInterval: 5,
  padding: 0
};
write(s);

const payout = process.env.COGWAIT_PAYOUT_ID;
console.log('✓ Cogwait statusLine installed to', SETTINGS);
if (bak) console.log('  Backup saved:', bak);
console.log('');
console.log('Next steps:');
if (!payout) {
  console.log('  1. Set your payout id:   export COGWAIT_PAYOUT_ID="your-id"');
  console.log('     (add it to ~/.zshrc or ~/.bashrc to persist)');
} else {
  console.log('  1. Payout id detected:   ' + payout);
}
console.log('  2. Try it with no backend:  export COGWAIT_MOCK=1');
console.log('  3. Restart Claude Code and accept the workspace-trust prompt.');
console.log('');
const activeLevel = chosenLevel !== null ? chosenLevel : levels.DEFAULT_LEVEL;
console.log(`Ad level:  ${activeLevel} (${levels.level(activeLevel).label}) — ${levels.level(activeLevel).desc}`);
console.log('  Trade prominence for pay. Higher tier = more visible line = higher CPM:');
for (const L of levels.LEVELS) {
  const mark = L.id === activeLevel ? '▶' : ' ';
  const cpm = L.cpm ? `$${L.cpm} CPM` : '—';
  console.log(`   ${mark} ${L.id} ${L.label.padEnd(9)} ${cpm.padEnd(9)} ${L.desc}`);
}
console.log('  Change it:  npx cogwait --level 2   (or COGWAIT_LEVEL=2)');
console.log('');
console.log('Controls:  COGWAIT_DISABLED=1 to pause · `npx cogwait --uninstall` to remove.');
console.log('Privacy:   your prompts, code, and files are never sent. See README.md.');
