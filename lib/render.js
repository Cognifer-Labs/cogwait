'use strict';
// Shared sponsor-line renderer — the single ANSI implementation used by every
// host adapter (Claude Code statusline, tmux, shell prompt, …). Keeping it here
// means one honest rendering of each level regardless of surface.
//
// Every level stays labeled `[sponsor]` and viewable-only. Higher levels are
// more prominent (and pay more) — the developer opts into that trade.

const A = {
  DIM: '\x1b[2m', CYAN: '\x1b[36m', BOLD: '\x1b[1m', YELLOW: '\x1b[33m',
  MAGENTA: '\x1b[35m', RESET: '\x1b[0m', INV: '\x1b[7m', BLINK: '\x1b[5m',
};
const osc8 = (url, s) => (url ? `\x1b]8;;${url}\x07${s}\x1b]8;;\x07` : s);

// Full, multi-line rendering (surfaces that allow their own rows: Claude Code
// statusLine, Zed, anything that prints a block).
function renderAd(ad, level) {
  const { DIM, CYAN, BOLD, YELLOW, MAGENTA, RESET, INV, BLINK } = A;
  const link = (s) => osc8(ad.url, s);

  if (level >= 5) {
    const inner = ` ${ad.text} `;
    const bar = '─'.repeat(Math.min(inner.length, 72));
    const cta = ad.url ? link(`${YELLOW}▶ ${ad.url} ›${RESET}`) : `${DIM}sponsored${RESET}`;
    return [
      `${MAGENTA}┌${bar}┐${RESET}`,
      `${MAGENTA}│${RESET} ${BLINK}${MAGENTA}●${RESET} ${BOLD}[sponsor]${RESET}`,
      `${MAGENTA}│${RESET} ${BOLD}${ad.text}${RESET}`,
      `${MAGENTA}│${RESET} ${cta}`,
      `${MAGENTA}└${bar}┘${RESET}`,
    ].join('\n');
  }
  if (level >= 4) {
    const bar = `${INV}${BOLD} ★ [sponsor] ${RESET}${INV} ${ad.text} ${RESET}`;
    const cta = ad.url ? link(`${YELLOW}▶ ${ad.url} ›${RESET}`) : `${DIM}sponsored${RESET}`;
    return `${bar}\n         ${cta}`;
  }
  if (level >= 3) {
    const label = `${MAGENTA}${BOLD}◆ SPONSOR${RESET}`;
    const head = `${BOLD}${ad.text}${RESET}`;
    const cta = ad.url ? link(`${YELLOW}${ad.url} ›${RESET}`) : `${DIM}sponsored${RESET}`;
    return `${label}  ${head}\n         ${cta}`;
  }
  if (level >= 2) {
    const label = `${YELLOW}${BOLD}▸ [sponsor]${RESET}`;
    const text = `${CYAN}${ad.text}${RESET}`;
    return `${label} ${link(text)}${ad.url ? ` ${YELLOW}›${RESET}` : ''}`;
  }
  const label = `${CYAN}[sponsor]${RESET}`;
  const text = `${DIM}${ad.text}${RESET}`;
  return ad.url ? `${label} ${link(`${text} ›`)}` : `${label} ${text}`;
}

// Single-row rendering for surfaces that only own one line (tmux status-right,
// a shell prompt segment, a starship custom module). Prominence still scales
// with level via color/weight, but it never emits extra rows it doesn't own.
function renderInline(ad, level) {
  const { DIM, CYAN, BOLD, YELLOW, MAGENTA, RESET, INV } = A;
  const link = (s) => osc8(ad.url, s);
  const tail = ad.url ? ` ${YELLOW}›${RESET}` : '';
  if (level >= 4) return `${INV}${BOLD} ★ [sponsor] ${RESET} ${link(`${BOLD}${ad.text}${RESET}`)}${tail}`;
  if (level >= 3) return `${MAGENTA}${BOLD}◆ [sponsor]${RESET} ${link(`${BOLD}${ad.text}${RESET}`)}${tail}`;
  if (level >= 2) return `${YELLOW}${BOLD}▸ [sponsor]${RESET} ${link(`${CYAN}${ad.text}${RESET}`)}${tail}`;
  return `${CYAN}[sponsor]${RESET} ${link(`${DIM}${ad.text}${RESET}`)}${tail}`;
}

// Plain-text rendering (no ANSI) for GUI status surfaces — a VS Code / Cursor
// extension's own StatusBarItem, where the host controls color and the label is
// plain text + optional codicon. Still labeled [sponsor]; prominence shows via a
// leading marker since we can't set color there.
function renderPlain(ad, level) {
  const mark = level >= 4 ? '★ ' : level >= 3 ? '◆ ' : level >= 2 ? '▸ ' : '';
  const tail = ad.url ? ' ›' : '';
  return `${mark}[sponsor] ${ad.text}${tail}`;
}

module.exports = { renderAd, renderInline, renderPlain };
