'use strict';
// Sponsoric API client — dependency-free, privacy-preserving.
// It NEVER sends prompt text, code, file contents, env vars, or the raw session id.
// Outbound payloads carry only: publisher id, a truncated hash of the session id,
// the ad id, and timestamps.

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const STATE_DIR = path.join(os.homedir(), '.sponsoric');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');

// Config precedence: env var > ~/.sponsoric/config.json > default.
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch (_) {}
  return cfg;
}
const CONFIG = loadConfig();
const pick = (envKey, cfgKey, dflt) =>
  (process.env[envKey] !== undefined && process.env[envKey] !== '') ? process.env[envKey]
  : (CONFIG[cfgKey] !== undefined ? CONFIG[cfgKey] : dflt);

const CHAIN = CONFIG.chain || '';   // optional pre-existing statusline command to run after ours
const API_BASE = pick('SPONSORIC_API', 'api', 'https://api.sponsoric.io');
const PAYOUT_ID = pick('SPONSORIC_PAYOUT_ID', 'payout_id', '') || '';
const PUBLISHER_KEY = pick('SPONSORIC_PUBLISHER_KEY', 'publisher_key', '') || '';
const MOCK = String(pick('SPONSORIC_MOCK', 'mock', '')) === '1';
const DISABLED = String(pick('SPONSORIC_DISABLED', 'disabled', '')) === '1';

// Ad level: how prominent the sponsor line is (and how much it pays). The dev
// opts into this. Level 0 = off. See lib/levels.js for the tiers and CPMs.
const levels = require('./levels');
const LEVEL = levels.clampLevel(pick('SPONSORIC_LEVEL', 'level', levels.DEFAULT_LEVEL));

const FAIL_PATH = path.join(STATE_DIR, 'refresh.fail');
const BACKOFF_MS = 60000;        // after repeated failures, throttle refresh attempts
const BACKOFF_THRESHOLD = 3;
const AD_CACHE_TTL_MS = 5000;          // statusline reads this cache; refreshed out of band
const IMPRESSION_THROTTLE_MS = 15000;  // one viewable impression per session per window

// The state dir holds credentials (config.json) and per-session cache/stamp
// files. Everything here is owner-only: dirs 0700, secret files 0600. We also
// chmod pre-existing paths on every write so already-deployed installs get
// tightened, not just fresh ones.
function secureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
}
function writeSecret(file, data) {
  secureDir(path.dirname(file));
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) {}
}
function ensureStateDir() {
  try { secureDir(STATE_DIR); } catch (_) {}
}

// A world/group-writable config is an injection vector (another user could
// rewrite `chain` or `publisher_key`). Refuse to trust it in that state.
function configIsTrustworthy() {
  try {
    const st = fs.statSync(CONFIG_PATH);
    return (st.mode & 0o022) === 0; // no group-write, no other-write
  } catch (_) {
    return true; // no config file at all — nothing untrusted to load
  }
}

// Truncated, non-reversible session tag. The raw Claude Code session id never leaves the machine.
function sessionTag(sessionId) {
  return crypto.createHash('sha256').update(String(sessionId || 'anon')).digest('hex').slice(0, 16);
}

function adCachePath(tag) { return path.join(STATE_DIR, `ad-${tag}.json`); }
function impStampPath(tag) { return path.join(STATE_DIR, `imp-${tag}.stamp`); }

