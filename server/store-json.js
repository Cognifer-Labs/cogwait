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

const DATA_DIR = process.env.COGWAIT_DATA_DIR || path.join(os.homedir(), '.cogwait', 'server');
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
      secret: crypto.randomBytes(24).toString('hex'), stripe_account: null,
      donate_pct: 20, // Fund-OSS mode is on by default; the dev dials it down.
      payout_method: 'stripe', paypal_email: null // which rail the cashout leg uses
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
// Clamp 0-100 server-side — the client can't be trusted to move money.
async function setDonatePct(pid, pct) {
  const p = await publisher(pid);
  const n = Math.round(Number(pct));
  if (Number.isFinite(n)) p.donate_pct = Math.max(0, Math.min(100, n));
  persist();
  return p;
}
// Set the cashout rail. `method` must be 'stripe' or 'paypal' (anything else is
// ignored, leaving the current rail). `paypal_email` is stored only when the
// method is 'paypal' and looks like an address — the money can't be sent to a
// destination the client fat-fingered.
function plausibleEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254;
}
async function setPayoutMethod(pid, method, email) {
  const p = await publisher(pid);
  if (method === 'stripe' || method === 'paypal') p.payout_method = method;
  if (p.payout_method === 'paypal' && plausibleEmail(email)) p.paypal_email = email;
  persist();
  return p;
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

// Erase a publisher and everything attached to them (PRIVACY.md right to
// removal). The caller (server/index.js) refuses while a balance or a pending
// payout leg exists, so this only ever runs on a settled, zero-balance account.
// Settled payout rows go too — they are the publisher's own financial history,
// and the point of the request is that no record of them remains.
async function deletePublisher(pid) {
  const d = load();
  if (!d.publishers[pid]) return false;
  delete d.publishers[pid];
  d.impressions = d.impressions.filter((i) => i.pid !== pid);
  d.payouts = d.payouts.filter((r) => r.pid !== pid);
  persist();
  return true;
}

async function addCampaign(c) { const d = load(); d.campaigns[c.id] = c; persist(); return c; }
async function getCampaign(id) { return load().campaigns[id]; }
async function allCampaigns() { return Object.values(load().campaigns); }
async function activeCampaigns() {
  return Object.values(load().campaigns).filter((c) => c.status === 'approved' && c.budget_remaining_usd > 0);
}
// Moderation (AD_POLICY.md): approve / reject / freeze. Returns null for an
// unknown campaign so the caller can 404. Budget is deliberately untouched — a
// frozen campaign stops serving (activeCampaigns only returns 'approved') but
// keeps its remaining budget for an un-freeze or an out-of-band refund.
async function setCampaignStatus(id, status) {
  const c = load().campaigns[id];
  if (!c) return null;
  c.status = status;
  persist();
  return c;
}
async function spendCampaign(id, amount) {
  const c = load().campaigns[id];
  if (c) { c.budget_remaining_usd = round(Math.max(0, c.budget_remaining_usd - amount)); persist(); }
  return c;
}

// Fund-OSS two-leg payout idempotency (see server/index.js §8.0): a payout row
// is inserted with status:'pending' BEFORE the Stripe call, so a crash or a
// failed sibling leg is safely resumable — never re-attempted, never lost.
// `status` defaults to 'settled' for backward compat with pre-fund-oss rows
// that never had the field at all.
async function recordPayout(p) {
  const row = Object.assign({
    id: crypto.randomBytes(12).toString('hex'),
    kind: 'cashout', fund: null, status: 'settled', idempotency_key: null
  }, p);
  load().payouts.push(row);
  persist();
  return row;
}
// Settled payouts only — an in-flight pending row is never shown as finished.
async function payoutsFor(pid) {
  return load().payouts.filter((p) => p.pid === pid && (p.status === 'settled' || p.status === undefined));
}
async function pendingPayoutsFor(pid) {
  return load().payouts.filter((p) => p.pid === pid && p.status === 'pending');
}

// Atomic "resume existing pending batch OR create a fresh one" — same contract
// as store-pg.js's claimPayoutBatch (interface parity), kept here as a single
// synchronous check-then-insert since this store has no separate DB round
// trips for two concurrent requests to race between (see store-pg.js for why
// the race is real there). `computeLegs(pub)` is caller-supplied business
// logic (min-payout threshold, donate_pct clamp, fund label); this store only
// owns the check-then-insert mechanics.
async function claimPayoutBatch(pid, computeLegs) {
  const pub = await getPublisher(pid);
  if (!pub) return { pub: null, resumed: false, belowMinimum: true, cashoutRow: null, donationRow: null };

  const pending = load().payouts.filter((p) => p.pid === pid && p.status === 'pending');
  if (pending.length) {
    return {
      pub, resumed: true, belowMinimum: false,
      cashoutRow: pending.find((p) => p.kind === 'cashout') || null,
      donationRow: pending.find((p) => p.kind === 'donation') || null
    };
  }

  const legs = computeLegs(pub);
  if (!legs || (!(legs.keep > 0) && !(legs.donate > 0))) {
    return { pub, resumed: false, belowMinimum: true, cashoutRow: null, donationRow: null };
  }

  const batchId = crypto.randomBytes(8).toString('hex');
  let cashoutRow = null, donationRow = null;
  if (legs.keep > 0) {
    cashoutRow = await recordPayout({
      pid, amount_usd: legs.keep, ts: Date.now(), kind: 'cashout', fund: null,
      status: 'pending', idempotency_key: `payout_${pid}_${batchId}_cashout`
    });
  }
  if (legs.donate > 0) {
    donationRow = await recordPayout({
      pid, amount_usd: legs.donate, ts: Date.now(), kind: 'donation', fund: legs.fund || null,
      status: 'pending', idempotency_key: `payout_${pid}_${batchId}_donation`
    });
  }
  return { pub, resumed: false, belowMinimum: false, cashoutRow, donationRow };
}
async function settlePayout(id, patch) {
  const row = load().payouts.find((p) => p.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  persist();
  return row;
}

// Settle one payout leg AND, if this was the last outstanding ('pending') leg
// for the publisher, zero the balance — same contract as store-pg.js's
// settlePayoutLeg (interface parity). Kept here as a single synchronous
// check-then-write since this store has no separate DB round trips for two
// concurrent requests to race between.
async function settlePayoutLeg(pid, id, patch) {
  const d = load();
  const row = d.payouts.find((p) => p.id === id);
  if (!row) return { row: null, zeroed: false };
  Object.assign(row, patch);
  const stillPending = d.payouts.some((p) => p.pid === pid && p.status === 'pending');
  let zeroed = false;
  if (!stillPending) {
    const pub = d.publishers[pid];
    if (pub) { pub.balance_usd = 0; zeroed = true; }
  }
  persist();
  return { row, zeroed };
}

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
  publisher, getPublisher, setStripeAccount, setPayoutMethod, setBalance, setDonatePct, creditImpression,
  deletePublisher,
  addCampaign, getCampaign, allCampaigns, activeCampaigns, setCampaignStatus, spendCampaign,
  recordPayout, payoutsFor, pendingPayoutsFor, settlePayout, claimPayoutBatch, settlePayoutLeg,
  impressionsInWindow, dedupeSeen, close,
  flush, DB_PATH, DATA_DIR
};
