# DESIGN — Cogwait UI System Redo (all surfaces)

**Status:** validated, decisions locked, ready for planning · **Owner:** Cognifer Labs · **Date:** 2026-07-20
**Feature slug:** `ui-redo`

Full teardown + rebuild of every Cogwait UI surface onto **one** design system,
with the brand repositioned **Fund-OSS-first**. Delete-and-redo authorized by the
user; all four surfaces are git-tracked (recoverable).

---

## 1. Why (the problem this fixes)

Today there are **four unrelated visual languages** — one per surface:

| Surface | File(s) | Accent | Base | Read |
|---|---|---|---|---|
| Landing | `web/index.html` | cyan `#38bdf8` | cold blue-black `#0a0c10` | clean, generic |
| Dashboard | `web/dashboard.html` | cyan `#38bdf8` | cold `#0b0d10` | generic |
| Desktop app | `app/` | **orange `#ff6a3d`** | warm bone-ink `#131417` | crafted, opinionated |
| Video | `video/` | magenta `#e64ec9` + cyan | near-black `#0a0b0f` | terminal-neon |

No shared tokens, no shared personality. The desktop app (commit `b2f4ad2`,
"feel alive, not AI-generated") is the only surface with real craft — its
structural language is retained; its **orange is replaced** by the user's palette.

---

## 2. Locked decisions (from user)

1. **Palette = gold `#CA9A2B` (primary) + blue `#2B5BCA` (secondary).** Two brand
   colors, everywhere, no drift.
2. **Fund-OSS-first, default-on.** By default a share of earnings funds open
   source; a setting dials the donation **down** (to 0 = keep all). Default
   donation = **20%** (delegated pick — see §8).
3. **NOT changing the 70/30 publisher/operator revenue share** (assumption on the
   "gives to me" phrasing; flagged for veto). Fund-OSS splits the *publisher's*
   share only, per the locked `fund-oss-mode` design.
4. Structural craft of `app/` is the canonical system; everything else rebuilds
   onto it, recolored.

---

## 3. The design system (canonical — every surface mirrors this)

