# Cogwait — platform coverage

Where the sponsor line can render, and how. This matrix is intentionally honest:
a host is **supported** only when it exposes an *official, user-consented*
surface. We do **not** inject the line into any product that lacks one — that
would be unofficial modification of someone else's client, and we don't ship it.

Run it yourself:

```
node bin/platforms.js            # the matrix
node bin/platforms.js --detect   # the host detected right now
node bin/platforms.js --install <id>
```

| Host | Status | Surface |
|------|--------|---------|
| Claude Code (CLI) | **shipped** | `settings.json` `statusLine` command hook — the app's Install button wires it |
| tmux | **adapter-ready** | `status-right` `#(command)` — one line in `~/.tmux.conf` |
| Starship prompt | **adapter-ready** | `[custom.cogwait]` module running a command |
| Bash / Zsh prompt | **adapter-ready** | `precmd` / `PROMPT_COMMAND` segment |
| VS Code | **adapter-ready** | extension `StatusBarItem` — ships in [`ide/vscode`](../ide/vscode); `code --install-extension` |
| Cursor | **adapter-ready** | same VS Code extension (Cursor is a VS Code fork); `cursor --install-extension` |
| JetBrains IDEs | planned | plugin `StatusBarWidget` — source scaffolded in [`ide/jetbrains`](../ide/jetbrains), builds with `gradle buildPlugin` (not yet compiled here) |
| OpenAI Codex CLI | unsupported¹ | no surface of its own; covered by the terminal adapter around it |
| Zed | unsupported¹ | no third-party status-text API yet; integrated terminal still covered |

¹ **Covered at the terminal layer.** These tools have no ad surface of their own,
and we do not inject into them. But they run inside a terminal — so the tmux /
shell / starship adapter renders the Cogwait line *in your terminal furniture
around the tool*, which you configured and consented to. Detection makes the
terminal furniture win: "Codex inside tmux" renders in the tmux bar.

**Status meanings**

- **shipped** — the app / CLI sets it up for you.
- **adapter-ready** — the render binary exists (`bin/render-line.js`); add one line to the host's config.
- **planned** — an official surface exists, but the extension/plugin that uses it isn't built yet.
- **unsupported** — no official, consensual surface. Left blank rather than faked.

## adapter-ready install snippets

The single-line adapter prints one labeled sponsor line to stdout (no trailing
newline) and reports a viewable impression, using the same cached-ad, dedupe,
throttle and daily-cap path as the Claude Code statusline. Replace `PATH` with
your checkout.

**tmux** (`~/.tmux.conf`)

```
set -ag status-right '#(node PATH/bin/render-line.js)'
```

**Starship** (`starship.toml`)

```
[custom.cogwait]
command = "node PATH/bin/render-line.js"
when = true
```

**Zsh** (`~/.zshrc`)

```
precmd() { print -P "$(node PATH/bin/render-line.js)"; }
```

> Reference adapters. A shell prompt renders on every command, so the adapter
> leans on the client throttle + server-side dedupe/daily-cap to keep impressions
> honest; tune `COGWAIT_SESSION` if you want a coarser per-pane tag.

## Terminal-embedded tools (Codex, Superset, aider, any CLI agent)

Any AI tool that runs *in a terminal* is covered without touching the tool: the
tmux / shell / starship adapter renders the Cogwait line in the terminal chrome
around it. So "does it work with Codex?" — yes, at the terminal layer, the same
way a tmux status bar shows through whatever you run. We render in **your**
terminal, not inside someone else's app.

## Why some hosts stay unsupported (and what we won't do)

Codex and Zed expose no official way for a third party to render text into their
own chrome. The honest paths are: (a) an *extension* using the host's public
status-bar API — the VS Code / JetBrains / Cursor "planned" rows, consensual and
user-installed; (b) the terminal furniture around the tool; or (c) nothing.

What we will **not** do, regardless of how the ask is phrased, is covertly patch
another vendor's client to display ads. That is adware and violates those
platforms' terms and their users' expectations. "Works on all platforms" means
every surface that offers a consensual mechanism — not injecting where none
exists.

## Unrecognized targets

If a requested target isn't in the matrix (or the name is ambiguous), it falls
into one of two honest buckets: it's a **terminal tool** → covered by the
terminal adapter, or it's a **GUI app** → needs an official extension API and a
shipped extension, or it stays unsupported. We don't fabricate an integration for
a surface we can't reach consensually.
