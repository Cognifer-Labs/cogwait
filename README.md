# Cogwait

**Earn revenue while your AI thinks.** Cogwait renders one opt-in, clearly labeled sponsor line in the Claude Code status row while you work, and shares ad revenue with you. It **never reads your code, files, prompts, or environment** — the only thing that leaves your machine is an anonymized session tag, the ad id, and a timestamp.

Same model as [IdleDev](https://idledev.xyz), [idlepay](https://www.idlepay.co), [Idlen](https://www.idlen.io), and [Kickbacks AI](https://kickbacksai.org): a labeled status-line placement, opt-in, no interruptions, revenue share. Impressions count **only when the line is actually rendered to a human** — no phantom impressions.

## Install

```bash
# 1. Configure the status-line ad surface (writes to ~/.claude/settings.json, non-destructive)
npx cogwait

# 2. Set your payout id
export COGWAIT_PAYOUT_ID="your-id"      # add to ~/.zshrc / ~/.bashrc to persist

# 3. Register to get your publisher key (needed to authenticate earnings)
npx cogwait --register                  # saves publisher_key to ~/.cogwait/config.json (0600)

# 4. Restart Claude Code and accept the workspace-trust prompt
```

Try it with **no backend** first:

```bash
COGWAIT_MOCK=1 npx cogwait      # serves rotating local demo ads; nothing is sent
```

### Also installable as a plugin

The repo is a valid Claude Code plugin (`.claude-plugin/plugin.json`), so it can be added from a marketplace:

```
/plugin marketplace add cognifer-labs/cogwait
```

The **status line** is still configured by `npx cogwait`, because a plugin's bundled `settings.json` cannot set the main `statusLine` (only `agent` / `subagentStatusLine` are supported by Claude Code).

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
| `lib/client.js` | Talks to the Cogwait API. Enforces the privacy rules below. |
| `bin/setup.js` | Injects/removes the `statusLine` entry in `~/.claude/settings.json`. |

The status line re-runs after every assistant message plus every `refreshInterval` (5s), and runs locally with **zero API-token cost**.

## Privacy

- **No payload.** Prompt text, code, file contents, env vars, and secrets are never transmitted. Hook stdin is read only to extract the session id, then discarded.
- **Anonymized session.** The raw Claude Code session id never leaves the machine — only a truncated SHA-256 tag.
- **Viewable-only billing.** An impression is reported solely after the sponsor line was rendered, throttled to once per session per 15s.
- **No manufactured delay.** Cogwait never slows your terminal or the model to serve more ads. All network calls are detached with hard timeouts.
- **Auditable.** All bridging logic is in `lib/client.js` and the `bin/` scripts — read every outbound call.
- **AI-news fallback.** When no ad is available, the slot shows a recent AI-news headline instead. It's unpaid and never labeled `[sponsor]`, no impression is reported, and the fetch (Hacker News/Algolia) is fully anonymous — no publisher id, session tag, or auth header. Opt out with `COGWAIT_NEWS=0`.

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
| **4 · Banner** | full-width inverse-video banner bar | $60 | $0.042 / impression |
| **5 · Takeover** | bordered multi-line block with a blinking marker | $90 | $0.063 / impression |

```bash
npx cogwait --level 2        # or: export COGWAIT_LEVEL=2
```

CPMs are benchmarked to real developer-audience sponsorship rates (dev
newsletters/podcasts and ethical dev ad networks run ~$10–40 CPM for a
qualified, in-context, provably-viewed placement). Every rate is env-overridable
(`COGWAIT_CPM_L1` … `COGWAIT_CPM_L5`) so the network operator sets the live economics.
Earnings still depend on real advertiser demand — see **Status** below.

## Commands

Every flag `npx cogwait` accepts. Run `npx cogwait --help` for the same list.

| Command | What it does |
| --- | --- |
| `npx cogwait` | Install the status line into `~/.claude/settings.json` (non-destructive). |
| `npx cogwait --help` / `-h` | Print the flag list and exit. Touches nothing. |
| `npx cogwait --version` | Print the installed Cogwait version. |
| `npx cogwait --status` | Read-only summary: ad level + CPM tier, give-back %, payout id, whether a publisher key is present (never the key itself), API base, mock/disabled/chained state, and whether the status line is actually wired in. Works before anything is configured; makes no network call. |
| `npx cogwait --doctor` | Same checks, plus a live ping of the backend. Exits non-zero on hard problems. |
| `npx cogwait --register` | Register with the backend and store your publisher key (0600) in `~/.cogwait/config.json`. |
| `npx cogwait --level <0-5>` | Set the ad tier — see the table above. |
| `npx cogwait --earnings` | Balance, lifetime, impressions, effective net CPM, distance to the minimum payout, and recent payouts. |
| `npx cogwait --cashout` | Request a payout. Prints the amount and the you/give-back split and requires a typed `y` before sending; `--yes` skips the prompt for scripts. |
| `npx cogwait --oss` | Scan this project's dependencies **locally** and print a maintainer give-back receipt. Nothing about your dependencies is ever transmitted. |
| `npx cogwait --donate <pct>` | Set the Fund-OSS give-back percentage (0-100, server-clamped). |
| `npx cogwait --connect` | Link a bank account or card for cash-outs via Stripe Connect. |
| `npx cogwait --paypal <email>` | Use PayPal as the cash-out rail instead. |
| `npx cogwait --chain` | Keep an existing `statusLine` — yours renders first, the sponsor line below it. |
| `npx cogwait --uninstall` | Remove the Cogwait `statusLine`. Leaves your other settings alone. |

| Environment | Effect |
| --- | --- |
| `COGWAIT_DISABLED=1` | Pause rendering and billing. |
| `COGWAIT_MOCK=1` | Local demo ads; nothing leaves the machine. |
| `COGWAIT_NEWS=0` | Turn off the AI-news fallback line (shown only when no ad is available). |
| `COGWAIT_API` | Point at a different backend. |
| `COGWAIT_LEVEL` | Override the ad tier for one run. |
| `COGWAIT_PAYOUT_ID` | Your publisher id. |

Cogwait keeps its state in `~/.cogwait/` (owner-only). Per-session cache and
timestamp files there are swept automatically once they are two days stale;
`config.json` and `oss-receipt.json` are never touched.

## Backend contract (for the Cogwait network)

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

Proof of concept. The client works end-to-end in `COGWAIT_MOCK=1` mode today. Live earnings require the Cogwait backend (or any server implementing the contract above) and a real advertiser paying for the placement.

Run the smoke test: `npm test`.

## License

MIT © Cognifer Labs LLC
