import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";
import { COLORS, FONT_MONO, FONT_SANS, COMPETITORS } from "./theme";
import { Terminal, SponsorLine, GiveBackLine } from "./Terminal";
import { Rise, Pop } from "./anim";

// Hero video: the only wait-time monetizer that renders inside the CLI.
// Length budget (ui-redo DESIGN.md §9 open item): the new Fund-OSS reveal
// beat in CliReveal needs room, so Competitors is trimmed by the same 30
// frames rather than extending the total 420-frame runtime.
export const CliOnly: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence durationInFrames={95}>
        <Intro />
      </Sequence>
      <Sequence from={95} durationInFrames={90}>
        <Competitors />
      </Sequence>
      <Sequence from={185} durationInFrames={160}>
        <CliReveal />
      </Sequence>
      <Sequence from={345} durationInFrames={75}>
        <Closing />
      </Sequence>
    </AbsoluteFill>
  );
};

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 90 }}>
    {children}
  </AbsoluteFill>
);

const Intro: React.FC = () => (
  <Center>
    <div style={{ textAlign: "center", maxWidth: 1500 }}>
      <Rise>
        <div style={{ fontFamily: FONT_MONO, color: COLORS.textDim, fontSize: 30, letterSpacing: 2 }}>
          MONETIZE AI WAIT TIME
        </div>
      </Rise>
      <Rise delay={12}>
        <div
          style={{
            fontFamily: FONT_SANS,
            color: COLORS.text,
            fontSize: 84,
            fontWeight: 800,
            lineHeight: 1.08,
            marginTop: 26,
          }}
        >
          Everyone wants to pay you<br />while your AI thinks.
        </div>
      </Rise>
      <Rise delay={26}>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.textDim, fontSize: 40, marginTop: 30 }}>
          One catch: you don't work in a browser.
        </div>
      </Rise>
    </div>
  </Center>
);

const Competitors: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Center>
      <div style={{ textAlign: "center" }}>
        <Rise>
          <div style={{ fontFamily: FONT_SANS, color: COLORS.text, fontSize: 52, fontWeight: 700 }}>
            The incumbents live in a tab.
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 28, marginTop: 60, justifyContent: "center" }}>
          {COMPETITORS.map((c, i) => {
            const stampAt = 40 + i * 8;
            const stamp = interpolate(frame - stampAt, [0, 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <Pop key={c.name} delay={14 + i * 7}>
                <div
                  style={{
                    width: 300,
                    height: 220,
                    background: COLORS.bgPanel,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 14,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: 34,
                      background: COLORS.bgPanel2,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      paddingLeft: 12,
                      borderBottom: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <Chip /> <Chip /> <Chip />
                    <div style={{ marginLeft: 10, color: COLORS.textFaint, fontSize: 15, fontFamily: FONT_MONO }}>
                      {c.surface}
                    </div>
                  </div>
                  <div style={{ padding: "26px 22px", fontFamily: FONT_SANS }}>
                    <div style={{ color: COLORS.text, fontSize: 30, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ color: COLORS.textDim, fontSize: 21, marginTop: 10 }}>
                      dev share {c.share}
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: COLORS.overlayInk,
                      opacity: stamp,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        border: `3px solid ${COLORS.red}`,
                        color: COLORS.red,
                        fontFamily: FONT_MONO,
                        fontWeight: 800,
                        fontSize: 22,
                        padding: "8px 16px",
                        borderRadius: 8,
                        transform: "rotate(-9deg)",
                      }}
                    >
                      NO CLI
                    </div>
                  </div>
                </div>
              </Pop>
            );
          })}
        </div>
        <Rise delay={70}>
          <div style={{ fontFamily: FONT_SANS, color: COLORS.textDim, fontSize: 34, marginTop: 56 }}>
            None of them can reach your terminal.
          </div>
        </Rise>
      </div>
    </Center>
  );
};

const CliReveal: React.FC = () => (
  <Center>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Pop delay={4}>
        <div
          style={{
            fontFamily: FONT_MONO,
            color: COLORS.gold,
            fontSize: 30,
            letterSpacing: 2,
            marginBottom: 26,
            fontWeight: 700,
          }}
        >
          COGWAIT — NATIVE TO THE CLI
        </div>
      </Pop>
      <Rise delay={10} dur={22}>
        <Terminal width={1180}>
          <div style={{ color: COLORS.green }}>
            <span style={{ color: COLORS.gold }}>❯</span> claude "refactor the auth middleware"
          </div>
          <div style={{ color: COLORS.textDim, marginTop: 6 }}>· thinking… reading 12 files</div>
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: `1px dashed ${COLORS.border}`,
            }}
          >
            <SponsorLine level={3} text="Neon — serverless Postgres that scales to zero" url="https://neon.tech" />
            {/* Fund-OSS beat (§5.4): the give-back receipt tease reveals after
                the sponsor line settles — the emotional turn that separates
                Cogwait from every incumbent in the Comparison scene. */}
            <Rise delay={90} dur={20} style={{ marginTop: 14 }}>
              <GiveBackLine pct={20} />
            </Rise>
          </div>
        </Terminal>
      </Rise>
      <Rise delay={40}>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.text, fontSize: 40, marginTop: 44, textAlign: "center" }}>
          The <b style={{ color: COLORS.gold }}>only</b> wait-time sponsor that renders
          <br />where you actually work — the status line.
        </div>
      </Rise>
    </div>
  </Center>
);

const Closing: React.FC = () => (
  <Center>
    <div style={{ textAlign: "center" }}>
      <Pop>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.text, fontSize: 96, fontWeight: 900 }}>
          Cogwait
        </div>
      </Pop>
      <Rise delay={12}>
        <div style={{ fontFamily: FONT_SANS, color: COLORS.textDim, fontSize: 42, marginTop: 12 }}>
          Your AI thinks. Open source gets paid.
        </div>
      </Rise>
      <Rise delay={24}>
        <div
          style={{
            fontFamily: FONT_MONO,
            color: COLORS.blue,
            fontSize: 34,
            marginTop: 40,
            background: COLORS.bgTerminal,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: "16px 30px",
            display: "inline-block",
          }}
        >
          npx cogwait
        </div>
      </Rise>
    </div>
  </Center>
);

const Chip: React.FC = () => (
  <div style={{ width: 9, height: 9, borderRadius: 999, background: COLORS.border }} />
);
