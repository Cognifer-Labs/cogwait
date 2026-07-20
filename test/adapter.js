#!/usr/bin/env node
'use strict';
// Serverless adapter + offline-resilience checks.
//  - server/index.js exports a request handler the Vercel adapter re-exports.
//  - the statusline keeps rendering the last cached ad when the backend is down
//    (offline resilience), and enters backoff after repeated fetch failures.

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Cogwait adapter + offline-resilience test');

// 1. Handler export is a function (requires a token to load).
{
  const code = `process.env.COGWAIT_ADMIN_TOKEN='x';const h=require(${JSON.stringify(path.join(ROOT,'server','index.js'))}).handler;process.stdout.write(typeof h)`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert(r.stdout.trim() === 'function', 'server exports a request handler for the serverless adapter');
  const r2 = spawnSync(process.execPath, ['-e', `const a=require(${JSON.stringify(path.join(ROOT,'api','index.js'))});process.stdout.write(typeof a)`],
    { encoding: 'utf8', env: Object.assign({}, process.env, { COGWAIT_ADMIN_TOKEN: 'x' }) });
  assert(r2.stdout.trim() === 'function', 'api/index.js re-exports the handler');
}

// 2. Backend refuses to load without a strong admin token.
{
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT,'server','index.js'))})`],
    { encoding: 'utf8', env: Object.assign({}, process.env, { COGWAIT_ADMIN_TOKEN: '' }) });
  assert(r.status !== 0 && /COGWAIT_ADMIN_TOKEN/.test(r.stderr), 'backend refuses to load without an admin token');
  const r2 = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT,'server','index.js'))})`],
    { encoding: 'utf8', env: Object.assign({}, process.env, { COGWAIT_ADMIN_TOKEN: 'dev-admin' }) });
  assert(r2.status !== 0, 'backend refuses the old default token');
}

// 3. Offline resilience: with a cached ad but an unreachable backend, the
//    statusline still renders the last known ad (fails soft, never blank-on-error).
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-off-'));
  const stateDir = path.join(home, '.cogwait');
  fs.mkdirSync(stateDir, { recursive: true });
  // Seed a cached ad for the session tag (sha256(session)[0:16]).
  const crypto = require('crypto');
  const tag = crypto.createHash('sha256').update('offline-sess').digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(stateDir, `ad-${tag}.json`),
    JSON.stringify({ ad: { id: 'cached', text: 'Cached sponsor line', url: 'https://example.com' }, ts: Date.now() }));
  const sample = JSON.stringify({ session_id: 'offline-sess' });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')], {
    input: sample, encoding: 'utf8',
    env: Object.assign({}, process.env, {
      HOME: home, USERPROFILE: home,
      COGWAIT_API: 'http://127.0.0.1:9', // unreachable
      COGWAIT_PAYOUT_ID: 'off', COGWAIT_PUBLISHER_KEY: 'k', COGWAIT_MOCK: ''
    })
  });
  assert(/Cached sponsor line/.test(r.stdout), 'renders last cached ad when backend is unreachable');
  fs.rmSync(home, { recursive: true, force: true });
}

// 4. Rate limiting returns 429 once the per-window cap is exceeded.
(async () => {
  const { spawn } = require('child_process');
  const http = require('http');
  const PORT = 8815;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-rl-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), COGWAIT_DATA_DIR: DATA, COGWAIT_ADMIN_TOKEN: 'x', COGWAIT_RATE_MAX: '3', COGWAIT_QUIET: '1' }),
    stdio: 'ignore'
  });
  await new Promise((r) => setTimeout(r, 600));
  const hit = () => new Promise((res) => {
    http.get(`http://localhost:${PORT}/health`, (r) => { r.resume(); res(r.statusCode); }).on('error', () => res(0));
  });
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push(await hit());
  assert(codes.includes(429), `rate limiter returns 429 over the cap (codes: ${codes.join(',')})`);
  srv.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}

  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
