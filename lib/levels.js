'use strict';
// Cogwait ad levels — the single source of truth shared by the client
// (how the sponsor line renders) and the server (what a viewable impression is
// worth). Higher level = more visible/intrusive placement = higher gross CPM,
// so the developer explicitly trades attention for a bigger revenue share.
//
// The developer picks the level (COGWAIT_LEVEL / config `level` / `--level N`).
// It is always opt-in, always labeled, always viewable-only — the level only
// changes how prominent the labeled line is, never whether it's honest.
//
// Gross CPMs are benchmarked to real developer-audience sponsorship rates
// (dev newsletters/podcasts and ethical dev ad networks run ~$10–40 CPM for a
// qualified, in-context, provably-viewed placement — far above the old $2 stub).
// Every value is env-overridable so the network operator sets the live economics.

function envNum(key, dflt) {
  const v = process.env[key];
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// id, key, label, one-line human description, and default GROSS CPM (USD / 1000
// viewable impressions). `lines` is how many rows the placement occupies —
// purely descriptive metadata; the actual ANSI rendering lives in statusline.js.
const LEVELS = [
  { id: 0, key: 'off',      label: 'Off',      lines: 0, cpm: 0,
    desc: 'No sponsor line. Nothing renders, nothing earns.' },
  { id: 1, key: 'minimal',  label: 'Minimal',  lines: 1, cpm: envNum('COGWAIT_CPM_L1', 8),
    desc: 'One dim, single-line sponsor note in the status row. The default — barely there.' },
  { id: 2, key: 'standard', label: 'Standard', lines: 1, cpm: envNum('COGWAIT_CPM_L2', 18),
    desc: 'A brighter, colored single line with an icon and a clear call-to-action.' },
  { id: 3, key: 'boosted',  label: 'Boosted',  lines: 2, cpm: envNum('COGWAIT_CPM_L3', 35),
    desc: 'A two-line boxed sponsor block with headline + link. Prominent, higher-paid.' },
  { id: 4, key: 'banner',   label: 'Banner',   lines: 2, cpm: envNum('COGWAIT_CPM_L4', 60),
    desc: 'A full-width inverse-video banner bar with headline + link — impossible to miss.' },
  { id: 5, key: 'takeover', label: 'Takeover', lines: 4, cpm: envNum('COGWAIT_CPM_L5', 90),
    desc: 'A bordered multi-line takeover block with a blinking marker — the most intrusive surface the status row allows.' }
];

const MAX_LEVEL = LEVELS[LEVELS.length - 1].id;
const DEFAULT_LEVEL = 1;

function clampLevel(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_LEVEL;
  return Math.max(0, Math.min(MAX_LEVEL, v));
}

function level(n) { return LEVELS[clampLevel(n)]; }

// Gross CPM (USD per 1000 viewable impressions) for a level.
function cpmForLevel(n) { return level(n).cpm; }

// What one viewable impression at this level pays the publisher, after the share.
function perImpression(n, share) {
  return (cpmForLevel(n) / 1000) * Number(share);
}

module.exports = { LEVELS, MAX_LEVEL, DEFAULT_LEVEL, clampLevel, level, cpmForLevel, perImpression };
