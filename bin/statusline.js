#!/usr/bin/env node
'use strict';
// Cogwait statusline — the visible ad surface.
// Claude Code pipes session JSON on stdin and renders whatever this prints.
// Contract: fast, non-blocking, never manufactures delay. An impression is
// only reported because the sponsor line was actually rendered to the terminal.

const client = require('../lib/client');
const news = require('../lib/news');
const { renderAd, renderNews } = require('../lib/render');

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
  if (!ad) {
    // No ad -> unpaid AI-news fallback (never [sponsor], never reported as an
    // impression). Nothing cached/enabled -> just the chained output, as before.
    const item = news.getCachedNews();
    process.stdout.write(item ? chained + renderNews(item) + '\n' : chained);
    return; // nothing billed on this path
  }

  const block = renderAd(ad, client.LEVEL);
  process.stdout.write(chained + block + '\n');

  // The line rendered -> report a viewable impression (throttled, detached, silent on failure).
  client.reportImpression(sessionId, ad, data.cost && data.cost.total_api_duration_ms);
});

// Run the user's pre-existing statusline command (if configured), feeding it the
// same stdin JSON, and return its output to prepend above the sponsor line.
function renderChain(stdinJson) {
  if (!client.CHAIN) return '';
  // The chained command is the user's own pre-existing statusLine string, and
  // Claude Code itself runs statusLine commands through a shell — so a shell is
  // the faithful (and only correct) way to run pipes/globs here. The real risk
  // is a tampered config: if ~/.cogwait/config.json is group/other-writable,
  // another user could rewrite `chain`. Refuse to run it in that state.
  if (!client.configIsTrustworthy()) {
    process.stderr.write('[cogwait] refusing to run chained statusline: config is not owner-only (chmod 600 ~/.cogwait/config.json)\n');
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
