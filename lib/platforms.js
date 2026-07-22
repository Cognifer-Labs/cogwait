'use strict';
// Cogwait platform matrix — where the sponsor line can render, and how.
//
// Honesty rule: a host is only "supported" when it exposes an OFFICIAL,
// user-consented extensibility surface (a statusline command, a prompt segment,
// an extension's own status-bar item). We never inject into a product that has
// no such surface — that would be unofficial modification of someone else's
// client, and we don't ship it. Those hosts are listed as `unsupported` with the
// reason, so the matrix tells the truth instead of implying coverage we can't
// deliver.
//
// status:
//   shipped        — the app/CLI wires this up for you today
//   adapter-ready  — the render binary exists; add one line to the host's config
//   planned        — an official surface exists, the adapter isn't built yet
//   unsupported    — no official surface; we will not inject unofficially
//
// rows: 'multi'  — the host lets us print our own block (full level rendering)
//       'inline' — the host owns one row; we render a single-line variant

const PLATFORMS = [
  {
    id: 'claude-code', label: 'Claude Code (CLI)', status: 'shipped', rows: 'multi',
    mechanism: 'settings.json statusLine command hook',
    detect: (e) => !!(e.CLAUDECODE || e.CLAUDE_CODE || e.CLAUDE_CODE_ENTRYPOINT),
    install: 'Handled by the Cogwait app (Install button) or `npx cogwait --setup`.',
  },
  {
    id: 'tmux', label: 'tmux', status: 'adapter-ready', rows: 'inline',
    mechanism: 'status-right `#(command)` interpolation',
    detect: (e) => !!e.TMUX,
    install: "set -ag status-right '#(node PATH/bin/render-line.js)'   # in ~/.tmux.conf",
  },
  {
    id: 'starship', label: 'Starship prompt', status: 'adapter-ready', rows: 'inline',
    mechanism: 'custom module running a command',
    detect: (e) => !!e.STARSHIP_SESSION_KEY,
    install: '[custom.cogwait]\ncommand = "node PATH/bin/render-line.js"\nwhen = true   # in starship.toml',
  },
  {
    id: 'shell-prompt', label: 'Bash / Zsh prompt', status: 'adapter-ready', rows: 'inline',
    mechanism: 'precmd / PROMPT_COMMAND hook',
    detect: (e) => !!e.SHELL, // weak signal; real detection is "nothing more specific matched"
    install: "precmd() { COGWAIT_LINE=$(node PATH/bin/render-line.js); print -P \"$COGWAIT_LINE\"; }   # ~/.zshrc",
  },
  {
    id: 'vscode', label: 'VS Code', status: 'adapter-ready', rows: 'inline', surface: 'extension',
    mechanism: 'extension StatusBarItem (official API) — ships in ide/vscode',
    detect: (e) => e.TERM_PROGRAM === 'vscode' && !e.__CURSOR__,
    install: 'Install the Cogwait extension: `cd ide/vscode && npx @vscode/vsce package && code --install-extension cogwait-vscode-*.vsix` (or press F5 to run it in dev). Renders in its own status-bar item — no editor injection.',
  },
  {
    id: 'jetbrains', label: 'JetBrains IDEs', status: 'planned', rows: 'inline', surface: 'extension',
    mechanism: 'plugin StatusBarWidget (official API) — source scaffolded in ide/jetbrains',
    detect: (e) => !!e.TERMINAL_EMULATOR && /JetBrains/i.test(e.TERMINAL_EMULATOR),
    install: 'Plugin source is scaffolded in ide/jetbrains (official StatusBarWidget API). Build + install: `cd ide/jetbrains && gradle buildPlugin`, then load the zip via Settings → Plugins → Install from Disk. Not compiled in this environment yet — still `planned` until a verified build.',
  },
  {
    id: 'cursor', label: 'Cursor', status: 'adapter-ready', rows: 'inline', surface: 'extension',
    mechanism: 'VS Code extension StatusBarItem — Cursor is a VS Code fork and runs the same extension',
    detect: (e) => !!e.__CURSOR__ || e.COGWAIT_HOST === 'cursor',
    install: 'Install the same Cogwait extension: `cd ide/vscode && npx @vscode/vsce package && cursor --install-extension cogwait-vscode-*.vsix`. Official status-bar API, user-installed — no editor injection.',
  },
  {
    // Codex has no surface of its OWN, but it runs in a terminal — so the tmux /
    // shell / starship adapters render the line in the terminal furniture around
    // it. That is consensual (the user configured their own terminal) and needs
    // no modification of Codex itself. `terminalCovered` marks that path.
    id: 'codex', label: 'OpenAI Codex CLI', status: 'unsupported', rows: 'inline',
    mechanism: null, terminalCovered: true,
    detect: (e) => !!e.CODEX_SANDBOX || e.COGWAIT_HOST === 'codex',
    install: 'No official surface inside Codex — and we do not inject into it. But run it under tmux / a shell prompt and the terminal adapter shows the Cogwait line around it (see tmux / shell-prompt).',
  },
  {
    id: 'zed', label: 'Zed', status: 'unsupported', rows: 'inline',
    mechanism: null, terminalCovered: true,
    detect: (e) => e.TERM_PROGRAM === 'zed',
    install: 'No official third-party status-bar text surface for Zed extensions today — not injecting unofficially. Its integrated terminal is still covered by the shell adapter. Becomes `planned` if/when Zed exposes a status API.',
  },
  {
    // "superset" is a terminal / CLI tool (per the project owner). Like any
    // terminal-based tool it has no ad surface of its own, but the tmux / shell /
    // starship adapter renders the line in the terminal furniture around it —
    // consensual, no modification of the tool itself.
    id: 'superset', label: 'Superset (CLI tool)', status: 'unsupported', rows: 'inline',
    mechanism: null, terminalCovered: true,
    detect: (e) => e.COGWAIT_HOST === 'superset',
    install: 'A terminal/CLI tool — no surface of its own, and we do not inject into it. Run it under tmux / a shell prompt and the terminal adapter shows the Cogwait line around it (see tmux / shell-prompt).',
  },
  {
    // Catch-all so any named-but-unknown target ("among other things") resolves
    // to an honest classification instead of vanishing from the matrix.
    id: 'other', label: 'Other / unrecognized target', status: 'unsupported', rows: 'inline',
    mechanism: null,
    detect: () => false, // never auto-detected; reached only via COGWAIT_HOST=other
    install: 'Unknown surface. Terminal-based tools are covered by the tmux/shell/starship adapters; GUI apps need an official extension API + a shipped extension; anything else has no consensual surface and stays unsupported. We do not inject where no surface exists.',
  },
];

