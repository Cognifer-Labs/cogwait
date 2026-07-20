#!/usr/bin/env node
'use strict';
// Fund-OSS local dependency scan test — scanDeps/normalizeFunding/weightFunding/
// buildReceipt (lib/oss.js) against fixture project trees, plus a privacy
// regression proving the scan itself (package names, funding URLs, file
// contents) never appears in any outbound request body from bin/oss.js.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const oss = require(path.join(ROOT, 'lib', 'oss.js'));

let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Cogwait Fund-OSS scan test');

// --- fixture builder --------------------------------------------------------
// makeFixture(pkgs) creates a temp project dir with a v3 package-lock.json
// (`packages` map) and matching node_modules/<name>/package.json manifests.
// `pkgs` is [{ name, funding }] — `funding` omitted means no funding field.
function makeFixture(pkgs, opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-oss-'));
  const packagesMap = { '': { name: 'fixture-root', version: '1.0.0' } };
  if (!opts.noLockfile) {
    for (const pkg of pkgs) packagesMap[`node_modules/${pkg.name}`] = { version: '1.0.0' };
    if (opts.extraLockfileKeys) Object.assign(packagesMap, opts.extraLockfileKeys);
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      name: 'fixture-root', version: '1.0.0', lockfileVersion: 3, packages: packagesMap
    }));
  }
  if (opts.noLockfile || opts.alsoWritePackageJson) {
    const deps = {};
    for (const pkg of pkgs) deps[pkg.name] = '^1.0.0';
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-root', version: '1.0.0', dependencies: deps }));
  }
  for (const pkg of pkgs) {
    const pdir = path.join(dir, 'node_modules', pkg.name);
    fs.mkdirSync(pdir, { recursive: true });
    if (pkg.malformed) {
      fs.writeFileSync(path.join(pdir, 'package.json'), '{ this is not json');
    } else if (pkg.skipManifest) {
      // no package.json at all -> "not actually installed" skip path
    } else {
      const manifest = { name: pkg.name, version: '1.0.0' };
      if (pkg.funding !== undefined) manifest.funding = pkg.funding;
      fs.writeFileSync(path.join(pdir, 'package.json'), JSON.stringify(manifest));
    }
  }
  return dir;
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

// Async child spawn (NOT spawnSync) — the privacy test below runs a mock HTTP
// server in-process; spawnSync would block this process's event loop and
// deadlock the child's request against it.
function runNode(args, opts) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, Object.assign({ encoding: 'utf8' }, opts));
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => stdout += c);
    child.stderr.on('data', (c) => stderr += c);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// 1. Three funding shapes: string, {type,url}, array-of-either.
{
  const dir = makeFixture([
    { name: 'pkg-string', funding: 'https://example.com/fund/a' },
    { name: 'pkg-object', funding: { type: 'github', url: 'https://example.com/fund/b' } },
    { name: 'pkg-array', funding: ['https://example.com/fund/c', { type: 'opencollective', url: 'https://example.com/fund/d' }] }
  ]);
  const scan = oss.scanDeps(dir);
  assert(scan.deps.length === 3, `scanned all 3 fixture packages (got ${scan.deps.length})`);
  const byName = Object.fromEntries(scan.deps.map((d) => [d.name, d]));
  assert(JSON.stringify(oss.normalizeFunding(byName['pkg-string'].funding)) === JSON.stringify(['https://example.com/fund/a']),
    'string funding shape normalized');
  assert(JSON.stringify(oss.normalizeFunding(byName['pkg-object'].funding)) === JSON.stringify(['https://example.com/fund/b']),
    'object {type,url} funding shape normalized');
  const arrNorm = oss.normalizeFunding(byName['pkg-array'].funding);
  assert(arrNorm.length === 2 && arrNorm.includes('https://example.com/fund/c') && arrNorm.includes('https://example.com/fund/d'),
    'array-of-(string|object) funding shape normalized');
  const weighted = oss.weightFunding(scan.deps);
  assert(weighted.coverage === 1, `all 3 deps declare funding -> coverage 1 (got ${weighted.coverage})`);
  cleanup(dir);
}

