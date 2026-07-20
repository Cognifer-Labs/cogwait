#!/usr/bin/env node
'use strict';
// Cross-platform surface tests — the level model, the shared renderer, and the
// honest platform matrix (supported hosts render; unsupported hosts render null).

const platforms = require('../lib/platforms');
const render = require('../lib/render');
const levels = require('../lib/levels');

let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Cogwait cross-platform test');

const ad = { text: 'Example Co — a real dev tool', url: 'https://example.com' };

// 1. New intrusive tiers exist and are ordered by CPM.
{
  assert(levels.MAX_LEVEL === 5, 'MAX_LEVEL is 5 (banner + takeover added)');
  const cpms = levels.LEVELS.map((l) => l.cpm);
  const monotonic = cpms.every((c, i) => i === 0 || c >= cpms[i - 1]);
  assert(monotonic, 'CPM is non-decreasing across levels');
  assert(levels.clampLevel(99) === 5 && levels.clampLevel(-5) === 0, 'clampLevel bounds to [0,5]');
}

// 2. Every level stays labeled [sponsor] / SPONSOR — no unlabeled ad, at any tier.
{
  for (let lvl = 1; lvl <= 5; lvl++) {
    const out = render.renderAd(ad, lvl);
    assert(/\[sponsor\]|SPONSOR/i.test(out), `level ${lvl} block is labeled as sponsored`);
  }
  for (let lvl = 1; lvl <= 5; lvl++) {
    const out = render.renderInline(ad, lvl);
    assert(/\[sponsor\]/i.test(out) && !out.includes('\n'), `level ${lvl} inline is labeled and single-line`);
  }
}

// 3. Takeover (L5) is multi-line; minimal (L1) is one line.
{
  assert(render.renderAd(ad, 5).split('\n').length >= 4, 'L5 takeover spans multiple rows');
  assert(render.renderAd(ad, 1).split('\n').length === 1, 'L1 minimal is a single row');
}

// 4. Matrix honesty: only hosts with a real adapter render; planned + unsupported
//    render nothing (no covert injection, no faked coverage).
{
  const shipped = ['claude-code', 'tmux', 'starship', 'shell-prompt'];
  for (const id of shipped) {
    assert(platforms.renderForHost(id, ad, 2) !== null, `${id} renders a sponsor line`);
  }
  // Codex / Zed: no consensual surface of their own — render nothing.
  for (const id of ['codex', 'zed']) {
    assert(platforms.renderForHost(id, ad, 2) === null, `${id} renders nothing (no covert injection)`);
    const p = platforms.byId(id);
    assert(p.status === 'unsupported' && !p.mechanism, `${id} is honestly marked unsupported`);
    assert(p.terminalCovered === true, `${id} is reachable via the terminal furniture adapter`);
  }
  // VS Code + Cursor: adapter-ready via the shipped extension (ide/vscode). They
  // render in-process through their own StatusBarItem, so renderForHost — the
  // terminal ANSI path — returns null for them (no faked terminal line).
  for (const id of ['vscode', 'cursor']) {
    const p = platforms.byId(id);
    assert(p.status === 'adapter-ready' && p.surface === 'extension' && !!p.mechanism,
      `${id} is adapter-ready via the official extension StatusBarItem`);
    assert(platforms.renderForHost(id, ad, 2) === null, `${id} renders via its extension, not the terminal path`);
  }
  // 'superset' and 'other' are addressed explicitly, not omitted.
  for (const id of ['superset', 'other']) {
    const p = platforms.byId(id);
    assert(p && p.status === 'unsupported', `${id} is present and honestly unsupported`);
  }
  // superset is a CLI tool → covered by the terminal furniture adapter.
  assert(platforms.byId('superset').terminalCovered === true, 'superset (CLI tool) is terminal-covered');
}

// 4b. The plain-text (extension) renderer is labeled and single-line at every tier.
{
  for (let lvl = 1; lvl <= 5; lvl++) {
    const out = render.renderPlain(ad, lvl);
    assert(/\[sponsor\]/i.test(out) && !out.includes('\n'), `renderPlain L${lvl} is labeled and single-line`);
  }
}

// 5. Detection: override wins; Claude Code beats everything; terminal furniture
//    (tmux) beats the app running inside it, so Codex-in-tmux renders.
{
  assert(platforms.detectHost({ COGWAIT_HOST: 'tmux' }) === 'tmux', 'COGWAIT_HOST override wins');
  assert(platforms.detectHost({ CLAUDECODE: '1', TMUX: 'x' }) === 'claude-code', 'Claude Code beats tmux');
  assert(platforms.detectHost({ TMUX: '/tmp/t' }) === 'tmux', 'tmux detected via $TMUX');
  assert(platforms.detectHost({ CODEX_SANDBOX: '1', TMUX: '/tmp/t' }) === 'tmux', 'Codex inside tmux resolves to tmux (renders)');
  assert(platforms.renderForHost(platforms.detectHost({ CODEX_SANDBOX: '1', TMUX: '/tmp/t' }), ad, 2) !== null, 'Codex-in-tmux actually renders a line');
  assert(platforms.detectHost({ CODEX_SANDBOX: '1' }) === 'codex', 'bare Codex (no furniture) resolves to codex');
  assert(platforms.detectHost({}) === 'shell-prompt', 'bare env falls back to shell-prompt');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall cross-platform checks passed');
process.exit(failed ? 1 : 0);
