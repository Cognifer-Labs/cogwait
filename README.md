# Sponsoric

**Earn revenue while your AI thinks.** Sponsoric renders one opt-in, clearly labeled sponsor line in the Claude Code status row while you work, and shares ad revenue with you. It **never reads your code, files, prompts, or environment** — the only thing that leaves your machine is an anonymized session tag, the ad id, and a timestamp.

Same model as [IdleDev](https://idledev.xyz), [idlepay](https://www.idlepay.co), [Idlen](https://www.idlen.io), and [Kickbacks AI](https://kickbacksai.org): a labeled status-line placement, opt-in, no interruptions, revenue share. Impressions count **only when the line is actually rendered to a human** — no phantom impressions.

## Install

```bash
# 1. Configure the status-line ad surface (writes to ~/.claude/settings.json, non-destructive)
npx sponsoric

# 2. Set your payout id
export SPONSORIC_PAYOUT_ID="your-id"      # add to ~/.zshrc / ~/.bashrc to persist

# 3. Register to get your publisher key (needed to authenticate earnings)
npx sponsoric --register                  # saves publisher_key to ~/.sponsoric/config.json (0600)

# 4. Restart Claude Code and accept the workspace-trust prompt
```

Try it with **no backend** first:

```bash
SPONSORIC_MOCK=1 npx sponsoric      # serves rotating local demo ads; nothing is sent
```

### Also installable as a plugin

The repo is a valid Claude Code plugin (`.claude-plugin/plugin.json` + `hooks/hooks.json`), so it can be added from a marketplace:

```
/plugin marketplace add cognifer-labs/sponsoric
```

The plugin ships the wait-timing hooks. The **status line** is still configured by `npx sponsoric`, because a plugin's bundled `settings.json` cannot set the main `statusLine` (only `agent` / `subagentStatusLine` are supported by Claude Code).

### Desktop app (optional GUI)

A native control panel in [`app/`](app/) (Tauri + Rust) unifies install, ad level,
earnings, and payouts in one window. It's a **companion**, not the ad surface —
the status line stays the earning mechanism; the app just manages it, with your
publisher key held on the Rust side.

```bash
cd app && npm install && npm run tauri dev      # run it
cd app && npm run tauri build                    # build a .app / .dmg
```

## How it works

| Piece | Role |
| --- | --- |
| `bin/statusline.js` | The visible ad surface. Reads a locally cached ad, prints `[sponsor] …`, reports a viewable impression **only because it rendered**. |
| `bin/refresh-ad.js` | Detached fetcher that keeps the ad cache warm so the status line never blocks on the network. |
| `hooks/hooks.json` | `UserPromptSubmit` / `Stop` hooks record local wait-start/end timestamps to size visible duration. |
| `lib/client.js` | Talks to the Sponsoric API. Enforces the privacy rules below. |
| `bin/setup.js` | Injects/removes the `statusLine` entry in `~/.claude/settings.json`. |

The status line re-runs after every assistant message plus every `refreshInterval` (5s), and runs locally with **zero API-token cost**.

## Privacy

- **No payload.** Prompt text, code, file contents, env vars, and secrets are never transmitted. Hook stdin is read only to extract the session id, then discarded.
- **Anonymized session.** The raw Claude Code session id never leaves the machine — only a truncated SHA-256 tag.
- **Viewable-only billing.** An impression is reported solely after the sponsor line was rendered, throttled to once per session per 15s.
- **No manufactured delay.** Sponsoric never slows your terminal or the model to serve more ads. All network calls are detached with hard timeouts.
- **Auditable.** All bridging logic is in `lib/client.js` and the `bin/` scripts — read every outbound call.

## Ad levels — trade prominence for pay

You choose how visible the sponsor line is. A more prominent placement earns a
higher CPM, so **you** decide the trade between attention and revenue. Every
level is opt-in, labeled `[sponsor]`, and billed viewable-only — the level only
changes how the line *looks*, never whether it's honest. Default is **Minimal**.

| Level | Placement | Gross CPM | You keep (70%) |
| --- | --- | --- | --- |
| **0 · Off** | nothing renders | — | — |
| **1 · Minimal** (default) | one dim single line | $8 | $0.0056 / impression |
| **2 · Standard** | one bright colored line + icon + CTA | $18 | $0.0126 / impression |
| **3 · Boosted** | two-line boxed sponsor block | $35 | $0.0245 / impression |

```bash
npx sponsoric --level 2        # or: export SPONSORIC_LEVEL=2
```

CPMs are benchmarked to real developer-audience sponsorship rates (dev
newsletters/podcasts and ethical dev ad networks run ~$10–40 CPM for a
qualified, in-context, provably-viewed placement). Every rate is env-overridable
(`SPONSORIC_CPM_L1/L2/L3`) so the network operator sets the live economics.
Earnings still depend on real advertiser demand — see **Status** below.

## Controls

| Action | How |
| --- | --- |
| Change ad level | `npx sponsoric --level 2` (or `SPONSORIC_LEVEL=2`) |
| Pause ads | `export SPONSORIC_DISABLED=1` |
| Remove the status line | `npx sponsoric --uninstall` |
| Point at a different backend | `export SPONSORIC_API="https://…"` |
| Local demo mode (no network) | `export SPONSORIC_MOCK=1` |

## Backend contract (for the Sponsoric network)

- `POST /session/init` ← `{ publisher_id }` → registers and returns `{ secret }` once (your publisher key)
- `GET /ad/next?tag=<session_tag>` → `{ "id": "…", "text": "…", "url": "…" }` (public)
- `POST /impression` ← `{ session_tag, ad_id, shown_ms, ts, surface, level }` (**authenticated**; the server clamps `level` to a valid tier and prices it from its own CPM table — a client can't invent a payout)
- `GET /earnings` → your ledger (**authenticated**, scoped to you)
- `POST /connect/onboard` → Stripe Connect onboarding link (**authenticated**; simulated without a Stripe key)
- `POST /payout` → pays your balance to your server-side connected account (**authenticated**)
- `POST /campaign`, `GET /campaign/stats` → advertiser campaign create + spend view (**admin token**)

Deploy: self-host (`node server/index.js` / Docker) or Vercel via `api/index.js` +
`vercel.json`. See `docs/DEPLOY.md` — production requires swapping the JSON store
for Postgres and moving rate-limit/dedupe state to a shared store.

Auth on protected endpoints: `Authorization: Publisher <payout_id>:<publisher_key>`. The
publisher id in a request body/query is **ignored** for scoping — identity comes from the
key. Campaign creation requires a separate admin token (`x-admin-token`).

## Status

Proof of concept. The client works end-to-end in `SPONSORIC_MOCK=1` mode today. Live earnings require the Sponsoric backend (or any server implementing the contract above) and a real advertiser paying for the placement.

Run the smoke test: `npm test`.

## License

MIT © Cognifer Labs LLC