const byId = (id) => PLATFORMS.find((p) => p.id === id) || null;

// Best-effort host detection from the environment. Order matters: specific
// signals win, and a bare shell is the last resort (never claims more than it is).
function detectHost(env) {
  const e = env || process.env;
  const forced = e.COGWAIT_HOST && byId(e.COGWAIT_HOST);
  if (forced) return forced.id;
  // Terminal furniture (tmux / starship) wins over the app running inside the
  // pane — so "Codex/Cursor inside tmux" renders in the tmux bar, which is the
  // consensual surface, instead of resolving to a host with no surface.
  const order = ['claude-code', 'tmux', 'starship', 'vscode', 'jetbrains', 'cursor', 'codex', 'zed', 'shell-prompt'];
  for (const id of order) {
    const p = byId(id);
    if (p && p.detect(e)) return id;
  }
  return 'shell-prompt';
}

// Render an ad for a given host, honoring its row model. Returns null for hosts
// with no surface — the caller must render nothing rather than invent a row.
function renderForHost(hostId, ad, level) {
  const p = byId(hostId);
  // Only hosts with a real runtime adapter render. `planned` (extension exists
  // in principle but isn't built) and `unsupported` (no consensual surface) both
  // render nothing rather than invent a line.
  if (!p || (p.status !== 'shipped' && p.status !== 'adapter-ready')) return null;
  // Extension surfaces (VS Code / Cursor) render in-process via their own
  // StatusBarItem + renderPlain — not through this ANSI/terminal path.
  if (p.surface === 'extension') return null;
  const { renderAd, renderInline } = require('./render');
  return p.rows === 'multi' ? renderAd(ad, level) : renderInline(ad, level);
}

// Render the unpaid AI-news fallback for a given host. Same surface gating as
// renderForHost (no invented rows, extensions render in-process), but the news
// line is always the minimal single-line treatment — nobody pays for this slot.
function renderNewsForHost(hostId, item) {
  const p = byId(hostId);
  if (!p || (p.status !== 'shipped' && p.status !== 'adapter-ready')) return null;
  if (p.surface === 'extension') return null;
  const { renderNews } = require('./render');
  return renderNews(item);
}

module.exports = { PLATFORMS, byId, detectHost, renderForHost, renderNewsForHost };
