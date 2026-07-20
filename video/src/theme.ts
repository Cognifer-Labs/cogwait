// Shared visual language for all Cogwait videos — a dark terminal aesthetic
// with the gold+blue brand system. System fonts only (no network fetch at render).
// palette: see .planning/ui-redo/DESIGN.md §3 — do not fork values

export const COLORS = {
  bg: "#141310",
  bgPanel: "#1b1915",
  bgPanel2: "#222019", // warm chrome tint — replaces stray cold blue-grey literals
  bgTerminal: "#0e0d0a",
  border: "#302c24",
  overlayInk: "rgba(20,19,16,0.55)", // warm-ink stamp overlay (was a cold rgba(10,11,15,...))
  text: "#ece7db",
  textDim: "#9c9484",
  textFaint: "#615b4d",
  // terminal-internal ANSI-adjacent set — exempt from the gold/blue repoint,
  // same rule as app/src/styles.css (§3.4 item 9: "the sponsor/terminal
  // preview is the only place ANSI color lives").
  cyan: "#5fd0da",
  yellow: "#e8c15a",
  green: "#5fbf7f",
  red: "#e2564d",
  // PRIMARY — gold: value, earnings, give-back, the sponsor word itself.
  gold: "#CA9A2B",
  // SECONDARY — blue: action/"do it" verbs (the `npx cogwait` CTA block).
  blue: "#2B5BCA",
  sponsor: "#CA9A2B",
};

export const FONT_MONO =
  'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
export const FONT_SANS =
  '-apple-system, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif';

export const FPS = 30;

// The four incumbents Cogwait is positioned against.
export const COMPETITORS = [
  { name: "IdleDev", surface: "browser tab", share: "65%" },
  { name: "idlepay", surface: "web dashboard", share: "50%" },
  { name: "Idlen", surface: "web app", share: "70%" },
  { name: "Kickbacks AI", surface: "browser", share: "50%" },
];

export const LEVELS = [
  { id: 1, label: "Minimal", cpm: 8, keep: "0.0056", desc: "one dim line" },
  { id: 2, label: "Standard", cpm: 18, keep: "0.0126", desc: "bright line + CTA" },
  { id: 3, label: "Boosted", cpm: 35, keep: "0.0245", desc: "two-line block" },
];
