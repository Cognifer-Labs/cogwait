'use strict';
// File-backed persistent store — dependency-free, atomic writes.
// Replaces the in-memory maps. Good enough for a single-node PoC/self-host;
// swap for Postgres in production (same interface).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA_DIR = process.env.SPONSORIC_DATA_DIR || path.join(os.homedir(), '.sponsoric', 'server');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY = { publishers: {}, campaigns: {}, impressions: [], payouts: [] };
let db = null;

function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (_) { db = JSON.parse(JSON.stringify(EMPTY)); }
  for (const k of Object.keys(EMPTY)) if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(EMPTY[k]));
  return db;
}

let writeTimer = null;
function persist() {
  // Debounced atomic write (temp file + rename).
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_PATH);
    } catch (_) {}
  }, 50);
  if (writeTimer.unref) writeTimer.unref();
}

function flush() { // synchronous, for shutdown
  if (!db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_PATH);
  } catch (_) {}
}

// Get-or-create. On create, mint a per-publisher secret used to authenticate
// all publisher-scoped requests. The secret is returned only at registration.
function publisher(pid) {
  const d = load();
  if (!d.publishers[pid]) {
    d.publishers[pid] = {
      id: pid, balance_usd: 0, impressions: 0, created: Date.now(),
      secret: crypto.randomBytes(24).toString('hex'),
      stripe_account: null
    };
    persist();
  }
  return d.publishers[pid];
}

// Non-creating lookup — returns undefined if the publisher does not exist.
function getPublisher(pid) {
  const d = load();
  return d.publishers[pid];
}

function setStripeAccount(pid, acct) {
  const p = publisher(pid);
  p.stripe_account = acct || null;
  persist();
  return p;
}

function creditImpression(pid, amount, meta) {
  const p = publisher(pid);
  p.impressions += 1;
  p.balance_usd = round(p.balance_usd + amount);
  load().impressions.push({ pid, amount, ts: Date.now(), ad_id: meta.ad_id, session_tag: meta.session_tag });
  persist();
  return p;
}

function addCampaign(c) {
  const d = load();
  d.campaigns[c.id] = c;
  persist();
  return c;
}

function activeCampaigns() {
  const d = load();
  return Object.values(d.campaigns).filter(c => c.status === 'approved' && c.budget_remaining_usd > 0);
}

function spendCampaign(id, amount) {
  const d = load();
  const c = d.campaigns[id];
  if (c) { c.budget_remaining_usd = round(Math.max(0, c.budget_remaining_usd - amount)); persist(); }
  return c;
}

function recordPayout(p) { load().payouts.push(p); persist(); return p; }
function payoutsFor(pid) { return load().payouts.filter(p => p.pid === pid); }

function impressionsInWindow(sessionTag, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return load().impressions.filter(i => i.session_tag === sessionTag && i.ts >= cutoff).length;
}

function round(n) { return Math.round(n * 1e6) / 1e6; }

module.exports = {
  load, persist, flush, publisher, getPublisher, setStripeAccount, creditImpression,
  addCampaign, activeCampaigns, spendCampaign,
  recordPayout, payoutsFor, impressionsInWindow, round, DB_PATH, DATA_DIR
};