Single source of truth = this section. Each surface mirrors it in its native
format (CSS custom props for `web/` + `app/`; a `COLORS`/`FONT` object for
`video/`). A header comment in each points back here. (Same "shared truth,
per-surface render" pattern as `lib/levels.js` → `lib/render.js`.)

### 3.1 Color — dark (canonical)
```
--bg:        #141310   /* warm near-black, seats the gold */
--panel:     #1b1915
--panel-2:   #222019
--term:      #0e0d0a   /* terminal / recessed field */
--border:    #302c24
--border-soft:#26231c
--hair:      #2a2720
--fg:        #ece7db   /* warm bone */
--dim:       #9c9484
--faint:     #615b4d

/* PRIMARY — gold: value, earnings, give-back, the one "loud" brand signal */
--gold:      #CA9A2B
--gold-deep: #8f6c17   /* hard-offset button underside */
--gold-ink:  #1a1204   /* text on gold fills */
--gold-wash: #241d0d   /* selected / tint bg */

/* SECONDARY — blue: actions ("do it" verbs), links, trust, system chrome */
--blue:      #2B5BCA
--blue-bright:#4a78e6  /* hover / link */
--blue-deep: #1c3d86   /* button underside */
--blue-ink:  #eaf0ff
--blue-wash: #131a2c

/* status (muted, never neon) */
--green:#5fbf7f  --amber:#d9982f  --red:#e2564d

/* terminal ANSI (only lives inside the sponsor/terminal preview) */
--t-cyan:#5fd0da  --t-yellow:#e8c15a
```
Rule inherited from `app/`: **zero glow.** Depth comes from hard-offset shadows,
hairline rules, and one paper-grain texture — never blur/bloom.

### 3.2 Color — light (landing + dashboard only; app & video stay dark)
```
--bg:#faf8f2  --panel:#ffffff  --fg:#1a1611  --dim:#6a6252  --faint:#98907e
--border:rgba(70,58,30,.14)  --hair:rgba(70,58,30,.10)
--gold:#815d12 (darkened for AA on light — ≈4.8:1 on wash)  --blue:#2b5bca  --gold-ink:#fff
```
`color-scheme: light dark`; `prefers-color-scheme` swaps. Both modes ship AA.

### 3.3 Typography
- **UI sans:** `-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif`.
- **Display (hero/H1):** same family, weight 750–800, `letter-spacing:-0.03em`,
  `clamp(34px,6vw,60px)`.
- **Mono:** `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace` — every
  numeral that is data, the terminal, code, kickers, and index tags.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on all money/stats.
- System fonts only (no network fetch — matters for video render + CSP).

### 3.4 Signature elements (carry the brand across all four surfaces)
1. Warm bone-on-ink base; one gold + one blue; no glow.
2. Flat panels, **edge-to-edge header rule** with a gold `▍` marker before the title.
3. Mono **kickers** + `decimal-leading-zero` index numbers (nav, sections).
4. Big **tabular-num** stat values with a short gold top-hairline on each tile.
5. **Tactile buttons:** solid fill + hard offset shadow, press translates down.
   Primary/value = **gold**; action/"do it" verbs (Cash out, Connect, Install) =
   **blue**; tertiary = ghost outline.
6. **Corner tags** (`SET`, `LIVE`, `DEFAULT`) as filled flags, not floating chips.
7. Faint **paper grain** (0.028, soft-light) — the one texture.
8. Squared toggles, recessed mono inputs, gold focus ring (no bloom).
9. The **sponsor/terminal preview** is the only place ANSI color lives.
10. **Motion:** staggered `translateY` rise on view enter, tactile press, soft
    blink on the live dot; all gated by `prefers-reduced-motion`.

### 3.5 Color semantics (so gold vs blue is never arbitrary)
- **Gold** = money you made, money given to OSS, the brand mark, "value/generosity."
- **Blue** = things you *do* (buttons/links/actions), trust/system state.
- **Green** = healthy/ok. **Red** = off/error. **Amber** = attention/warn.
- OSS-give amounts render gold with a `◇` (or leaf) marker; earnings render gold;
  the *actions* around them are blue.

---

## 4. Repositioning — Fund-OSS-first

The hero stops being "you earn" and becomes "open source gets funded." Earning is
the mechanism; funding OSS is the story (the true differentiator vs
IdleDev/idlepay/Idlen/Kickbacks — none give back).

- **Tagline (primary):** *"Your AI thinks. Open source gets paid."*
- **Sub:** *"One opt-in, clearly labeled sponsor line in your Claude Code status
  row. By default a slice funds the open source you build on — you set how much.
  It never reads your code."*
- **Default-on framing:** the donation is on out of the box (20%); the UI always
  shows the split (keep vs give) and makes lowering it a one-drag, no-guilt action.
- **Honesty preserved:** the receipt is a *representative snapshot* (pooled fund),
  never "maintainer X received $Y." Demand-risk disclaimer stays.

---

## 5. Per-surface redesign intent

### 5.1 Landing — `web/index.html`
Rebuild on §3 tokens (light+dark). New hero (§4). Terminal demo shows the
`[sponsor]` line **and** a give-back receipt tease:
```
[sponsor] Neon — serverless Postgres that scales to zero ›
  ◇ 20% of this → the open source you build on   [ adjust ]
```
Sections: **How the give-back works** (default-on, adjustable, pooled+honest) ·
**Actually private** · **Viewable-only** · **Keep the rest / set your split** ·
**Honest about the risk**. CTA: gold "Get it on GitHub" + blue ghost "See a
sample OSS receipt". Footer unchanged (privacy/terms/ad-policy links).

### 5.2 Dashboard — `web/dashboard.html`
Rebuild on tokens. Keep the local-file `Connect` flow (privacy). Add the
**Fund open source** card as a co-hero with cash-out: donate-% slider (0–100,
default 20), **funded-to-date** (gold), payout **split preview** (keep vs give),
and the **maintainer receipt** table (from the `lib/oss.js` scan — loaded via the
existing local file-picker per the Fund-OSS plan's open item). Level control +
history rebuilt to match.

### 5.3 Desktop app — `app/`
Reskin `app/src/styles.css` orange → gold+blue (mechanical token swap; structure
stays). Add a **Fund-OSS** section/tab mirroring the dashboard card: donate-%
control (held Rust-side like the key), split preview, local scan → receipt. New
Rust command for `donate_pct` get/set + scan trigger (Tauri surface in
`app/src-tauri/src/lib.rs`). `app/src-tauri/src/cogwait.rs` sponsor-line preview
recolored (sponsor = gold).

### 5.4 Video — `video/`
Swap `video/src/theme.ts` `COLORS` to the gold+blue system; `sponsor` → gold.
Keep the dark-terminal aesthetic. **Add a Fund-OSS beat** to the narrative: after
the sponsor line renders, reveal the `◇ 20% → open source` receipt — the emotional
turn that separates Cogwait from the incumbents in the comparison scene.

---

## 6. Cross-surface consistency mechanism

- Canonical tokens live here (§3). Mirror into: `web/*.html` `:root`, `app/src/styles.css`
  `:root`, `video/src/theme.ts` `COLORS`/`FONT`. Each gets a one-line header
  comment: `/* palette: see .planning/ui-redo/DESIGN.md §3 — do not fork values */`.
- The `[sponsor]` line and give-back receipt string are rendered from the shared
  `lib/render.js` where a surface can consume JS (statusline, app), and visually
  matched (not forked) where it can't (static HTML, Remotion). No third color
  invented anywhere.

---

## 7. Testing / acceptance

- **Visual parity:** all four surfaces read as one system — same two accents, same
  panel/kicker/stat/button language, same grain. Spot-check side by side.
- **Both themes AA:** landing + dashboard pass contrast in light and dark.
- **Reduced-motion:** every animation disabled under the media query.
- **No regressions:** dashboard `Connect` still reads config **locally only**
  (privacy assertion intact); app still compiles (`cargo check` + `vite build`);
  video still renders with system fonts (no network).
- **Fund-OSS surfaces are honest:** every give-back figure labeled snapshot/pooled;
  no "maintainer received" claim; demand-risk disclaimer present on landing.

---

## 8. Decision log

| # | Decision | Alternatives | Why |
|---|----------|-------------|-----|
| 1 | Palette gold `#CA9A2B` + blue `#2B5BCA` | app orange; video magenta/cyan; fresh | **User chose** (gave the two hex values). |
| 2 | Keep `app/` structural language as canonical, recolor it | rebuild structure from scratch | It's the only crafted surface; discarding structure wastes the best work. Redo = recolor + extend + propagate, not reinvent. |
| 3 | Fund-OSS-first, default-on | earn-first; dual | **User chose** ("default also funds opensource"). Also the real differentiator. |
| 4 | Default donation = 20%, adjustable 0–100 | 10% / 50% / off-by-default | **Delegated** ("decide"). 20% is generous-but-not-punishing, reads well as a hero number, trivially lowered. Updates `fund-oss-mode` design decision #3 (was default 0). |
| 5 | Do NOT alter 70/30 publisher/operator share | reduce operator cut | **CONFIRMED by user (2026-07-20).** "gives to me" = the OSS-donation %, not the operator cut. Revenue share stays 70/30; Fund-OSS splits the publisher's share only. |
| 6 | Gold=value/give, Blue=action/trust (fixed semantics) | free mix | Prevents the two colors becoming decorative noise; every use is meaningful. |
| 7 | Mirror tokens per surface, not one shared build artifact | shared CSS/JS across 3 build systems | web is buildless, app is Vite, video is Remotion — a single imported file is awkward; mirror + doc-pointer is simpler and matches existing `levels`/`render` split. |

---

## 9. Open items for implementation planning

- **Confirm decision #5** (revenue-share vs donation interpretation) before shipping copy.
- **Dashboard receipt data path** — static page can't scan `node_modules`; per the
  Fund-OSS plan, the CLI writes a receipt JSON the dashboard's file-picker loads.
  Wire the two designs together.
- **Desktop `donate_pct` storage** — held Rust-side; confirm it syncs to
  `POST /donate/config` (server is source of truth for the split).
- **Video length budget** — adding a Fund-OSS beat may push runtime; trim an
  existing scene rather than overrun.
- **Icon/wordmark** — the app brand-dot recolors to gold; check the generated icon
  set (`app/` icon-src) still reads at small sizes in gold.
```
