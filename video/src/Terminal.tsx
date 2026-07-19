import React from "react";
import { COLORS, FONT_MONO } from "./theme";

// A macOS-style terminal window used across the videos.
export const Terminal: React.FC<{
  width?: number;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width = 1100, title = "claude-code — zsh", children, style }) => {
  return (
    <div
      style={{
        width,
        background: COLORS.bgTerminal,
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontFamily: FONT_MONO,
        ...style,
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 18px",
          background: "#171a22",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <Dot c="#ff5f57" />
        <Dot c="#febc2e" />
        <Dot c="#28c840" />
        <div
          style={{
            flex: 1,
            textAlign: "center",
            color: COLORS.textFaint,
            fontSize: 18,
            letterSpacing: 0.3,
            marginRight: 40,
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ padding: "26px 30px", fontSize: 25, lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
};

const Dot: React.FC<{ c: string }> = ({ c }) => (
  <div style={{ width: 14, height: 14, borderRadius: 999, background: c }} />
);

// The Sponsoric sponsor line, rendered per ad level (mirrors bin/statusline.js).
export const SponsorLine: React.FC<{ level: number; text: string; url: string }> = ({
  level,
  text,
  url,
}) => {
  if (level <= 0) return null;
  if (level >= 3) {
    return (
      <div>
        <div>
          <span style={{ color: COLORS.magenta, fontWeight: 700 }}>◆ SPONSOR</span>{" "}
          <span style={{ color: COLORS.text, fontWeight: 700 }}>{text}</span>
        </div>
        <div style={{ paddingLeft: 128, color: COLORS.yellow }}>{url} ›</div>
      </div>
    );
  }
  if (level >= 2) {
    return (
      <div>
        <span style={{ color: COLORS.yellow, fontWeight: 700 }}>▸ [sponsor]</span>{" "}
        <span style={{ color: COLORS.cyan }}>{text}</span>{" "}
        <span style={{ color: COLORS.yellow }}>›</span>
      </div>
    );
  }
  return (
    <div>
      <span style={{ color: COLORS.cyan }}>[sponsor]</span>{" "}
      <span style={{ color: COLORS.textDim }}>{text} ›</span>
    </div>
  );
};
