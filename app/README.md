# Sponsoric Desktop

A native control panel that ties the whole Sponsoric toolchain into one window —
built with Tauri (Rust) + a vanilla-TS frontend.

It is a **companion**, not the ad surface. The sponsor line renders in Claude
Code's status row via the CLI status-line hook; a desktop window can't inject
there. This app manages everything around it:

- **Status** — health checks (same as `npx sponsoric --doctor`), a live preview
  of the sponsor line, and one-click install / uninstall of the status line.
- **Earnings** — balance, impressions, payout history, request payout, Connect
  Stripe. The publisher key is held Rust-side and sent only to your API base.
- **Ad level** — pick tier 0–3 with a live preview and the CPM / per-impression
  math (Minimal $8 · Standard $18 · Boosted $35 gross CPM, you keep 70%).
- **Setup** — payout id, API base, register (get key), pause, mock mode, CLI path.
- **About** — the honest framing: earnings are demand-gated, coffee money.

Everything reads/writes the same files the CLI uses (`~/.sponsoric/config.json`
owner-only 0600, `~/.claude/settings.json`) and mirrors `lib/levels.js` and
`bin/statusline.js`, so the GUI and CLI stay in sync.

## Develop

```bash
cd app
npm install
npm run tauri dev      # compiles the Rust backend + opens the window
```

## Build a distributable

```bash
npm run tauri build    # produces a .app / .dmg under src-tauri/target/release/bundle
```

Requires the Rust toolchain and (macOS) Xcode command-line tools for WebKit.
The status-line install button wires in the repo's `bin/statusline.js`; point it
at that path in **Setup** if auto-detection can't find it.
