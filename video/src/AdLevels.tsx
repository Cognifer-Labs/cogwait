import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";
import { COLORS, FONT_MONO, FONT_SANS, LEVELS } from "./theme";
import { Terminal, SponsorLine } from "./Terminal";
import { Rise, Pop } from "./anim";

// "You pick the trade" — the tiered ad levels, CPM climbing with prominence.
export const AdLevels: React.FC = () => (
  <AbsoluteFill style={{ background: COLORS.bg }}>
    <Sequence durationInFrames={60}>
      <Title />
    </Sequence>
    {LEVELS.map((lvl, i) => (
      <Sequence key={lvl.id} from={60 + i * 95} durationInFrames={100}>
        <LevelCard lvl={lvl} />
      </Sequence>
    ))}
    <Sequence from={60 + LEVELS.length * 95} durationInFrames={70}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);

const Title: React.FC = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ textAlign: "center" }}>
      <Rise>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.text, fontSize: 82, fontWeight: 800 }}>
          You set the price of your attention.
        </div>
      </Rise>
      <Rise delay={14}>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.textDim, fontSize: 40, marginTop: 22 }}>
          One dim line, or a bold block. More prominent = higher CPM.
        </div>
      </Rise>
    </div>
  </AbsoluteFill>
);

const LevelCard: React.FC<{ lvl: (typeof LEVELS)[number] }> = ({ lvl }) => {
  const frame = useCurrentFrame();
  const cpm = Math.round(interpolate(frame, [4, 34], [0, lvl.cpm], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const demoText =
    lvl.id === 3
      ? "Neon — serverless Postgres that scales to zero"
      : "Warp — the terminal, reimagined for AI devs";
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 80 }}>
      <div style={{ display: "flex", gap: 60, alignItems: "center" }}>
        <Rise dur={16}>
          <Terminal width={780} title="claude-code — status line">
            <div style={{ color: COLORS.textDim }}>· thinking…</div>
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px dashed ${COLORS.border}` }}>
              <SponsorLine level={lvl.id} text={demoText} url="https://neon.tech" />
            </div>
          </Terminal>
        </Rise>
        <Pop delay={6} style={{ width: 420 }}>
          <div
            style={{
              background: COLORS.bgPanel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 40,
              fontFamily: FONT_SANS,
            }}
          >
            <div style={{ color: COLORS.textDim, fontSize: 26, fontFamily: FONT_MONO }}>
              LEVEL {lvl.id}
            </div>
            <div style={{ color: COLORS.text, fontSize: 60, fontWeight: 800, marginTop: 4 }}>
              {lvl.label}
            </div>
            <div style={{ color: COLORS.textDim, fontSize: 26, marginTop: 4 }}>{lvl.desc}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 34 }}>
              <span style={{ color: COLORS.gold, fontSize: 88, fontWeight: 900, fontFamily: FONT_MONO }}>
                ${cpm}
              </span>
              <span style={{ color: COLORS.textDim, fontSize: 30 }}>CPM</span>
            </div>
            <div style={{ color: COLORS.green, fontSize: 30, marginTop: 10, fontFamily: FONT_MONO }}>
              you keep ${lvl.keep} / impression
            </div>
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ textAlign: "center" }}>
      <Pop>
        <div style={{ fontFamily: FONT_MONO, color: COLORS.blue, fontSize: 46 }}>
          npx cogwait --level 3
        </div>
      </Pop>
      <Rise delay={12}>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.textDim, fontSize: 36, marginTop: 24 }}>
          Opt-in. Labeled. Viewable-only. 70% yours.
        </div>
      </Rise>
    </div>
  </AbsoluteFill>
);
