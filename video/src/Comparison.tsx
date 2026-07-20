import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";
import { COLORS, FONT_MONO, FONT_SANS } from "./theme";
import { Rise, Pop } from "./anim";

const ROWS: { label: string; sponsoric: string; incumbent: string; win: boolean }[] = [
  { label: "Runs inside the CLI status line", sponsoric: "yes", incumbent: "no", win: true },
  { label: "Open-source, auditable bridge", sponsoric: "yes", incumbent: "mostly closed", win: true },
  { label: "Viewable-only billing (in code)", sponsoric: "enforced", incumbent: "trust us", win: true },
  { label: "Never reads code / prompts", sponsoric: "hashed tag only", incumbent: "varies", win: true },
  { label: "You pick the ad level & CPM", sponsoric: "3 tiers", incumbent: "fixed", win: true },
  { label: "Dev revenue share", sponsoric: "70%", incumbent: "50–70%", win: true },
  { label: "Funds open source out of the box", sponsoric: "yes, default 20%", incumbent: "no", win: true },
];

export const Comparison: React.FC = () => (
  <AbsoluteFill style={{ background: COLORS.bg }}>
    <Sequence durationInFrames={55}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Rise>
          <div style={{ fontFamily: FONT_SANS, color: COLORS.text, fontSize: 80, fontWeight: 800, textAlign: "center" }}>
            Same idea. Different rules.
          </div>
        </Rise>
      </AbsoluteFill>
    </Sequence>
    <Sequence from={55}>
      <Table />
    </Sequence>
  </AbsoluteFill>
);

const Table: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 70 }}>
      <div style={{ width: 1500, fontFamily: FONT_SANS }}>
        {/* header */}
        <Pop>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px 360px", alignItems: "center", paddingBottom: 18 }}>
            <div />
            <HeadCell accent>Cogwait</HeadCell>
            <HeadCell>Incumbents</HeadCell>
          </div>
        </Pop>
        {ROWS.map((r, i) => {
          const at = 10 + i * 12;
          const t = interpolate(frame - at, [0, 14], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={r.label}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 360px 360px",
                alignItems: "center",
                borderTop: `1px solid ${COLORS.border}`,
                padding: "22px 0",
                opacity: t,
                transform: `translateX(${(1 - t) * -30}px)`,
              }}
            >
              <div style={{ color: COLORS.text, fontSize: 34 }}>{r.label}</div>
              <Cell win text={r.sponsoric} />
              <Cell text={r.incumbent} muted />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const HeadCell: React.FC<{ children: React.ReactNode; accent?: boolean }> = ({ children, accent }) => (
  <div
    style={{
      textAlign: "center",
      fontFamily: FONT_MONO,
      fontSize: 34,
      fontWeight: 800,
      color: accent ? COLORS.gold : COLORS.textDim,
    }}
  >
    {children}
  </div>
);

const Cell: React.FC<{ text: string; win?: boolean; muted?: boolean }> = ({ text, win, muted }) => (
  <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
    <span style={{ fontSize: 34, color: win ? COLORS.green : COLORS.textFaint }}>{win ? "✓" : "—"}</span>
    <span style={{ fontSize: 30, fontFamily: FONT_MONO, color: muted ? COLORS.textFaint : COLORS.text }}>
      {text}
    </span>
  </div>
);
