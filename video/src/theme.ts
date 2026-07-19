// Shared visual language for all Sponsoric videos — a dark terminal aesthetic
// with a single magenta/cyan accent. System fonts only (no network fetch at render).

export const COLORS = {
  bg: "#0a0b0f",
  bgPanel: "#12141b",
  bgTerminal: "#0d1017",
  border: "#232734",
  text: "#e7e9ee",
  textDim: "#8b90a0",
  textFaint: "#565c6e",
  cyan: "#3ad0e6",
  magenta: "#e64ec9",
  yellow: "#f5c451",
  green: "#4ade80",
  red: "#f2607d",
  sponsor: "#e64ec9",
};

export const FONT_MONO =
  'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
export const FONT_SANS =
  '-apple-system, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif';

export const FPS = 30;

// The four incumbents Sponsoric is positioned against.
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
