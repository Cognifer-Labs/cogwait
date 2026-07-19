#!/usr/bin/env node
'use strict';
// Sponsoric statusline — the visible ad surface.
// Claude Code pipes session JSON on stdin and renders whatever this prints.
// Contract: fast, non-blocking, never manufactures delay. An impression is
// only reported because the sponsor line was actually rendered to the terminal.

const client = require('../lib/client');

// Never let a closed pipe crash the statusline (it runs inside Claude Code's capture).
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input || '{}'); } catch (_) {}
  const sessionId = data.session_id || 'anon';

  // If chaining an existing statusline, run it first (it renders the user's own row).
  const chained = renderChain(input);

  const ad = client.getCachedAd(sessionId); // sync cache read; refresh happens out of band
  if (!ad) { process.stdout.write(chained); return; } // no ad -> only the chained output, nothing billed

  const block = renderAd(ad, client.LEVEL);
  process.stdout.write(chained + block + '\n');

  // The line rendered -> report a viewable impression (throttled, detached, silent on failure).
  client.reportImpression(sessionId, ad, data.cost && data.cost.total_api_duration_ms);
});

// Render the sponsor placement for the developer's chosen level. Higher levels
// are more prominent (and pay a higher CPM) — the dev opts into the trade.
// Every level stays labeled `[sponsor]` and viewable-only.
function renderAd(ad, level) {
  const DIM = '\x1b[2m', CYAN = '\x1b[36m', BOLD = '\x1b[1m',
        YELLOW = '\x1b[33m', MAGENTA = '\x1b[35m', RESET = '\x1b[0m';
  const link = (s) => ad.url ? `\x1b]8;;${ad.url}\x07${s}\x1b]8;;\x07` : s;

  if (level >= 3) {
    // Boosted: a two-line boxed block — the most prominent placement.
    const label = `${MAGENTA}${BOLD}◆ SPONSOR${RESET}`;
    const head = `${BOLD}${ad.text}${RESET}`;
    const cta = ad.url ? link(`${YELLOW}${ad.url} ›${RESET}`) : `${DIM}sponsored${RESET}`;
    return `${label}  ${head}\n         ${cta}`;
  }
  if (level >= 2) {
    // Standard: one bright, colored line with an icon and a call-to-action.
    const label = `${YELLOW}${BOLD}▸ [sponsor]${RESET}`;
    const text = `${CYAN}${ad.text}${RESET}`;
    return `${label} ${link(text)}${ad.url ? ` ${YELLOW}›${RESET}` : ''}`;
  }
  // Minimal (default): one dim line, barely there.
  const label = `${CYAN}[sponsor]${RESET}`;
  const text = `${DIM}${ad.text}${RESET}`;
  return ad.url ? `${label} ${link(`${text} ›`)}` : `${label} ${text}`;
}

// Run the user's pre-existing statusline command (if configured), feeding it the
// same stdin JSON, and return its output to prepend above the sponsor line.
function renderChain(stdinJson) {
  if (!client.CHAIN) return '';
  // The chained command is the user's own pre-existing statusLine string, and
  // Claude Code itself runs statusLine commands through a shell — so a shell is
  // the faithful (and only correct) way to run pipes/globs here. The real risk
  // is a tampered config: if ~/.sponsoric/config.json is group/other-writable,
  // another user could rewrite `chain`. Refuse to run it in that state.
  if (!client.configIsTrustworthy()) {
    process.stderr.write('[sponsoric] refusing to run chained statusline: config is not owner-only (chmod 600 ~/.sponsoric/config.json)\n');
    return '';
  }
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(client.CHAIN, { input: stdinJson, shell: true, encoding: 'utf8', timeout: 2000 });
    let out = (r.stdout || '');
    if (out && !out.endsWith('\n')) out += '\n';
    return out;
  } catch (_) { return ''; }
}
