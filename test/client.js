#!/usr/bin/env node
'use strict';
// Client unit tests: session hashing, config precedence, offline backoff, and
// statusline chaining. Runs the client in a child with an isolated HOME so it
// never touches the real ~/.sponsoric.

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Sponsoric client unit tests');

function withHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-home-'));
  fs.mkdirSync(path.join(home, '.sponsoric'), { recursive: true });
  for (const [rel, content] of Object.entries(files || {})) {
    const fp = path.join(home, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return home;
}

// Evaluate a snippet of JS against the client module in a child process.
function evalClient(home, env, expr) {
  const code = `const c=require(${JSON.stringify(path.join(ROOT, 'lib', 'client.js'))});process.stdout.write(String(${expr}));`;
  const r = spawnSync(process.execPath, ['-e', code], {
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home }, env || {}),
    encoding: 'utf8'
  });
  return r.stdout.trim();
}

// 1. Session hashing is deterministic, truncated, and non-reversible-looking.
{
  const home = withHome();
  const tag = evalClient(home, { SPONSORIC_MOCK: '1' }, "c.sessionTag('session-abc')");
  const tag2 = evalClient(home, { SPONSORIC_MOCK: '1' }, "c.sessionTag('session-abc')");
  assert(tag.length === 16 && tag === tag2, 'session tag is stable and 16 chars');
  assert(!tag.includes('session-abc'), 'session tag does not contain the raw id');
  fs.rmSync(home, { recursive: true, force: true });
}

// 2. Config file supplies values; env overrides config.
{
  const home = withHome({ '.sponsoric/config.json': JSON.stringify({ payout_id: 'from-config', api: 'http://cfg' }) });
  const fromCfg = evalClient(home, {}, 'c.PAYOUT_ID');
  assert(fromCfg === 'from-config', 'payout id read from config.json');
  const fromEnv = evalClient(home, { SPONSORIC_PAYOUT_ID: 'from-env' }, 'c.PAYOUT_ID');
  assert(fromEnv === 'from-env', 'env overrides config for payout id');
  const api = evalClient(home, {}, 'c.API_BASE');
  assert(api === 'http://cfg', 'api base read from config.json');
  fs.rmSync(home, { recursive: true, force: true });
}

// 3. Offline backoff triggers after threshold failures within the window.
{
  const home = withHome({ '.sponsoric/refresh.fail': JSON.stringify({ count: 3, ts: Date.now() }) });
  const backoff = evalClient(home, {}, 'c.inBackoff()');
  assert(backoff === 'true', 'inBackoff true after 3 recent failures');
  const home2 = withHome({ '.sponsoric/refresh.fail': JSON.stringify({ count: 3, ts: Date.now() - 120000 }) });
  const expired = evalClient(home2, {}, 'c.inBackoff()');
  assert(expired === 'false', 'backoff expires after the window');
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
}

// 4. Chaining: an existing statusline command runs and its output is prepended.
{
  const home = withHome({ '.sponsoric/config.json': JSON.stringify({ chain: "printf 'MY ROW\\n'", mock: '1' }) });
  const sample = JSON.stringify({ session_id: 'chain-test' });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')], {
    input: sample, encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, SPONSORIC_MOCK: '1' })
  });
  assert(/MY ROW/.test(r.stdout), 'chained statusline output is present');
  assert(r.stdout.indexOf('MY ROW') < r.stdout.indexOf('[sponsor]'), 'chained row renders above the sponsor line');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
