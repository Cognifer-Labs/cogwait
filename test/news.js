#!/usr/bin/env node
'use strict';
// AI-news fallback tests: cache/TTL, gating (disabled/opt-out/level 0),
// statusline fallback rendering, ad-wins precedence, anonymous fetch (no
// Authorization header ever), and offline silence. Everything runs in a child
// with an isolated HOME so the real ~/.cogwait is never touched.

const { spawnSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Cogwait news-fallback tests');

// Unreachable news endpoint: keeps any incidental background refresh from ever
// touching the real network during tests.
const DEAD_API = 'http://127.0.0.1:1/none';

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

// Run raw JS in a child with `n` bound to lib/news.js.
function runCode(home, env, code) {
  const full = `const n=require(${JSON.stringify(path.join(ROOT, 'lib', 'news.js'))});${code}`;
  const r = spawnSync(process.execPath, ['-e', full], {
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COGWAIT_NEWS_API: DEAD_API }, env || {}),
    encoding: 'utf8',
    timeout: 8000
  });
  return r.stdout.trim();
}
// Evaluate a single expression and print its result.
function evalNews(home, env, expr) {
  return runCode(home, env, `process.stdout.write(String(${expr}));`);
}

// Async variant — needed when a stub HTTP server lives in THIS process:
// spawnSync blocks the parent event loop, so the server could never respond.
function runCodeAsync(home, env, code) {
  const full = `const n=require(${JSON.stringify(path.join(ROOT, 'lib', 'news.js'))});${code}`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', full], {
      env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COGWAIT_NEWS_API: DEAD_API }, env || {}),
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', () => resolve(out.trim()));
    setTimeout(() => child.kill(), 8000).unref();
  });
}

function runStatusline(home, env, stdinJson) {
  return spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')], {
    input: stdinJson || '{"session_id":"s1"}',
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COGWAIT_NEWS_API: DEAD_API }, env || {}),
    encoding: 'utf8',
    timeout: 8000
  });
}

const freshCache = (items) => JSON.stringify({ items, ts: Date.now() });

// 1. Gating: disabled, opted out, or level 0 -> no news even with a fresh cache.
{
  const cache = freshCache([{ title: 'Cached headline', url: 'https://example.com' }]);
  const home = withHome({ '.cogwait/news.json': cache });
  assert(evalNews(home, { COGWAIT_DISABLED: '1' }, 'n.getCachedNews()') === 'null', 'DISABLED=1 suppresses news');
  assert(evalNews(home, { COGWAIT_NEWS: '0' }, 'n.getCachedNews()') === 'null', 'COGWAIT_NEWS=0 opts out');
  assert(evalNews(home, { COGWAIT_LEVEL: '0' }, 'n.getCachedNews()') === 'null', 'level 0 suppresses news');
  const on = evalNews(home, {}, 'JSON.stringify(n.getCachedNews())');
  assert(on.includes('Cached headline'), 'fresh cache serves a headline when enabled');
  fs.rmSync(home, { recursive: true, force: true });
}