// 2. Multi-URL weighting + ranking: a maintainer funding more deps ranks higher.
{
  const dir = makeFixture([
    { name: 'a', funding: 'https://example.com/popular' },
    { name: 'b', funding: 'https://example.com/popular' },
    { name: 'c', funding: 'https://example.com/popular' },
    { name: 'd', funding: ['https://example.com/popular', 'https://example.com/rare'] },
    { name: 'e', funding: 'https://example.com/rare' }
  ]);
  const scan = oss.scanDeps(dir);
  const weighted = oss.weightFunding(scan.deps);
  // popular: a(1) + b(1) + c(1) + d(0.5) = 3.5 shares; rare: d(0.5) + e(1) = 1.5 shares.
  const popular = weighted.items.find((i) => i.url === 'https://example.com/popular');
  const rare = weighted.items.find((i) => i.url === 'https://example.com/rare');
  assert(Math.abs(popular.shares - 3.5) < 1e-9, `popular URL accumulates 3.5 shares (got ${popular.shares})`);
  assert(Math.abs(rare.shares - 1.5) < 1e-9, `rare URL accumulates 1.5 shares (got ${rare.shares})`);
  assert(weighted.items[0].url === 'https://example.com/popular', 'higher-shared URL ranks first');
  assert(Math.abs(popular.pct + rare.pct - 100) < 1e-9, 'percentages normalize to 100%');
  cleanup(dir);
}

// 3. Dollar allocation sums exactly to the donate total.
{
  const dir = makeFixture([
    { name: 'a', funding: 'https://example.com/1' },
    { name: 'b', funding: 'https://example.com/2' },
    { name: 'c', funding: 'https://example.com/3' }
  ]);
  const scan = oss.scanDeps(dir);
  const weighted = oss.weightFunding(scan.deps);
  const receipt = oss.buildReceipt(weighted, 10.00);
  const sum = Math.round(receipt.maintainers.reduce((s, m) => s + m.usd, 0) * 100) / 100;
  assert(sum === 10.00, `maintainer $ allocations sum to the donate total (got $${sum})`);
  assert(receipt.totalUsd === 10.00, 'receipt.totalUsd matches the input amount');
  cleanup(dir);
}

// 4. Coverage correctness: 2 of 5 deps declare funding -> coverage 0.4.
{
  const dir = makeFixture([
    { name: 'funded-1', funding: 'https://example.com/x' },
    { name: 'funded-2', funding: 'https://example.com/y' },
    { name: 'unfunded-1' },
    { name: 'unfunded-2' },
    { name: 'unfunded-3' }
  ]);
  const scan = oss.scanDeps(dir);
  const weighted = oss.weightFunding(scan.deps);
  assert(Math.abs(weighted.coverage - 0.4) < 1e-9, `coverage is the real 2/5 ratio (got ${weighted.coverage})`);
  cleanup(dir);
}

// 5. No lockfile -> falls back to package.json dependencies.
{
  const dir = makeFixture([{ name: 'only-in-pkgjson', funding: 'https://example.com/z' }], { noLockfile: true });
  const scan = oss.scanDeps(dir);
  assert(scan.source === 'package.json', 'falls back to package.json when no lockfile present');
  assert(scan.deps.length === 1 && scan.deps[0].name === 'only-in-pkgjson', 'reads the dependency from package.json');
  cleanup(dir);
}

// 6. Zero funding fields anywhere -> coverage 0 (the honest number, not faked).
{
  const dir = makeFixture([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  const scan = oss.scanDeps(dir);
  const weighted = oss.weightFunding(scan.deps);
  assert(weighted.coverage === 0, `no funding fields -> coverage 0 (got ${weighted.coverage})`);
  const receipt = oss.buildReceipt(weighted, 5.00);
  assert(receipt.maintainers.length === 0, 'no maintainers in the receipt when nothing declares funding');
  cleanup(dir);
}

// 7. Malformed manifest doesn't crash the scan — just gets skipped.
{
  const dir = makeFixture([
    { name: 'good', funding: 'https://example.com/ok' },
    { name: 'broken', malformed: true },
    { name: 'missing', skipManifest: true }
  ]);
  const scan = oss.scanDeps(dir);
  assert(scan.deps.length === 1 && scan.deps[0].name === 'good', 'malformed/missing manifests are skipped, not fatal');
  assert(scan.skipped === 2, `both bad manifests counted as skipped (got ${scan.skipped})`);
  cleanup(dir);
}

// 8. Duplicate/nested lockfile entries for the same installed package collapse to one.
{
  const dir = makeFixture([{ name: 'dupe', funding: 'https://example.com/d' }], {
    extraLockfileKeys: { 'node_modules/other/node_modules/dupe': { version: '1.0.0' } }
  });
  const scan = oss.scanDeps(dir);
  assert(scan.deps.filter((d) => d.name === 'dupe').length === 1, 'duplicate lockfile entries for one package scanned once, not twice');
  cleanup(dir);
}

// 9. Symlink escape outside node_modules is rejected.
{
  const dir = makeFixture([{ name: 'evil', skipManifest: true }]);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-outside-'));
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'evil', funding: 'https://example.com/escape' }));
  const evilLink = path.join(dir, 'node_modules', 'evil');
  try { fs.rmSync(evilLink, { recursive: true, force: true }); } catch (_) {}
  fs.symlinkSync(outside, evilLink, 'dir');
  const scan = oss.scanDeps(dir);
  assert(!scan.deps.some((d) => d.name === 'evil'), 'symlinked package resolving outside node_modules is not scanned');
  assert(scan.skipped >= 1, 'symlink escape counted as skipped, not silently ignored');
  cleanup(dir);
  cleanup(outside);
}