// Minimal JSON POST/GET with a hard timeout. Fire-and-forget friendly.
function request(method, urlStr, body, timeoutMs, cb) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return cb && cb(e); }
  const lib = u.protocol === 'http:' ? http : https;
  const payload = body ? JSON.stringify(body) : null;
  const req = lib.request(u, {
    method,
    timeout: timeoutMs,
    headers: Object.assign(
      { 'Accept': 'application/json', 'User-Agent': 'sponsoric/0.1' },
      payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      (PAYOUT_ID && PUBLISHER_KEY) ? { 'Authorization': `Publisher ${PAYOUT_ID}:${PUBLISHER_KEY}` } : {}
    )
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
  if (payload) req.write(payload);
  req.end();
}

function mockAd() {
  const ads = [
    { id: 'mock-1', text: 'Neon Postgres — serverless Postgres that scales to zero', url: 'https://neon.tech' },
    { id: 'mock-2', text: 'Warp — the terminal reimagined for AI-native devs', url: 'https://warp.dev' },
    { id: 'mock-3', text: 'Sentry — see errors before your users do', url: 'https://sentry.io' }
  ];
  // Deterministic-ish rotation without Math.random (rotate on a coarse clock bucket).
  return ads[Math.floor(Date.now() / 20000) % ads.length];
}

// Return a cached ad synchronously for the statusline (must be fast, never blocks on network).
// If the cache is stale, kick off a detached background refresh and return the last known ad.
function getCachedAd(sessionId) {
  if (DISABLED || LEVEL === 0 || (!PAYOUT_ID && !MOCK)) return null;
  ensureStateDir();
  const tag = sessionTag(sessionId);
  const p = adCachePath(tag);
  let cached = null, fresh = false;
  try {
    const st = fs.statSync(p);
    fresh = (Date.now() - st.mtimeMs) < AD_CACHE_TTL_MS;
    cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}

  if (!fresh) spawnRefresh(sessionId); // non-blocking
  if (cached && cached.ad) return cached.ad;
  if (MOCK) { const ad = mockAd(); writeAdCache(tag, ad); return ad; }
  return null;
}

function writeAdCache(tag, ad) {
  ensureStateDir();
  try { writeSecret(adCachePath(tag), JSON.stringify({ ad, ts: Date.now() })); } catch (_) {}
}

// Offline backoff: after repeated fetch failures, stop hammering the network.
function inBackoff() {
  try {
    const raw = JSON.parse(fs.readFileSync(FAIL_PATH, 'utf8'));
    if (raw.count >= BACKOFF_THRESHOLD && (Date.now() - raw.ts) < BACKOFF_MS) return true;
  } catch (_) {}
  return false;
}
function recordFailure() {
  let count = 0;
  try { count = (JSON.parse(fs.readFileSync(FAIL_PATH, 'utf8')).count) || 0; } catch (_) {}
  try { writeSecret(FAIL_PATH, JSON.stringify({ count: count + 1, ts: Date.now() })); } catch (_) {}
}
function clearFailures() { try { fs.unlinkSync(FAIL_PATH); } catch (_) {} }

// Detached child that refreshes the ad cache so the statusline never waits on the network.
function spawnRefresh(sessionId) {
  if (inBackoff()) return;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'refresh-ad.js')], {
      env: Object.assign({}, process.env, { SPONSORIC_SESSION: String(sessionId || '') }),
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (_) {}
}

// Fetch the next ad from the network and update the cache. Called by refresh-ad.js.
function refreshAd(sessionId, done) {
  const tag = sessionTag(sessionId);
  if (MOCK) { writeAdCache(tag, mockAd()); return done && done(); }
  request('GET', `${API_BASE}/ad/next?tag=${tag}`, null, 2500, (err, code, json) => {
    if (!err && code === 200 && json && json.text) {
      writeAdCache(tag, { id: json.id || 'ad', text: json.text, url: json.url || null });
      clearFailures();
    } else {
      recordFailure();
    }
    done && done();
  });
}

// Report a VIEWABLE impression — only ever called after the sponsor line actually rendered.
// Throttled per session. Fire-and-forget; failures are silent and never affect the terminal.
function reportImpression(sessionId, ad, shownMs) {
  if (DISABLED || LEVEL === 0 || (!PAYOUT_ID && !MOCK) || !ad) return;
  // Without a publisher key the impression can't be authenticated/credited — skip it
  // rather than send an unauthenticated request. Register with `npx sponsoric --register`.
  if (!MOCK && !PUBLISHER_KEY) return;
  const tag = sessionTag(sessionId);
  const stamp = impStampPath(tag);
  try {
    const st = fs.statSync(stamp);
    if (Date.now() - st.mtimeMs < IMPRESSION_THROTTLE_MS) return; // throttle
  } catch (_) {}
  try { writeSecret(stamp, ''); } catch (_) {}

  const body = {
    publisher_id: PAYOUT_ID || 'mock',
    session_tag: tag,          // truncated hash, not the raw session id
    ad_id: ad.id || null,
    shown_ms: shownMs || null,
    ts: Date.now(),
    surface: 'statusline',
    level: LEVEL            // which tier actually rendered; server prices it (clamped, never trusted blindly)
  };
  if (MOCK) return; // in mock mode, nothing leaves the machine
  request('POST', `${API_BASE}/impression`, body, 2000, () => {});
}

module.exports = {
  getCachedAd, refreshAd, reportImpression, sessionTag,
  inBackoff, recordFailure, clearFailures, request,
  secureDir, writeSecret, configIsTrustworthy,
  STATE_DIR, CONFIG_PATH, API_BASE, PAYOUT_ID, PUBLISHER_KEY, MOCK, DISABLED, CHAIN, LEVEL
};
