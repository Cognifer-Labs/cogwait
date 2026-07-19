# Sponsoric Ad Content Policy

_PoC draft. All campaigns are reviewed before serving (`status: "pending"` until
approved)._

## Format rules

- One line, ≤ 80 characters, clearly labeled `[sponsor]`.
- Optional single destination URL, shown as a click affordance.
- No animation, no color tricks meant to mimic system output, no fake errors.

## Prohibited advertisers / content

- Malware, cryptominers, or anything that executes on the developer's machine
- Scams, phishing, fake giveaways, "you've won" bait
- Deceptive claims, fake benchmarks, impersonation of other brands or of Anthropic/Claude
- Adult content, gambling, weapons, illegal goods
- Anything implying endorsement by Claude Code, Anthropic, or the developer

## Placement integrity

- Impressions bill **only when the line is rendered to a human**. No phantom
  impressions, no auto-refresh inflation, no manufactured delay to serve more ads.
- Server-side dedupe and per-session caps enforce this; publishers found gaming
  it are removed and unpaid.

## Review

Every campaign starts `pending`. An admin approves it (sets `approved`) only
after it passes format + content review. House ads (open-source dev tools) fill
inventory when no approved campaign has budget.

## Appeals & takedown

Advertisers or developers can report a placement for review; confirmed
violations are pulled immediately and the advertiser's remaining budget frozen.