// 10. Guard rails export sane, positive caps.
{
  assert(oss.MAX_PACKAGES > 0 && oss.MAX_FILE_BYTES > 0, 'scan caps are positive, finite guard rails');
}

// --- Privacy regression: bin/oss.js never leaks dependency data over the wire ---
(async () => {
  const dir = makeFixture([
    { name: 'super-secret-dep-marker-9f3a', funding: 'https://example.com/fund/super-secret-marker' }
  ]);
  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-oss-home-'));
  fs.mkdirSync(path.join(HOME, '.cogwait'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.cogwait', 'config.json'),
    JSON.stringify({ payout_id: 'privtest-pub', publisher_key: 'privtest-key' }));

  const captured = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      captured.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.startsWith('/earnings')) res.end(JSON.stringify({ donate_pct: 20, balance_usd: 5, impressions: 1 }));
      else if (req.url.startsWith('/donate/config')) {
        let parsed = {}; try { parsed = JSON.parse(body); } catch (_) {}
        res.end(JSON.stringify({ ok: true, donate_pct: parsed.donate_pct }));
      } else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const API = `http://127.0.0.1:${port}`;

  const env = (extra) => Object.assign({}, process.env, {
    HOME, USERPROFILE: HOME, COGWAIT_API: API,
    COGWAIT_PAYOUT_ID: 'privtest-pub', COGWAIT_PUBLISHER_KEY: 'privtest-key', COGWAIT_MOCK: '0'
  }, extra || {});

  const runOss = await runNode([path.join(ROOT, 'bin', 'oss.js'), '--oss'], { cwd: dir, env: env() });
  assert(runOss.status === 0, `bin/oss.js --oss exits 0 (stderr: ${runOss.stderr.trim()})`);
  assert(/super-secret-dep-marker-9f3a/.test(runOss.stdout), 'the receipt DOES print the dependency name to stdout (local-only surface)');

  const runDonate = await runNode([path.join(ROOT, 'bin', 'oss.js'), '--donate', '33'], { cwd: dir, env: env() });
  assert(runDonate.status === 0, `bin/oss.js --donate exits 0 (stderr: ${runDonate.stderr.trim()})`);

  server.close();

  const forbidden = ['super-secret-dep-marker-9f3a', 'example.com/fund/super-secret-marker', dir];
  let leaked = false;
  for (const req of captured) {
    for (const needle of forbidden) {
      if (req.url.includes(needle) || req.body.includes(needle)) { leaked = true; console.log(`  ✗ LEAKED "${needle}" in ${req.method} ${req.url} body=${req.body}`); }
    }
  }
  assert(!leaked, 'no dependency name, funding URL, or project path appears in ANY outbound request');
  assert(captured.every((r) => r.url !== '/impression' && r.url !== '/payout'), 'bin/oss.js never calls /impression or /payout');
  const donateReq = captured.find((r) => r.url.startsWith('/donate/config'));
  assert(donateReq && JSON.parse(donateReq.body).donate_pct === 33 && Object.keys(JSON.parse(donateReq.body)).length === 1,
    '/donate/config body carries ONLY {donate_pct} — nothing else');

  cleanup(dir);
  cleanup(HOME);

  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
