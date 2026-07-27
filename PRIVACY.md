# Cogwait Privacy Policy

_Last updated: 2026-07-17 · PoC draft — have counsel review before production._

Cogwait is built so that **your code, prompts, files, and secrets never leave
your machine.** This document states exactly what is and isn't collected.

## What is NEVER collected or transmitted

- Prompt text or Claude's responses
- Source code, file contents, or file paths
- Environment variables, API keys, or secrets
- The raw Claude Code session id
- Keystrokes, terminal output, or screen contents

See `lib/client.js` — every outbound call is auditable.

## What IS transmitted, and only to report a viewable ad impression

| Field | Purpose |
| --- | --- |
| `publisher_id` | Credit your earnings |
| `session_tag` | Truncated, one-way SHA-256 hash of the session id — pseudonymous, not reversible to the raw id |
| `ad_id` | Which sponsor line was shown |
| `shown_ms`, `ts` | Duration/time the line was visible |
| `surface` | Always `"statusline"` |

An impression is sent **only after the sponsor line actually rendered** to your
terminal, throttled to once per session per 15 seconds.

## Lawful basis & retention (GDPR/CCPA)

- **Basis:** legitimate interest in measuring viewable ad delivery for payout.
- **Data class:** pseudonymous (`session_tag`) plus your chosen `publisher_id`.
- **Retention:** impression records retained only as long as needed for billing
  reconciliation and fraud defense; aggregate after settlement.
- **Deletion:** request removal of your `publisher_id` and its records at any time.

## AI-news fallback (unpaid, anonymous)

When there is no ad to show, the status line may display a recent AI-news
headline instead. That fetch goes to a public news API (Hacker News/Algolia)
as a **fully anonymous GET** — no publisher id, no session tag, no auth header,
nothing derived from your machine. It is never labeled `[sponsor]` and is never
reported as an impression. Turn it off with `COGWAIT_NEWS=0` (or `"news": "0"`
in `~/.cogwait/config.json`).

## Your controls

- `COGWAIT_DISABLED=1` — pause all ads and reporting
- `npx cogwait --uninstall` — remove the status line entirely
- `COGWAIT_MOCK=1` — local demo mode; nothing is ever sent

## Open source

Every claim on this page is checkable, because the entire project is open source
under the [MIT license](LICENSE) at
[github.com/Cognifer-Labs/cogwait](https://github.com/Cognifer-Labs/cogwait) —
not just the client, but the ad server, the dashboard, and the desktop app too.

- Every outbound request lives in [`lib/client.js`](lib/client.js) and the
  [`bin/`](bin/) scripts — unminified JavaScript, zero runtime dependencies, so
  there is no third-party code path that could transmit anything we don't
  describe here.
- The server side that receives it all is in [`server/`](server/).
- Don't want to trust our server at all? Point the client somewhere else with
  `COGWAIT_API`, or run the whole network yourself — see
  [`docs/DEPLOY.md`](docs/DEPLOY.md).

Audit it before trusting it. That is the intended workflow, not a fallback.
