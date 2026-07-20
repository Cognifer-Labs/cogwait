# Cogwait — marketing videos (Remotion)

Three short 1920×1080 @ 30fps spots positioning Cogwait as the **only**
wait-time monetizer that runs inside the CLI.

| Composition | File | Length | Message |
| --- | --- | --- | --- |
| `CliOnly` | `out/cogwait-cli-only.mp4` | 14s | Incumbents live in a browser tab; Cogwait renders in the Claude Code status line — the only one native to the CLI. |
| `AdLevels` | `out/cogwait-ad-levels.mp4` | ~14s | The 3 ad tiers (Minimal $8 → Standard $18 → Boosted $35 CPM). You trade prominence for pay; keep 70%. |
| `Comparison` | `out/cogwait-comparison.mp4` | 10s | Side-by-side: CLI-native, open-source, viewable-only, dev share. |

## Run

```bash
cd video
npm install          # Remotion 4 + React 19
npm run dev          # open Remotion Studio to preview/edit live
npm run render:all   # render all three mp4s into out/
```

Individual renders: `npm run render:cli` · `render:levels` · `render:compare`.

## Notes

- Rendered `.mp4`s live in `out/` (git-ignored — reproducible via `render:all`).
- Copy stays honest: no fixed earnings promise. CPMs shown are the tier rates
  from `../lib/levels.js`; real earnings still depend on advertiser demand.
- The sponsor-line rendering in `src/Terminal.tsx` mirrors `../bin/statusline.js`
  so the on-screen ad matches the real product at each level.
