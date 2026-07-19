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
    process.stderr.write('[sponsoric] WARNING: PGSSL=no-verify — TLS certificate verification is OFF (MITM risk). Set PGSSLROOTCERT to verify.\n');
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
    created: Number(r.created), secret: r.secret, stripe_account: r.stripe_account
  };
}
function mapCampaign(r) {
  return r && {
    id: r.id, advertiser: r.advertiser, text: r.text, url: r.url,
    cpm_usd: round(r.cpm_usd), budget_usd: round(r.budget_usd),
    budget_remaining_usd: round(r.budget_remaining_usd), status: r.status, created: Number(r.created)
  };
}
function mapPayout(r) {
  return { pid: r.pid, amount_usd: round(r.amount_usd), ts: Number(r.ts), transfer: r.transfer, simulated: r.simulated };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS publishers (
  id text PRIMARY KEY, balance_usd numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0, created bigint NOT NULL,
  secret text NOT NULL, stripe_account text
);
CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY, advertiser text, text text NOT NULL, url text,
  cpm_usd numeric NOT NULL, budget_usd numeric NOT NULL,
  budget_remaining_usd numeric NOT NULL, status text NOT NULL, created bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS impressions (
  id bigserial PRIMARY KEY, pid text NOT NULL, amount numeric NOT NULL,
  ts bigint NOT NULL, ad_id text, session_tag text, level integer
);
CREATE INDEX IF NOT EXISTS idx_impr_tag_ts ON impressions (session_tag, ts);
CREATE TABLE IF NOT EXISTS payouts (
  id bigserial PRIMARY KEY, pid text NOT NULL, amount_usd numeric NOT NULL,
  ts bigint NOT NULL, transfer text, simulated boolean
);
CREATE TABLE IF NOT EXISTS dedupe ( key text PRIMARY KEY, ts bigint NOT NULL );
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
async function setBalance(pid, amount) {
  const { rows } = await q(`UPDATE publishers SET balance_usd = $2 WHERE id = $1 RETURNING *`, [pid, round(amount)]);
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

async function addCampaign(c) {
  await q(
    `INSERT INTO campaigns (id, advertiser, text, url, cpm_usd, budget_usd, budget_remaining_usd, status, created)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET advertiser=EXCLUDED.advertiser, text=EXCLUDED.text, url=EXCLUDED.url,
       cpm_usd=EXCLUDED.cpm_usd, budget_usd=EXCLUDED.budget_usd, budget_remaining_usd=EXCLUDED.budget_remaining_usd,
       status=EXCLUDED.status`,
    [c.id, c.advertiser, c.text, c.url, c.cpm_usd, c.budget_usd, c.budget_remaining_usd, c.status, c.created]
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
async function spendCampaign(id, amount) {
  const { rows } = await q(
    `UPDATE campaigns SET budget_remaining_usd = GREATEST(0, budget_remaining_usd - $2) WHERE id = $1 RETURNING *`,
    [id, round(amount)]
  );
  return mapCampaign(rows[0]);
}

async function recordPayout(p) {
  await q(`INSERT INTO payouts (pid, amount_usd, ts, transfer, simulated) VALUES ($1,$2,$3,$4,$5)`,
    [p.pid, round(p.amount_usd), p.ts, p.transfer, !!p.simulated]);
  return p;
}
async function payoutsFor(pid) {
  const { rows } = await q(`SELECT * FROM payouts WHERE pid = $1 ORDER BY ts DESC`, [pid]);
  return rows.map(mapPayout);
}

async function impressionsInWindow(sessionTag, sinceMs) {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM impressions WHERE session_tag = $1 AND ts >= $2`,
    [sessionTag, Date.now() - sinceMs]
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
  publisher, getPublisher, setStripeAccount, setBalance, creditImpression,
  addCampaign, getCampaign, allCampaigns, activeCampaigns, spendCampaign,
  recordPayout, payoutsFor, impressionsInWindow, dedupeSeen, close
};
