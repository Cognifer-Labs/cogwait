#!/usr/bin/env node
'use strict';
// sponsoric setup — writes the statusLine entry into ~/.claude/settings.json.
// A Claude Code plugin's bundled settings.json cannot ship the main `statusLine`
// (only `agent` / `subagentStatusLine` are supported), so — like idlepay/idlen —
// the setup step injects it into the user's settings, merging non-destructively.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Delegate to the doctor if requested.
if (process.argv.includes('--doctor')) { require('./doctor.js'); return; }
// Register with the backend to obtain a publisher key, then store it in config.
if (process.argv.includes('--register')) { require('./register.js'); return; }

const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const STATUSLINE = path.resolve(__dirname, 'statusline.js');
const uninstall = process.argv.includes('--uninstall');
const chain = process.argv.includes('--chain');
const CONFIG_PATH = path.join(HOME, '.sponsoric', 'config.json');
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

function backup() {
  if (!fs.existsSync(SETTINGS)) return null;
  const bak = `${SETTINGS}.sponsoric-bak`;
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
      s.statusLine.command.includes('statusline.js') &&
      s.statusLine.command.includes('sponsoric')) {
    delete s.statusLine;
    write(s);
    console.log('✓ Removed Sponsoric statusLine from', SETTINGS);
  } else {
    console.log('• No Sponsoric statusLine found; left settings untouched.');
  }
  if (bak) console.log('• Backup:', bak);
  process.exit(0);
}

if (s.statusLine && !String(s.statusLine.command || '').includes('sponsoric')) {
  if (chain && s.statusLine.type === 'command' && s.statusLine.command) {
    saveChain(s.statusLine.command);
    console.log('✓ Chaining your existing statusLine (saved to', CONFIG_PATH + ').');
    console.log('  Your row renders first; the sponsor line appears below it.');
  } else {
    console.log('⚠ You already have a custom statusLine:');
    console.log('   ', JSON.stringify(s.statusLine));
    console.log('  Sponsoric will not overwrite it. Re-run with --chain to keep both:');
    console.log('    npx sponsoric --chain');
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

const payout = process.env.SPONSORIC_PAYOUT_ID;
console.log('✓ Sponsoric statusLine installed to', SETTINGS);
if (bak) console.log('  Backup saved:', bak);
console.log('');
console.log('Next steps:');
if (!payout) {
  console.log('  1. Set your payout id:   export SPONSORIC_PAYOUT_ID="your-id"');
  console.log('     (add it to ~/.zshrc or ~/.bashrc to persist)');
} else {
  console.log('  1. Payout id detected:   ' + payout);
}
console.log('  2. Try it with no backend:  export SPONSORIC_MOCK=1');
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
console.log('  Change it:  npx sponsoric --level 2   (or SPONSORIC_LEVEL=2)');
console.log('');
console.log('Controls:  SPONSORIC_DISABLED=1 to pause · `npx sponsoric --uninstall` to remove.');
console.log('Privacy:   your prompts, code, and files are never sent. See README.md.');
