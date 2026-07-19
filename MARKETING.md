# Sponsoric — Marketing Plan

_Owner: Cognifer Labs · Draft v1 · Honest framing only: opt-in, labeled, no
code/prompt reading, viewable-only billing, never "guaranteed passive income."_

## 1. The one-liner

**Your AI thinks. You earn — honestly.** One opt-in, clearly labeled sponsor line
in the Claude Code status row while your agent works. Keep 70%. It never reads
your code, files, or prompts, and it's open source so you can prove it.

## 2. Market & timing

The "monetize AI wait time" category already exists and is competitive:
IdleDev (65% to devs), idlepay (50%), Idlen (70%), Kickbacks AI (50%),
IdleAds (70%). That's validation the *demand-side wedge* is real — and a signal
that trust and dev-share are the battlegrounds, not the idea itself.

**Why now:** agentic CLIs (Claude Code, Codex, Aider, Gemini CLI) have exploded,
each generation loop is dead time, and developers are the hardest audience to
advertise to honestly. First mover on *trust* wins the skeptics the incumbents
scared off.

## 3. Ideal customer profiles

**Publisher (supply):** individual devs and small teams running agentic CLIs
many hours/day — indie hackers, OSS maintainers, AI-heavy startups. They value
privacy, control, and not looking like a sellout. Earnings are coffee-money, so
the pitch is "free money you'd otherwise waste + I can turn it off," not riches.

**Advertiser (demand):** dev-tool companies (databases, observability, CI, IDEs,
API products) that already buy newsletter/podcast sponsorships to reach
engineers. Sponsoric offers *provably-viewed*, brand-safe, in-context placement.

## 4. Positioning vs. incumbents

| Axis | Sponsoric wedge |
| --- | --- |
| **Trust** | Fully open-source bridge; audit every network call. Incumbents are mostly closed. |
| **Privacy proof** | Only a hashed session tag + timestamp leave the machine — documented and testable, not just claimed. |
| **Dev share** | 70% (ties the top of the market). |
| **Integrity** | Viewable-only billing enforced in code (throttle + server dedupe + caps); never manufacture delay. |
| **Control** | One-command uninstall, one env var to pause, `--chain` to keep your existing statusline. |

Tagline for skeptics: **"The wait-time ad you'd actually let run — because you can read the code."**

## 5. Messaging pillars

1. **Honest by construction** — viewable-only, labeled, no dark patterns.
2. **Actually private** — your code/prompts never leave; here's the proof.
3. **You're in control** — opt-in, pausable, uninstallable, chainable.
4. **Fair split** — keep 70%, paid via Stripe.

Never say: "passive income," "get rich," "set and forget earnings." Always pair
the earnings claim with the honest demand caveat (§10).

## 6. Channels (ranked by fit)

1. **Hacker News (Show HN)** — the skeptic audience; win them and the trust story
   compounds. Lead with the privacy/open-source angle, not the money. (Copy in `LAUNCH.md`.)
2. **X / dev-Twitter** — short proof-driven threads; screen-recording of the
   sponsor line + `--uninstall`. Engage AI-CLI power users.
3. **Product Hunt** — launch-day spike + backlink; frame as honest alternative.
4. **Reddit** — r/programming, r/ChatGPTCoding, r/LocalLLaMA (read rules; lead
   with value, disclose ownership).
5. **Dev newsletters/podcasts** — sponsor the sponsorship tool (meta, on-brand):
   TLDR, Console, Changelog.
6. **GitHub / marketplace discovery** — README SEO, topics, the community plugin
   registry listing itself is a channel.
7. **Content/SEO** — comparison pages ("Sponsoric vs idlepay/IdleDev"), "is
   monetizing AI wait time a scam?" (answer honestly), privacy deep-dive.

## 7. Funnel & growth loops

**Funnel:** Discover (HN/X/PH) → Read privacy proof → `npx sponsoric` (mock mode,
zero commitment) → register + set payout → first impression → first payout →
advocate.

**Activation wedge:** `SPONSORIC_MOCK=1` lets a skeptic *see it work* with nothing
sent. Removing the "trust me" leap is the single highest-leverage growth move.

**Loops:**
- **Proof loop:** open-source + audit posts → trust → installs → more audits/PRs → more trust.
- **Two-sided loop:** more publishers → more viewable inventory → advertisers pay → higher CPM → higher earnings → more publishers.
- **Referral:** publisher referral bonus (small % of referred earnings for N days) — build after payout rails are live.
- **Meta loop:** the sponsor line itself can occasionally house-promote Sponsoric ("earning via Sponsoric — get it: …").

## 8. 0–90 day launch sequence

**Pre-launch (wk 0–2):** public repo + LICENSE + privacy doc; landing page live;
`npx sponsoric` works from a clean machine; 5–10 private beta devs; line up 1–2
design-partner advertisers (even at cost/free) so the network isn't empty.

**Launch (wk 3–4):** Show HN (privacy-first) → same-day PH → X thread with a
screen recording. Respond to every comment; publish a "how we handle your data"
follow-up. Submit to the community plugin marketplace once policy is confirmed.

**Post-launch (wk 5–12):** weekly proof content (audit walkthrough, earnings
transparency report, comparison pages); onboard 3–5 real advertisers; ship
referral program; publish an anonymized aggregate "what devs earned" report.

## 9. Metrics & targets (first 90 days, deliberately modest)

| Metric | Target |
| --- | --- |
| Installs (`npx sponsoric`) | 2,000 |
| Activation (registered + ≥1 impression) | 40% of installs |
| D30 retention (still enabled) | 50% |
| Paying advertisers | 3–5 |
| Fill rate (viewable inventory sold) | ≥ 60% |
| Uninstall reason captured | 100% (one-question prompt on `--uninstall`) |
| HN front page / PH top 5 | at least one |

North-star: **weekly viewable, paid impressions** — it couples trust (still
installed), demand (advertisers), and integrity (viewable only) in one number.

## 10. Honesty guardrails (non-negotiable)

- Never promise earnings; always state demand is unproven at scale.
- Never imply Anthropic/Claude endorsement.
- Disclose Cognifer Labs ownership in community posts.
- Every claim about privacy must be backed by an auditable line of code.
- Kill any growth tactic that relies on the developer *not* understanding the trade.

## 11. Budget (lean)

Near-zero paid spend at launch — this is a trust play, won on content and
community, not ads. Reserve small budget for: one dev-newsletter sponsorship
(~$1–2k as a demand-side test), design-partner advertiser credits, and a domain +
landing hosting. Scale paid only after fill rate and retention prove the loop.

## 12. Risks (and marketing response)

- **"It's still adware."** → Lead with open-source + mock mode; let skeptics verify, don't argue.
- **Advertiser demand unproven.** → Pre-sign design partners; publish real fill/earnings transparently; don't over-promise supply.
- **Marketplace rejects ad plugins.** → Confirm policy before submission; have the `npx` install path as the primary channel regardless.
- **Incumbent copies the trust angle.** → Keep the audit trail and dev-share visibly ahead; ship transparency reports they won't.
