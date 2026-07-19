# PRD: Sponsoric — Honest Wait-Time Sponsorship for Claude Code

**Owner:** Cognifer Labs LLC · **Target:** Q3 2026 · **Persona:** Claude Code CLI developers

## 1. Summary
Sponsoric monetizes developer wait time by rendering a **visible, labeled sponsor line** in Claude Code while the agent works, then sharing ad revenue with the developer. Impressions count **only when actually shown to a human** — no phantom impressions, no hidden calls. Distributed as a Claude Code plugin.

## 2. Non-Negotiable Principle
An impression is billable **only if a human saw the ad.** The surface must be visible. Anything invisible is impression fraud and is out of scope.

## 3. Architecture (verified against Claude Code docs)
Two native primitives — no MCP required for the core loop:

- **Statusline (the ad surface).** A shell script set via `statusLine` in `.claude/settings.json`. Claude Code pipes session JSON to stdin and renders whatever it prints — supports ANSI color, multi-line, and clickable OSC-8 links. Re-runs after every assistant message plus a `refreshInterval` (min 1s) timer. Runs locally, consumes no API tokens. This is the real, viewable placement: `[sponsor] <message> ›`.
- **Hooks (impression timing).** `UserPromptSubmit` marks wait start; `Stop` fires when Claude finishes responding; `Notification`/`idle_prompt` marks idle. An `http`-type hook POSTs event JSON directly to the Sponsoric backend — no local relay needed.
- **Optional MCP server:** only as an ad-fetch/caching backend. Correction vs. prior spec: MCP **cannot** observe generation state, so it is not the eventing mechanism.

## 4. Sponsoric API
- `POST /session/init` — verify `SPONSORIC_PAYOUT_ID`, return session token.
- `GET /ad/next` — statusline fetches the current sponsor line (cached locally, ~5s).
- `POST /impression` — sent **only after** the line rendered; body = `{session, publisher_id, shown_ms, ts}`.

## 5. User Flow
1. `/plugin marketplace add cognifer-labs/sponsoric` installs statusline + hooks.
2. Developer sets `SPONSORIC_PAYOUT_ID` and accepts the workspace-trust prompt (required for statusline/hooks to run).
3. During work, a labeled `[sponsor]` line shows in the status row. `--no-ads` / a config flag disables it.
4. Backend counts viewable impressions, matches dev-focused ads, credits payout via Stripe/USDC.

## 6. Privacy & Trust
- **No payload:** prompt text and code are never transmitted. Hooks receive prompt data but the script forwards only anonymized `session_id`, timestamps, and publisher ID.
- **Opt-in + visible + labeled:** ads always marked `[sponsor]`; easy off-switch; count only rendered impressions.
- **Open source:** bridging logic public on GitHub for audit of every network call.

## 7. Go-To-Market
1. **PoC:** local `--plugin-dir` run; confirm rendered-impression settlement.
2. **OSS release** under Cognifer Labs on GitHub.
3. **Marketplace submission** to the community plugin registry.
4. **Growth:** launch on X/HN as honest, opt-in, revenue-shared terminal sponsorship.

## 8. Open Risks
- **Ad-network demand:** does a real advertiser pay for a one-line terminal text placement? Economics unproven — validate before scale.
- **Marketplace policy:** Anthropic may restrict monetization/ad plugins; confirm acceptance early.
- **"Sponsoric" backend:** must exist as a real network with viewable-ad inventory, or Cognifer builds it. Not assumed.

## 9. Success Criteria
Sponsor line renders reliably, only rendered impressions bill, zero prompt/code leakage (audit-verified), plugin installs cleanly from the marketplace.
