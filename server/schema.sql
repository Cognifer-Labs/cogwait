-- Cogwait backend — Postgres schema.
-- server/store-pg.js applies this automatically on startup (CREATE TABLE IF NOT
-- EXISTS), so you don't have to run it by hand — it's here for review and for
-- provisioning with restricted DB roles that can't create tables at runtime.

CREATE TABLE IF NOT EXISTS publishers (
  id                text PRIMARY KEY,
  balance_usd       numeric  NOT NULL DEFAULT 0,
  impressions       integer  NOT NULL DEFAULT 0,
  created           bigint   NOT NULL,
  secret            text     NOT NULL,
  stripe_account    text,
  donate_pct        numeric  NOT NULL DEFAULT 20  -- Fund-OSS give-back %, on by default
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                    text PRIMARY KEY,
  advertiser            text,
  text                  text    NOT NULL,
  url                   text,
  cpm_usd               numeric NOT NULL,
  budget_usd            numeric NOT NULL,
  budget_remaining_usd  numeric NOT NULL,
  status                text    NOT NULL,   -- 'pending' | 'approved'
  created               bigint  NOT NULL
);

CREATE TABLE IF NOT EXISTS impressions (
  id           bigserial PRIMARY KEY,
  pid          text    NOT NULL,
  amount       numeric NOT NULL,
  ts           bigint  NOT NULL,            -- epoch ms
  ad_id        text,
  session_tag  text,
  level        integer
);
-- Backs the per-session daily cap query.
CREATE INDEX IF NOT EXISTS idx_impr_tag_ts ON impressions (session_tag, ts);

CREATE TABLE IF NOT EXISTS payouts (
  id                bigserial PRIMARY KEY,
  pid               text    NOT NULL,
  amount_usd        numeric NOT NULL,
  ts                bigint  NOT NULL,
  transfer          text,
  simulated         boolean,
  kind              text    NOT NULL DEFAULT 'cashout',  -- 'cashout' | 'donation'
  fund              text,                                -- donation destination; null for cashout
  status            text    NOT NULL DEFAULT 'settled',   -- 'pending' | 'settled'
  idempotency_key   text                                 -- forwarded to Stripe's Idempotency-Key header
);
-- Backs the resume-a-pending-payout lookup (server/index.js §8.0).
CREATE INDEX IF NOT EXISTS idx_payouts_pid_status ON payouts (pid, status);

-- Atomic impression dedupe across instances (key = "<session_tag>:<ad_id>").
CREATE TABLE IF NOT EXISTS dedupe (
  key  text   PRIMARY KEY,
  ts   bigint NOT NULL
);

-- CREATE TABLE IF NOT EXISTS above does NOT retrofit columns onto an
-- already-deployed table — these ALTERs upgrade existing prod databases in
-- place (store-pg.js applies the equivalent automatically on startup).
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS donate_pct numeric NOT NULL DEFAULT 20;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cashout';
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS fund text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'settled';
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE INDEX IF NOT EXISTS idx_payouts_pid_status ON payouts (pid, status);

-- Belt-and-suspenders against a double-payout race (server/index.js's
-- claimPayoutBatch already serializes resume-or-fresh under a
-- SELECT ... FOR UPDATE row lock on the publisher): at most one pending row
-- per (pid, kind) — a stray second cashout or donation insert for the same
-- publisher fails at the DB rather than silently duplicating a leg.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_pending_pid_kind_uniq ON payouts (pid, kind) WHERE status = 'pending';
