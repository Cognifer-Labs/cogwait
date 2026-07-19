# Sponsoric Privacy Policy

_Last updated: 2026-07-17 · PoC draft — have counsel review before production._

Sponsoric is built so that **your code, prompts, files, and secrets never leave
your machine.** This document states exactly what is and isn't collected.

## What is NEVER collected or transmitted

- Prompt text or Claude's responses
- Source code, file contents, or file paths
- Environment variables, API keys, or secrets
- The raw Claude Code session id
- Keystrokes, terminal output, or screen contents

The hooks (`UserPromptSubmit`, `Stop`) receive event data on stdin, but the
scripts read only the session id and discard everything else. See
`bin/report-wait.js` and `lib/client.js` — every outbound call is auditable.

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

## Your controls

- `SPONSORIC_DISABLED=1` — pause all ads and reporting
- `npx sponsoric --uninstall` — remove the status line entirely
- `SPONSORIC_MOCK=1` — local demo mode; nothing is ever sent

## Open source

The bridging client is open source. Read `lib/client.js` and audit every network
request before trusting it.
