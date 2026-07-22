'use strict';
// AI-news fallback — fills the statusline slot ONLY when there is no ad to
// render. It is not a paid surface: never labeled [sponsor], never reported as
// an impression, and the fetch is fully anonymous — no Authorization header,
// no publisher id, no session tag, no query built from anything local. The
// request is a plain GET to a public news API and is auditable below.
//
// Mirrors the ad-cache pattern (lib/client.js): the statusline does a sync
// cache read and a detached child refreshes out of band, so the hot path
// never blocks on the network.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const client = require('./client');

const NEWS_CACHE = path.join(client.STATE_DIR, 'news.json');
const NEWS_STAMP = path.join(client.STATE_DIR, 'news.stamp'); // last fetch attempt
const NEWS_TTL_MS = 15 * 60 * 1000;      // cached headlines are fine for 15 min
const NEWS_ATTEMPT_MS = 5 * 60 * 1000;   // min spacing between fetch attempts (offline friendliness)
const TITLE_MAX = 80;
const ROTATE_MS = 20000;                 // same coarse clock bucket as mockAd

// Config precedence matches lib/client.js: env > ~/.cogwait/config.json > default.
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(client.CONFIG_PATH, 'utf8')) || {}; } catch (_) { return {}; }
}
const CONFIG = loadConfig();
const pick = (envKey, cfgKey, dflt) =>
  (process.env[envKey] !== undefined && process.env[envKey] !== '') ? process.env[envKey]
  : (CONFIG[cfgKey] !== undefined ? CONFIG[cfgKey] : dflt);

// Opt-out: COGWAIT_NEWS=0 (or config news:"0") turns the fallback off entirely.
const NEWS_ENABLED = String(pick('COGWAIT_NEWS', 'news', '1')) !== '0';
// Public, keyless endpoint. Overridable so tests point at a local stub.
const NEWS_API = pick('COGWAIT_NEWS_API', 'news_api',
  'https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&hitsPerPage=8');

function mockNews() {
  return [
    { title: 'AI news headline (mock) — nothing fetched in mock mode', url: 'https://example.com/ai' },
  ];
}

function truncate(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1) + '…' : t;
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(NEWS_CACHE, 'utf8')); } catch (_) { return null; }
}
function writeCache(items) {
  try { client.writeSecret(NEWS_CACHE, JSON.stringify({ items, ts: Date.now() })); } catch (_) {}
}

// Rotate through the cached headlines on a coarse clock so consecutive renders
// vary without Math.random (deterministic across the statusline's re-runs).
function pickItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(Date.now() / ROTATE_MS) % items.length];
}

// Sync, never blocks on network. Null when the surface is off (disabled,
// level 0, opted out) or nothing is cached yet.
function getCachedNews() {
  if (!NEWS_ENABLED || client.DISABLED || client.LEVEL === 0) return null;
  const cached = readCache();
  const fresh = cached && (Date.now() - (cached.ts || 0)) < NEWS_TTL_MS;
  if (!fresh && attemptAllowed()) spawnNewsRefresh(); // non-blocking
  return cached ? pickItem(cached.items) : null;
}

function attemptAllowed() {
  try { return (Date.now() - fs.statSync(NEWS_STAMP).mtimeMs) >= NEWS_ATTEMPT_MS; } catch (_) { return true; }
}

function spawnNewsRefresh() {
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'refresh-news.js')], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (_) {}
}

// Anonymous GET — deliberately NOT client.request(), which attaches the
// publisher Authorization header. This call must carry nothing identifying.
function anonGet(urlStr, timeoutMs, cb) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return cb && cb(e); }
  const lib = u.protocol === 'http:' ? http : https;
  const req = lib.request(u, {
    method: 'GET',
    timeout: timeoutMs,
    headers: { 'Accept': 'application/json', 'User-Agent': 'cogwait/0.1' }
  }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      let json = null;
      try { json = data ? JSON.parse(data) : null; } catch (_) {}
      cb && cb(null, res.statusCode, json);
    });
  });
  req.on('error', (e) => cb && cb(e));
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.end();
}

// Fetch the latest headlines and update the cache. Called by bin/refresh-news.js.
// Failures are silent: the stale cache (if any) keeps serving, and the attempt
// stamp keeps an offline machine from retrying more than once per 5 minutes.
function refreshNews(done) {
  try { client.writeSecret(NEWS_STAMP, ''); } catch (_) {}
  if (client.MOCK) { writeCache(mockNews()); return done && done(); } // nothing leaves the machine in mock
  anonGet(NEWS_API, 4000, (err, code, json) => {
    if (!err && code === 200 && json && Array.isArray(json.hits)) {
      const items = json.hits
        .filter((h) => h && h.title)
        .map((h) => ({
          title: truncate(h.title),
          url: h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : null)
        }))
        .slice(0, 8);
      if (items.length) writeCache(items);
    }
    done && done();
  });
}

module.exports = { getCachedNews, refreshNews, pickItem, truncate, NEWS_CACHE, NEWS_STAMP, NEWS_ENABLED, NEWS_API };
