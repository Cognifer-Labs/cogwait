#!/usr/bin/env node
'use strict';
// Client unit tests: session hashing, config precedence, offline backoff, and
// statusline chaining. Runs the client in a child with an isolated HOME so it
// never touches the real ~/.cogwait.

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Cogwait client unit tests');

function withHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-home-'));
  fs.mkdirSync(path.join(home, '.cogwait'), { recursive: true });
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
  const tag = evalClient(home, { COGWAIT_MOCK: '1' }, "c.sessionTag('session-abc')");
  const tag2 = evalClient(home, { COGWAIT_MOCK: '1' }, "c.sessionTag('session-abc')");
  assert(tag.length === 16 && tag === tag2, 'session tag is stable and 16 chars');
  assert(!tag.includes('session-abc'), 'session tag does not contain the raw id');
  fs.rmSync(home, { recursive: true, force: true });
}

// 2. Config file supplies values; env overrides config.
{
  const home = withHome({ '.cogwait/config.json': JSON.stringify({ payout_id: 'from-config', api: 'http://cfg' }) });
  const fromCfg = evalClient(home, {}, 'c.PAYOUT_ID');
  assert(fromCfg === 'from-config', 'payout id read from config.json');
  const fromEnv = evalClient(home, { COGWAIT_PAYOUT_ID: 'from-env' }, 'c.PAYOUT_ID');
  assert(fromEnv === 'from-env', 'env overrides config for payout id');
  const api = evalClient(home, {}, 'c.API_BASE');
  assert(api === 'http://cfg', 'api base read from config.json');
  fs.rmSync(home, { recursive: true, force: true });
}

// 3. Offline backoff triggers after threshold failures within the window.
{
  const home = withHome({ '.cogwait/refresh.fail': JSON.stringify({ count: 3, ts: Date.now() }) });
  const backoff = evalClient(home, {}, 'c.inBackoff()');
  assert(backoff === 'true', 'inBackoff true after 3 recent failures');
  const home2 = withHome({ '.cogwait/refresh.fail': JSON.stringify({ count: 3, ts: Date.now() - 120000 }) });
  const expired = evalClient(home2, {}, 'c.inBackoff()');
  assert(expired === 'false', 'backoff expires after the window');
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
}

// 4. Chaining: an existing statusline command runs and its output is prepended.
{
  const home = withHome({ '.cogwait/config.json': JSON.stringify({ chain: "printf 'MY ROW\\n'", mock: '1' }) });
  const sample = JSON.stringify({ session_id: 'chain-test' });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')], {
    input: sample, encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COGWAIT_MOCK: '1' })
  });
  assert(/MY ROW/.test(r.stdout), 'chained statusline output is present');
  assert(r.stdout.indexOf('MY ROW') < r.stdout.indexOf('[sponsor]'), 'chained row renders above the sponsor line');
  fs.rmSync(home, { recursive: true, force: true });
}

// 5. Fund-OSS: DONATE_PCT precedence (env > config > default) + clamping.
{
  const home = withHome({ '.cogwait/config.json': JSON.stringify({ donate_pct: 40 }) });
  const fromCfg = evalClient(home, {}, 'c.DONATE_PCT');
  assert(fromCfg === '40', 'donate_pct read from config.json');
  const fromEnv = evalClient(home, { COGWAIT_DONATE_PCT: '15' }, 'c.DONATE_PCT');
  assert(fromEnv === '15', 'env overrides config for donate_pct');
  const dflt = evalClient(withHome(), {}, 'c.DONATE_PCT');
  assert(dflt === '20', 'donate_pct defaults to 20 (on by default) with no config/env');
  const clampedHigh = evalClient(withHome(), { COGWAIT_DONATE_PCT: '500' }, 'c.DONATE_PCT');
  assert(clampedHigh === '100', 'donate_pct clamps > 100 down to 100');
  const clampedLow = evalClient(withHome(), { COGWAIT_DONATE_PCT: '-30' }, 'c.DONATE_PCT');
  assert(clampedLow === '0', 'donate_pct clamps < 0 up to 0');
  fs.rmSync(home, { recursive: true, force: true });
}

// 6. Privacy regression: setDonatePct's outbound body carries ONLY {donate_pct}
// — never a dependency name, URL, path, or any other field.
(async () => {
  const http = require('http');
  const { spawn } = require('child_process');
  let captured = null;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => body += c);
    req.on('end', () => {
      captured = { url: req.url, body };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, donate_pct: JSON.parse(body).donate_pct }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const home = withHome();
  const code = `
    const c = require(${JSON.stringify(path.join(ROOT, 'lib', 'client.js'))});
    c.setDonatePct(42, (err, statusCode, json) => {
      process.stdout.write(JSON.stringify({ err: err && err.message, statusCode, json }));
    });
  `;
  // spawnSync would block this process's event loop and deadlock the child's
  // request against the in-process mock server above — use async spawn instead.
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], {
      env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COGWAIT_API: `http://127.0.0.1:${port}` })
    });
    let stdout = '';
    child.stdout.on('data', (c) => stdout += c);
    child.on('close', () => resolve({ stdout }));
  });
  server.close();
  let out = {}; try { out = JSON.parse(r.stdout.trim()); } catch (_) {}
  assert(out.statusCode === 200 && out.json && out.json.donate_pct === 42, 'setDonatePct posts to /donate/config and reads back the clamped value');
  assert(captured && captured.url === '/donate/config', 'setDonatePct hits the correct endpoint');
  assert(captured && JSON.stringify(JSON.parse(captured.body)) === JSON.stringify({ donate_pct: 42 }),
    'outbound body carries ONLY {donate_pct} — no dependency name, path, or extra field');
  fs.rmSync(home, { recursive: true, force: true });

  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
