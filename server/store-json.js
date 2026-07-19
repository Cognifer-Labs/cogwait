'use strict';
// File-backed store — async interface, dependency-free, atomic writes.
// Good for single-node self-host / local testing. For multi-instance production
// use store-pg.js (selected automatically when DATABASE_URL is set).
//
// Every data method is async so the server code is uniform across backends,
// even though file I/O here is synchronous under the hood.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA_DIR = process.env.SPONSORIC_DATA_DIR || path.join(os.homedir(), '.sponsoric', 'server');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY = { publishers: {}, campaigns: {}, impressions: [], payouts: [] };
let db = null;
const dedupe = new Map(); // key -> ts (in-memory; single-instance)

function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (_) { db = JSON.parse(JSON.stringify(EMPTY)); }
  for (const k of Object.keys(EMPTY)) if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(EMPTY[k]));
  return db;
}

let writeTimer = null;
function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; flush(); }, 50);
  if (writeTimer.unref) writeTimer.unref();
}
function flush() {
  if (!db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_PATH);
  } catch (_) {}
}

function round(n) { return Math.round(n * 1e6) / 1e6; }

async function init() { load(); }

async function publisher(pid) {
  const d = load();
  if (!d.publishers[pid]) {
    d.publishers[pid] = {
      id: pid, balance_usd: 0, impressions: 0, created: Date.now(),
      secret: crypto.randomBytes(24).toString('hex'), stripe_account: null
    };
    persist();
  }
  return d.publishers[pid];
}
async function getPublisher(pid) { return load().publishers[pid]; }

async function setStripeAccount(pid, acct) {
  const p = await publisher(pid);
  p.stripe_account = acct || null; persist(); return p;
}
async function setBalance(pid, amount) {
  const p = await publisher(pid);
  p.balance_usd = round(amount); persist(); return p;
}
async function creditImpression(pid, amount, meta) {
  const p = await publisher(pid);
  p.impressions += 1;
  p.balance_usd = round(p.balance_usd + amount);
  load().impressions.push({ pid, amount, ts: Date.now(), ad_id: meta.ad_id, session_tag: meta.session_tag, level: meta.level });
  persist();
  return p;
}

async function addCampaign(c) { const d = load(); d.campaigns[c.id] = c; persist(); return c; }
async function getCampaign(id) { return load().campaigns[id]; }
async function allCampaigns() { return Object.values(load().campaigns); }
async function activeCampaigns() {
  return Object.values(load().campaigns).filter((c) => c.status === 'approved' && c.budget_remaining_usd > 0);
}
async function spendCampaign(id, amount) {
  const c = load().campaigns[id];
  if (c) { c.budget_remaining_usd = round(Math.max(0, c.budget_remaining_usd - amount)); persist(); }
  return c;
}

async function recordPayout(p) { load().payouts.push(p); persist(); return p; }
async function payoutsFor(pid) { return load().payouts.filter((p) => p.pid === pid); }

async function impressionsInWindow(sessionTag, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return load().impressions.filter((i) => i.session_tag === sessionTag && i.ts >= cutoff).length;
}

// Atomic "seen within window?": true if a duplicate, else records + returns false.
async function dedupeSeen(key, windowMs) {
  const now = Date.now();
  const last = dedupe.get(key);
  if (last && now - last < windowMs) return true;
  dedupe.set(key, now);
  return false;
}

async function close() { flush(); }

module.exports = {
  backend: 'json', init, round,
  publisher, getPublisher, setStripeAccount, setBalance, creditImpression,
  addCampaign, getCampaign, allCampaigns, activeCampaigns, spendCampaign,
  recordPayout, payoutsFor, impressionsInWindow, dedupeSeen, close,
  flush, DB_PATH, DATA_DIR
};
