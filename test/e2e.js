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

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsoric-e2e-'));
const PORT = 8799;
const API = `http://localhost:${PORT}`;
const PAYOUT = 'e2e-publisher';
const ROOT = path.resolve(__dirname, '..');
const SESSION = 'e2e-session-' + process.pid;

const env = (extra) => Object.assign({}, process.env, {
  SPONSORIC_API: API,
  SPONSORIC_PAYOUT_ID: PAYOUT,
  SPONSORIC_MOCK: '',
  SPONSORIC_DISABLED: '',
  PORT: String(PORT),
  SPONSORIC_DATA_DIR: DATA_DIR,
  SPONSORIC_ADMIN_TOKEN: 'e2e-admin-token',
  SPONSORIC_QUIET: '1'
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
  console.log('Sponsoric e2e settlement test');

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
      { env: env({ SPONSORIC_SESSION: SESSION, SPONSORIC_PUBLISHER_KEY: KEY }), encoding: 'utf8' });
    assert(warm.status === 0, 'ad refresh ran');
    await sleep(200);

    // 2. Render the statusline against the live backend.
    const sample = JSON.stringify({ session_id: SESSION, cost: { total_api_duration_ms: 800 } });
    const sl = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')],
      { input: sample, env: env({ SPONSORIC_PUBLISHER_KEY: KEY }), encoding: 'utf8' });
    assert(sl.status === 0, 'statusline exits 0');
    assert(/\[sponsor\]/.test(sl.stdout), 'sponsor line rendered');

    // 3. Let the fire-and-forget impression POST land, then check the ledger (authenticated).
    await sleep(500);
    const earn = await getAuth('/earnings', KEY);
    assert(earn.impressions === 1, `ledger recorded 1 impression (got ${earn.impressions})`);
    assert(earn.balance_usd > 0, `publisher credited $${earn.balance_usd}`);

    // 4. Re-render immediately -> client throttle means NO second impression.
    spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')],
      { input: sample, env: env({ SPONSORIC_PUBLISHER_KEY: KEY }), encoding: 'utf8' });
    await sleep(400);
    const earn2 = await getAuth('/earnings', KEY);
    assert(earn2.impressions === 1, 'throttle prevented a duplicate impression');

    console.log(`\nSettled $${earn.balance_usd} for 1 viewable impression.`);
  } catch (e) {
    console.log('  ✗ error:', e.message); failed++;
  } finally {
    server.kill();
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
