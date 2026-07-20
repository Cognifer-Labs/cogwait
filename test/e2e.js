#!/usr/bin/env node
'use strict';
// End-to-end settlement test (no mock): boot the stub backend, prime the ad
// cache, render the statusline against the live API, then confirm the ledger
// credited exactly one viewable impression.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-e2e-'));
// Isolated HOME so the client reads no real ~/.cogwait/config.json. Without this
// a dev's local config (e.g. "mock": 1) leaks into the test — mock mode never
// POSTs an impression, so settlement silently reports $0. It also keeps the test
// from writing cache/stamp files into the real ~/.cogwait. (An empty COGWAIT_MOCK
// env does NOT override config: pick() treats empty-string env as unset, so the
// toggles below are set to an explicit "0".)
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-e2e-home-'));
const PORT = 8799;
const API = `http://localhost:${PORT}`;
const PAYOUT = 'e2e-publisher';
const ROOT = path.resolve(__dirname, '..');
const SESSION = 'e2e-session-' + process.pid;

const env = (extra) => Object.assign({}, process.env, {
  HOME: HOME_DIR,            // POSIX: os.homedir() -> STATE_DIR, so no dev config is read
  USERPROFILE: HOME_DIR,     // Windows equivalent
  COGWAIT_API: API,
  COGWAIT_PAYOUT_ID: PAYOUT,
  COGWAIT_MOCK: '0',         // explicit override (empty string would fall through to config)
  COGWAIT_DISABLED: '0',
  PORT: String(PORT),
  COGWAIT_DATA_DIR: DATA_DIR,
  COGWAIT_ADMIN_TOKEN: 'e2e-admin-token',
  COGWAIT_QUIET: '1'
}, extra || {});

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${API}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
function getAuth(p, key) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${API}${p}`, { headers: { authorization: `Publisher ${PAYOUT}:${key}` } }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let failed = 0;
  const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
  console.log('Cogwait e2e settlement test');

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: env(), stdio: 'ignore'
  });
  await sleep(600);

  try {
    const health = await get(`${API}/health`);
    assert(health.ok === true, 'backend healthy');

    // 0. Register the publisher to obtain the auth key the client needs.
    const reg = await post('/session/init', { publisher_id: PAYOUT });
    assert(reg.secret && reg.registered, 'publisher registered, key issued');
    const KEY = reg.secret;

    // 1. Prime the ad cache (statusline reads cache; this fetches from the live API).
    const warm = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'refresh-ad.js')],
      { env: env({ COGWAIT_SESSION: SESSION, COGWAIT_PUBLISHER_KEY: KEY }), encoding: 'utf8' });
    assert(warm.status === 0, 'ad refresh ran');
    await sleep(200);

    // 2. Render the statusline against the live backend.
    const sample = JSON.stringify({ session_id: SESSION, cost: { total_api_duration_ms: 800 } });
    const sl = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')],
      { input: sample, env: env({ COGWAIT_PUBLISHER_KEY: KEY }), encoding: 'utf8' });
    assert(sl.status === 0, 'statusline exits 0');
    assert(/\[sponsor\]/.test(sl.stdout), 'sponsor line rendered');

    // 3. Let the fire-and-forget impression POST land, then check the ledger (authenticated).
    await sleep(500);
    const earn = await getAuth('/earnings', KEY);
    assert(earn.impressions === 1, `ledger recorded 1 impression (got ${earn.impressions})`);
    assert(earn.balance_usd > 0, `publisher credited $${earn.balance_usd}`);

    // 4. Re-render immediately -> client throttle means NO second impression.
    spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')],
      { input: sample, env: env({ COGWAIT_PUBLISHER_KEY: KEY }), encoding: 'utf8' });
    await sleep(400);
    const earn2 = await getAuth('/earnings', KEY);
    assert(earn2.impressions === 1, 'throttle prevented a duplicate impression');

    console.log(`\nSettled $${earn.balance_usd} for 1 viewable impression.`);
  } catch (e) {
    console.log('  ✗ error:', e.message); failed++;
  } finally {
    server.kill();
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(HOME_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
