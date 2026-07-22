'use strict';
// Postgres-backed store — same async interface as store-json.js, safe across
// multiple instances (serverless / horizontally scaled). Selected automatically
// when DATABASE_URL is set. Requires the optional `pg` dependency.
//
// Money is stored as numeric and read back as JS numbers rounded to 6dp, matching
// the JSON store. Impression dedupe is atomic in SQL so concurrent instances
// can't double-bill the same (session_tag, ad_id) within the window.

const crypto = require('crypto');

let Pool;
try { ({ Pool } = require('pg')); }
catch (_) { throw new Error("DATABASE_URL is set but the 'pg' package is not installed. Run `npm install pg`."); }

const url = process.env.DATABASE_URL;
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url || '');

// TLS: verify certificates by default (never silently disable — that invites
// MITM). Opt out only explicitly:
//   PGSSL=disable       → no TLS (local/dev, or TLS terminated upstream)
//   PGSSLROOTCERT=path  → verify against this CA (preferred for hosted PG)
//   PGSSL=no-verify     → encrypt but skip verification (last resort; logs a warning)
function sslConfig() {
  if (process.env.PGSSL === 'disable' || (isLocal && !process.env.PGSSL)) return false;
  if (process.env.PGSSLROOTCERT) {
    return { ca: require('fs').readFileSync(process.env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true };
  }
  if (process.env.PGSSL === 'no-verify') {
    process.stderr.write('[cogwait] WARNING: PGSSL=no-verify — TLS certificate verification is OFF (MITM risk). Set PGSSLROOTCERT to verify.\n');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}
const pool = new Pool({
  connectionString: url,
  ssl: sslConfig(),
  max: Number(process.env.PGPOOL_MAX || 10)
});

function round(n) { return Math.round(Number(n) * 1e6) / 1e6; }
function q(text, params) { return pool.query(text, params); }

function mapPublisher(r) {
  return r && {
    id: r.id, balance_usd: round(r.balance_usd), impressions: Number(r.impressions),
    created: Number(r.created), secret: r.secret, stripe_account: r.stripe_account,
    donate_pct: Number(r.donate_pct),
    payout_method: r.payout_method || 'stripe', paypal_email: r.paypal_email || null,
    recovery_email: r.recovery_email || null
  };
}
function mapCampaign(r) {
  return r && {
    id: r.id, advertiser: r.advertiser, text: r.text, url: r.url,
    cpm_usd: round(r.cpm_usd), budget_usd: round(r.budget_usd),
    budget_remaining_usd: round(r.budget_remaining_usd), status: r.status, created: Number(r.created),
    contact_email: r.contact_email || null
  };
}
function mapPayout(r) {
  return r && {
    id: r.id, pid: r.pid, amount_usd: round(r.amount_usd), ts: Number(r.ts),
    transfer: r.transfer, simulated: r.simulated,
    kind: r.kind, fund: r.fund, status: r.status, idempotency_key: r.idempotency_key
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS publishers (
  id text PRIMARY KEY, balance_usd numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0, created bigint NOT NULL,
  secret text NOT NULL, stripe_account text, donate_pct numeric NOT NULL DEFAULT 20,
  payout_method text NOT NULL DEFAULT 'stripe', paypal_email text, recovery_email text
);
CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY, advertiser text, text text NOT NULL, url text,
  cpm_usd numeric NOT NULL, budget_usd numeric NOT NULL,
  budget_remaining_usd numeric NOT NULL, status text NOT NULL, created bigint NOT NULL,
  contact_email text
);
CREATE TABLE IF NOT EXISTS impressions (
  id bigserial PRIMARY KEY, pid text NOT NULL, amount numeric NOT NULL,
  ts bigint NOT NULL, ad_id text, session_tag text, level integer
);
CREATE INDEX IF NOT EXISTS idx_impr_tag_ts ON impressions (session_tag, ts);
CREATE TABLE IF NOT EXISTS payouts (
  id bigserial PRIMARY KEY, pid text NOT NULL, amount_usd numeric NOT NULL,
  ts bigint NOT NULL, transfer text, simulated boolean,
  kind text NOT NULL DEFAULT 'cashout', fund text,
  status text NOT NULL DEFAULT 'settled', idempotency_key text
);
CREATE TABLE IF NOT EXISTS dedupe ( key text PRIMARY KEY, ts bigint NOT NULL );
CREATE TABLE IF NOT EXISTS campaign_submissions (
  id bigserial PRIMARY KEY, ip text NOT NULL, ts bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_ip_ts ON campaign_submissions (ip, ts);

-- CREATE TABLE IF NOT EXISTS does NOT retrofit columns onto an already-deployed
-- table — these ALTERs upgrade existing prod databases in place.
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS donate_pct numeric NOT NULL DEFAULT 20;
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'stripe';
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS paypal_email text;
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS recovery_email text;
ALTER TABLE campaigns  ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cashout';
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS fund text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'settled';
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE INDEX IF NOT EXISTS idx_payouts_pid_status ON payouts (pid, status);
-- Belt-and-suspenders against a double-payout race (server/index.js claimPayoutBatch
-- already serializes resume-or-fresh under a row lock): at most one pending row per
-- (pid, kind) — a stray second cashout or donation insert for the same publisher
-- fails at the DB rather than silently duplicating a leg.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_pending_pid_kind_uniq ON payouts (pid, kind) WHERE status = 'pending';
`;

async function init() { await pool.query(SCHEMA); }

async function publisher(pid) {
  const secret = crypto.randomBytes(24).toString('hex');
  await q(
    `INSERT INTO publishers (id, created, secret) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [pid, Date.now(), secret]
  );
  const { rows } = await q(`SELECT * FROM publishers WHERE id = $1`, [pid]);
  return mapPublisher(rows[0]);
}
async function getPublisher(pid) {
  const { rows } = await q(`SELECT * FROM publishers WHERE id = $1`, [pid]);
  return mapPublisher(rows[0]);
}
async function setStripeAccount(pid, acct) {
  await publisher(pid);
  const { rows } = await q(`UPDATE publishers SET stripe_account = $2 WHERE id = $1 RETURNING *`, [pid, acct || null]);
  return mapPublisher(rows[0]);
}
// Set/clear the optional account-recovery email — mirrors store-json.js
// setRecoveryEmail. The server validates+normalizes the address first; null clears it.
async function setRecoveryEmail(pid, email) {
  await publisher(pid);
  const { rows } = await q(`UPDATE publishers SET recovery_email = $2 WHERE id = $1 RETURNING *`, [pid, email || null]);
  return mapPublisher(rows[0]);
}
// Issue a fresh publisher key (secret) — same generation mechanism as register
// (crypto.randomBytes(24) hex). The old key stops authenticating the instant this
// commits, since auth reads the current secret column.
async function rotateKey(pid) {
  await publisher(pid);
  const secret = crypto.randomBytes(24).toString('hex');
  const { rows } = await q(`UPDATE publishers SET secret = $2 WHERE id = $1 RETURNING *`, [pid, secret]);
  return mapPublisher(rows[0]);
}
// Set the cashout rail — mirrors store-json.js setPayoutMethod. `method` must be
// 'stripe' or 'paypal' (anything else leaves the rail unchanged); `paypal_email`
// is written only for a 'paypal' method with a plausible address.
function plausibleEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254;
}
async function setPayoutMethod(pid, method, email) {
  await publisher(pid);
  const sets = []; const vals = [pid]; let i = 2;
  if (method === 'stripe' || method === 'paypal') { sets.push(`payout_method = $${i++}`); vals.push(method); }
  if (method === 'paypal' && plausibleEmail(email)) { sets.push(`paypal_email = $${i++}`); vals.push(email); }
  if (!sets.length) {
    const { rows } = await q(`SELECT * FROM publishers WHERE id = $1`, [pid]);
    return mapPublisher(rows[0]);
  }
  const { rows } = await q(`UPDATE publishers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
  return mapPublisher(rows[0]);
}
async function setBalance(pid, amount) {
  const { rows } = await q(`UPDATE publishers SET balance_usd = $2 WHERE id = $1 RETURNING *`, [pid, round(amount)]);
  return mapPublisher(rows[0]);
}
// Clamp 0-100 server-side — the client can't be trusted to move money.
async function setDonatePct(pid, pct) {
  await publisher(pid);
  const n = Math.round(Number(pct));
  if (!Number.isFinite(n)) {
    const { rows } = await q(`SELECT * FROM publishers WHERE id = $1`, [pid]);
    return mapPublisher(rows[0]);
  }
  const clamped = Math.max(0, Math.min(100, n));
  const { rows } = await q(`UPDATE publishers SET donate_pct = $2 WHERE id = $1 RETURNING *`, [pid, clamped]);
  return mapPublisher(rows[0]);
}
async function creditImpression(pid, amount, meta) {
  await publisher(pid);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE publishers SET balance_usd = balance_usd + $2, impressions = impressions + 1 WHERE id = $1 RETURNING *`,
      [pid, round(amount)]
    );
    await client.query(
      `INSERT INTO impressions (pid, amount, ts, ad_id, session_tag, level) VALUES ($1,$2,$3,$4,$5,$6)`,
      [pid, round(amount), Date.now(), meta.ad_id || null, meta.session_tag || null, meta.level ?? null]
    );
    await client.query('COMMIT');
    return mapPublisher(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

// Erase a publisher and everything attached to them (PRIVACY.md right to
// removal) — same contract as store-json.js deletePublisher. One transaction so
// a crash can't leave orphaned impression/payout rows pointing at a publisher
// that no longer exists. The caller refuses while a balance or a pending payout
// leg exists, so this only ever runs on a settled, zero-balance account.
async function deletePublisher(pid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM impressions WHERE pid = $1`, [pid]);
    await client.query(`DELETE FROM payouts WHERE pid = $1`, [pid]);
    const { rowCount } = await client.query(`DELETE FROM publishers WHERE id = $1`, [pid]);
    await client.query('COMMIT');
    return rowCount > 0;
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

async function addCampaign(c) {
  await q(
    `INSERT INTO campaigns (id, advertiser, text, url, cpm_usd, budget_usd, budget_remaining_usd, status, created, contact_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET advertiser=EXCLUDED.advertiser, text=EXCLUDED.text, url=EXCLUDED.url,
       cpm_usd=EXCLUDED.cpm_usd, budget_usd=EXCLUDED.budget_usd, budget_remaining_usd=EXCLUDED.budget_remaining_usd,
       status=EXCLUDED.status,
       -- keep an existing contact_email when an admin re-upsert (POST /campaign) omits it
       contact_email=COALESCE(EXCLUDED.contact_email, campaigns.contact_email)`,
    [c.id, c.advertiser, c.text, c.url, c.cpm_usd, c.budget_usd, c.budget_remaining_usd, c.status, c.created, c.contact_email || null]
  );
  return c;
}
async function getCampaign(id) {
  const { rows } = await q(`SELECT * FROM campaigns WHERE id = $1`, [id]);
  return mapCampaign(rows[0]);
}
async function allCampaigns() {
  const { rows } = await q(`SELECT * FROM campaigns`);
  return rows.map(mapCampaign);
}
async function activeCampaigns() {
  const { rows } = await q(`SELECT * FROM campaigns WHERE status = 'approved' AND budget_remaining_usd > 0`);
  return rows.map(mapCampaign);
}
// Moderation (AD_POLICY.md): approve / reject / freeze — mirrors
// store-json.js setCampaignStatus. Returns null for an unknown campaign so the
// caller can 404. Budget is deliberately untouched: freezing stops serving
// (activeCampaigns only returns 'approved') but preserves the remaining budget.
async function setCampaignStatus(id, status) {
  const { rows } = await q(`UPDATE campaigns SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
  return rows.length ? mapCampaign(rows[0]) : null;
}
async function spendCampaign(id, amount) {
  const { rows } = await q(
    `UPDATE campaigns SET budget_remaining_usd = GREATEST(0, budget_remaining_usd - $2) WHERE id = $1 RETURNING *`,
    [id, round(amount)]
  );
  return mapCampaign(rows[0]);
}

// Fund-OSS two-leg payout idempotency (see server/index.js §8.0): a payout row
// is inserted with status:'pending' BEFORE the Stripe call, so a crash or a
// failed sibling leg is safely resumable — never re-attempted, never lost.
// `status` defaults to 'settled' for backward compat with pre-fund-oss rows.
async function recordPayout(p) {
  const kind = p.kind || 'cashout';
  const status = p.status || 'settled';
  const { rows } = await q(
    `INSERT INTO payouts (pid, amount_usd, ts, transfer, simulated, kind, fund, status, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [p.pid, round(p.amount_usd), p.ts, p.transfer || null, !!p.simulated, kind, p.fund || null, status, p.idempotency_key || null]
  );
  return Object.assign({}, p, { id: rows[0].id, kind, status });
}
// Settled payouts only — an in-flight pending row is never shown as finished.
async function payoutsFor(pid) {
  const { rows } = await q(`SELECT * FROM payouts WHERE pid = $1 AND status = 'settled' ORDER BY ts DESC`, [pid]);
  return rows.map(mapPayout);
}
async function pendingPayoutsFor(pid) {
  const { rows } = await q(`SELECT * FROM payouts WHERE pid = $1 AND status = 'pending' ORDER BY ts ASC`, [pid]);
  return rows.map(mapPayout);
}

// Atomic "resume existing pending batch OR create a fresh one" — the fix for
// the double-payout race: two concurrent callers for the same pid must never
// both observe "nothing pending" and both compute+insert a fresh batch off the
// same un-moved balance. Locks the publisher row FOR UPDATE for the lifetime
// of the transaction, so a second concurrent call blocks until the first
// commits (or rolls back), then re-reads a consistent, up-to-date state.
//
// `computeLegs(lockedPub)` is caller-supplied business logic (min-payout
// threshold, donate_pct clamp, FUND_LABEL) — the store only owns the
// concurrency-critical check-then-insert, never the money-split policy.
// Returns { pub, resumed, belowMinimum, cashoutRow, donationRow }.
async function claimPayoutBatch(pid, computeLegs) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prows } = await client.query(`SELECT * FROM publishers WHERE id = $1 FOR UPDATE`, [pid]);
    const pub = mapPublisher(prows[0]);
    if (!pub) {
      await client.query('ROLLBACK');
      return { pub: null, resumed: false, belowMinimum: true, cashoutRow: null, donationRow: null };
    }

    const { rows: pendingRows } = await client.query(
      `SELECT * FROM payouts WHERE pid = $1 AND status = 'pending' ORDER BY ts ASC`, [pid]
    );
    if (pendingRows.length) {
      // Resume: reuse the fixed amounts/keys already committed to disk. Do NOT
      // recompute from the current balance — it hasn't moved, and recomputing
      // risks drift if donate_pct changed mid-flight.
      await client.query('COMMIT');
      const mapped = pendingRows.map(mapPayout);
      return {
        pub, resumed: true, belowMinimum: false,
        cashoutRow: mapped.find((r) => r.kind === 'cashout') || null,
        donationRow: mapped.find((r) => r.kind === 'donation') || null
      };
    }

    const legs = computeLegs(pub);
    if (!legs || (!(legs.keep > 0) && !(legs.donate > 0))) {
      await client.query('ROLLBACK');
      return { pub, resumed: false, belowMinimum: true, cashoutRow: null, donationRow: null };
    }

    const batchId = crypto.randomBytes(8).toString('hex');
    let cashoutRow = null, donationRow = null;
    // Insert pending rows BEFORE any Stripe call — durable before the network,
    // so a crash mid-transfer is safely resumable.
    if (legs.keep > 0) {
      const { rows } = await client.query(
        `INSERT INTO payouts (pid, amount_usd, ts, kind, fund, status, idempotency_key)
         VALUES ($1,$2,$3,'cashout',NULL,'pending',$4) RETURNING *`,
        [pid, round(legs.keep), Date.now(), `payout_${pid}_${batchId}_cashout`]
      );
      cashoutRow = mapPayout(rows[0]);
    }
    if (legs.donate > 0) {
      const { rows } = await client.query(
        `INSERT INTO payouts (pid, amount_usd, ts, kind, fund, status, idempotency_key)
         VALUES ($1,$2,$3,'donation',$4,'pending',$5) RETURNING *`,
        [pid, round(legs.donate), Date.now(), legs.fund || null, `payout_${pid}_${batchId}_donation`]
      );
      donationRow = mapPayout(rows[0]);
    }
    await client.query('COMMIT');
    return { pub, resumed: false, belowMinimum: false, cashoutRow, donationRow };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function settlePayout(id, patch) {
  const sets = []; const vals = [id]; let i = 2;
  for (const k of ['transfer', 'simulated', 'status']) {
    if (patch[k] !== undefined) { sets.push(`${k} = $${i++}`); vals.push(patch[k]); }
  }
  if (!sets.length) {
    const { rows } = await q(`SELECT * FROM payouts WHERE id = $1`, [id]);
    return mapPayout(rows[0]);
  }
  const { rows } = await q(`UPDATE payouts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
  return mapPayout(rows[0]);
}

// Atomically settle one payout leg AND, if this was the last outstanding
// ('pending') leg for the publisher, zero the balance — in the SAME
// publisher-row-locked transaction claimPayoutBatch uses. This closes the
// second half of the double-payout race: settling a leg and zeroing the
// balance used to be two separate, unlocked steps (server/index.js), so a
// concurrent claimPayoutBatch could acquire the row lock in the gap between
// them, see an empty pending set + a still-unzeroed balance, and compute a
// second real payout from the same money. Locking here means that gap no
// longer exists — the settle and the (conditional) zero commit together, and
// a competing claimPayoutBatch simply blocks until both are done.
async function settlePayoutLeg(pid, id, patch) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM publishers WHERE id = $1 FOR UPDATE`, [pid]);
    const sets = []; const vals = [id]; let i = 2;
    for (const k of ['transfer', 'simulated', 'status']) {
      if (patch[k] !== undefined) { sets.push(`${k} = $${i++}`); vals.push(patch[k]); }
    }
    let row;
    if (sets.length) {
      const { rows } = await client.query(`UPDATE payouts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
      row = mapPayout(rows[0]);
    } else {
      const { rows } = await client.query(`SELECT * FROM payouts WHERE id = $1`, [id]);
      row = mapPayout(rows[0]);
    }
    const { rows: pendingLeft } = await client.query(
      `SELECT count(*)::int AS n FROM payouts WHERE pid = $1 AND status = 'pending'`, [pid]
    );
    let zeroed = false;
    if (pendingLeft[0].n === 0) {
      await client.query(`UPDATE publishers SET balance_usd = 0 WHERE id = $1`, [pid]);
      zeroed = true;
    }
    await client.query('COMMIT');
    return { row, zeroed };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function impressionsInWindow(sessionTag, sinceMs) {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM impressions WHERE session_tag = $1 AND ts >= $2`,
    [sessionTag, Date.now() - sinceMs]
  );
  return rows[0].n;
}

// Anti-abuse for the public /campaign/submit endpoint — mirrors store-json.js.
// Records one accepted submission per IP; counts an IP's submissions in a window.
async function recordSubmission(ip) {
  await q(`INSERT INTO campaign_submissions (ip, ts) VALUES ($1, $2)`, [ip, Date.now()]);
}
async function submissionsInWindow(ip, sinceMs) {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM campaign_submissions WHERE ip = $1 AND ts >= $2`,
    [ip, Date.now() - sinceMs]
  );
  return rows[0].n;
}

// Atomic dedupe: insert-or-refresh only when outside the window. If a returning
// row comes back we (re)claimed the key → not a duplicate; no row → within-window
// conflict → duplicate.
async function dedupeSeen(key, windowMs) {
  const now = Date.now();
  const { rows } = await q(
    `INSERT INTO dedupe (key, ts) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET ts = EXCLUDED.ts WHERE dedupe.ts < $2 - $3
     RETURNING key`,
    [key, now, windowMs]
  );
  return rows.length === 0;
}

async function close() { await pool.end(); }

module.exports = {
  backend: 'postgres', init, round,
  publisher, getPublisher, setStripeAccount, setPayoutMethod, setBalance, setDonatePct, creditImpression,
  setRecoveryEmail, rotateKey, deletePublisher,
  addCampaign, getCampaign, allCampaigns, activeCampaigns, setCampaignStatus, spendCampaign,
  recordPayout, payoutsFor, pendingPayoutsFor, settlePayout, claimPayoutBatch, settlePayoutLeg,
  impressionsInWindow, recordSubmission, submissionsInWindow, dedupeSeen, close
};
