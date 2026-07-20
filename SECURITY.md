# Security

## Reporting a vulnerability

Email security@cognifer-labs.example (replace with real address before launch).
Do not open public issues for security reports. We aim to acknowledge within 72h.

## Threat model & mitigations

| Risk | Mitigation |
| --- | --- |
| Leaking developer code/prompts | Client never reads them; hooks discard all stdin except the session id. Auditable in `lib/client.js`. |
| Raw session id exposure | Only a truncated SHA-256 tag leaves the machine. |
| Statusline blocking the terminal | All network calls are detached with hard timeouts; EPIPE-guarded; offline backoff after repeated failures. |
| Impression fraud (inflation) | Client throttle + server dedupe + per-session daily cap + rate limiting. |
| Supply chain | Zero runtime npm dependencies. Pin and sign releases before publishing to npm. |
| Malicious ad content | Review gate (`pending` → `approved`); see `AD_POLICY.md`. |
| Secret handling (backend) | `STRIPE_SECRET_KEY` / `COGWAIT_ADMIN_TOKEN` via env only; never logged. |
| Payout redirection | Every publisher-scoped endpoint requires `Authorization: Publisher <id>:<secret>`; the destination is the publisher's **server-side** connected account — request-body `stripe_account` is ignored. |
| Earnings enumeration (IDOR) | `/earnings` requires auth and is scoped to the authenticated publisher; `publisher_id` query/body is ignored for scoping. |
| Default/weak admin token | Backend **refuses to start** without `COGWAIT_ADMIN_TOKEN` or if it equals the old default; admin + secret checks use `crypto.timingSafeEqual`. |
| Credit spoofing | Impression credit goes to the authenticated identity, never a body-supplied `publisher_id`. |

### Resolved review findings (2026-07-17)
Automated review flagged three backend issues — all fixed and covered by tests in `test/backend.js`:
1. **Authorization / payout redirection (CRITICAL)** — added per-publisher secret auth; payout destination is server-side only.
2. **Broken access control / earnings enumeration (HIGH)** — `/earnings` authenticated and self-scoped.
3. **Hardcoded default admin token (HIGH)** — startup refusal + timing-safe comparison.

## Pre-launch checklist

- [ ] Confirm no dependency creep (`npm ls --prod` shows none)
- [ ] Sign npm release provenance
- [ ] Rotate admin token; move to per-advertiser scoped keys
- [ ] Third-party audit of every outbound request in `lib/client.js`
- [ ] Verify hooks forward no prompt/code (grep for the fields sent)
