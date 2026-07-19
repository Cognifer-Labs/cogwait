-- Sponsoric backend — Postgres schema.
-- server/store-pg.js applies this automatically on startup (CREATE TABLE IF NOT
-- EXISTS), so you don't have to run it by hand — it's here for review and for
-- provisioning with restricted DB roles that can't create tables at runtime.

CREATE TABLE IF NOT EXISTS publishers (
  id                text PRIMARY KEY,
  balance_usd       numeric  NOT NULL DEFAULT 0,
  impressions       integer  NOT NULL DEFAULT 0,
  created           bigint   NOT NULL,
  secret            text     NOT NULL,
  stripe_account    text
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
  id          bigserial PRIMARY KEY,
  pid         text    NOT NULL,
  amount_usd  numeric NOT NULL,
  ts          bigint  NOT NULL,
  transfer    text,
  simulated   boolean
);

-- Atomic impression dedupe across instances (key = "<session_tag>:<ad_id>").
CREATE TABLE IF NOT EXISTS dedupe (
  key  text   PRIMARY KEY,
  ts   bigint NOT NULL
);