// 2. refreshNews fetches from the (stubbed) API, truncates titles, falls back
//    to the HN item page for hits with no url, and sends NO Authorization
//    header even when publisher credentials are configured.
{
  const longTitle = 'A'.repeat(200);
  let seenAuth = 'unset', seenPath = '';
  const srv = http.createServer((req, res) => {
    seenAuth = req.headers['authorization'] || 'none';
    seenPath = req.url;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ hits: [
      { title: longTitle, url: 'https://example.com/long' },
      { title: 'No-url story', objectID: '123' },
      { url: 'https://example.com/skip-me' } // no title -> filtered out
    ] }));
  });
  const home = withHome();
  const done = new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  done.then(async () => {
    const api = `http://127.0.0.1:${srv.address().port}/news`;
    const out = await runCodeAsync(home, {
      COGWAIT_NEWS_API: api,
      COGWAIT_PAYOUT_ID: 'pub-1',
      COGWAIT_PUBLISHER_KEY: 'secret-key'
    }, 'n.refreshNews(() => { const c = require("fs").readFileSync(n.NEWS_CACHE, "utf8"); process.stdout.write(c); });');
    srv.close();
    const cache = JSON.parse(out);
    assert(Array.isArray(cache.items) && cache.items.length === 2, 'titleless hits filtered, rest cached');
    assert(cache.items[0].title.length <= 80, 'long titles truncated to 80 chars');
    assert(cache.items[1].url === 'https://news.ycombinator.com/item?id=123', 'url-less hit links to HN item page');
    assert(seenAuth === 'none', 'news fetch carries NO Authorization header despite configured creds');
    assert(!seenPath.includes('pub-1'), 'news fetch URL carries no publisher id');
    assert(!out.includes('secret-key'), 'publisher key nowhere near the news path');

    // 3. Statusline fallback: no payout id -> no ad -> news line renders,
    //    unlabeled as sponsor, and no impression stamp is written.
    {
      const h2 = withHome({ '.cogwait/news.json': freshCache([{ title: 'Fallback headline', url: 'https://example.com/n' }]) });
      const r = runStatusline(h2, {});
      assert(r.stdout.includes('[news]') && r.stdout.includes('Fallback headline'), 'statusline renders news when no ad');
      assert(!r.stdout.includes('[sponsor]'), 'news line is never labeled [sponsor]');
      const stamps = fs.readdirSync(path.join(h2, '.cogwait')).filter((f) => f.startsWith('imp-'));
      assert(stamps.length === 0, 'no impression stamp on the news path');
      fs.rmSync(h2, { recursive: true, force: true });
    }

    // 4. Ad wins: in MOCK an ad is always available -> sponsor line, no news.
    {
      const h3 = withHome({ '.cogwait/news.json': freshCache([{ title: 'Should not appear', url: null }]) });
      const r = runStatusline(h3, { COGWAIT_MOCK: '1' });
      assert(r.stdout.includes('[sponsor]'), 'ad renders when available (mock)');
      assert(!r.stdout.includes('[news]'), 'news never shown alongside/instead of an ad');
      fs.rmSync(h3, { recursive: true, force: true });
    }

    // 5. Offline: refresh against an unreachable endpoint is silent — no cache,
    //    exit 0, statusline prints nothing extra.
    {
      const h4 = withHome();
      const out2 = runCode(h4, {}, 'n.refreshNews(() => process.stdout.write(String(require("fs").existsSync(n.NEWS_CACHE))));');
      assert(out2 === 'false', 'failed fetch writes no cache and does not throw');
      const r = runStatusline(h4, {});
      assert(r.status === 0 && !r.stdout.includes('[news]'), 'no cache -> statusline stays empty, exits clean');
      fs.rmSync(h4, { recursive: true, force: true });
    }

    // 6. MOCK refresh writes local items without any network.
    {
      const h5 = withHome();
      const out3 = runCode(h5, { COGWAIT_MOCK: '1' }, 'n.refreshNews(() => process.stdout.write(require("fs").readFileSync(n.NEWS_CACHE, "utf8")));');
      assert(out3.includes('mock'), 'mock mode caches local items, nothing fetched');
      fs.rmSync(h5, { recursive: true, force: true });
    }

    // 7. Single-line adapter (tmux/prompt hosts) gets the same fallback —
    //    news when no ad, ad wins in mock, nothing on unsupported hosts.
    {
      const runLine = (h, env) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'render-line.js')], {
        env: Object.assign({}, process.env, { HOME: h, USERPROFILE: h, COGWAIT_NEWS_API: DEAD_API, COGWAIT_SESSION: 's-line' }, env || {}),
        encoding: 'utf8',
        timeout: 8000
      });
      const h6 = withHome({ '.cogwait/news.json': freshCache([{ title: 'Inline headline', url: 'https://example.com/i' }]) });
      let r = runLine(h6, { COGWAIT_HOST: 'tmux' });
      assert(r.stdout.includes('[news]') && r.stdout.includes('Inline headline'), 'render-line falls back to news when no ad');
      assert(!r.stdout.includes('[sponsor]'), 'render-line news is never labeled [sponsor]');
      r = runLine(h6, { COGWAIT_HOST: 'tmux', COGWAIT_MOCK: '1' });
      assert(r.stdout.includes('[sponsor]') && !r.stdout.includes('[news]'), 'render-line: ad wins when available');
      r = runLine(h6, { COGWAIT_HOST: 'codex' });
      assert(r.stdout === '', 'render-line: unsupported host renders no news line either');
      fs.rmSync(h6, { recursive: true, force: true });
    }

    fs.rmSync(home, { recursive: true, force: true });
    console.log(failed ? `\n${failed} FAILED` : '\nall news tests passed');
    process.exit(failed ? 1 : 0);
  });
}
