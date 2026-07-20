#!/usr/bin/env node
'use strict';
// Cogwait single-line adapter — the sponsor surface for hosts that own exactly
// one row (tmux status-right, a starship custom module, a shell prompt segment).
// Prints ONE line to stdout, no trailing newline, so the host places it. Same
// cached-ad + viewable-impression contract as the Claude Code statusline; the
// only difference is the surface. Fast, non-blocking, silent on any failure.

const client = require('../lib/client');
const platforms = require('../lib/platforms');

process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });

// Nothing to show when the developer paused ads or picked level 0.
if (client.DISABLED || client.LEVEL <= 0) process.exit(0);

// One stable session tag per shell/pane so dedupe + daily caps work like they do
// for Claude Code (which supplies its own session_id).
const sessionId =
  process.env.COGWAIT_SESSION ||
  process.env.TERM_SESSION_ID ||
  ('host-' + (process.env.TMUX_PANE || process.ppid || 'shell'));

const host = platforms.detectHost(process.env);
const ad = client.getCachedAd(sessionId);

if (!ad) {
  // No ad cached yet — kick a detached refresh so the next prompt has one, and
  // render nothing this time (never block the prompt, never invent a line).
  Promise.resolve(client.refreshAd && client.refreshAd(sessionId)).catch(() => {});
  process.exit(0);
}

const line = platforms.renderForHost(host, ad, client.LEVEL);
if (!line) process.exit(0); // unsupported host → render nothing, bill nothing

process.stdout.write(line);

// The line rendered to a human → report a viewable impression (throttled inside
// the client, deduped + daily-capped server-side, detached, silent on failure).
client.reportImpression(sessionId, ad);
