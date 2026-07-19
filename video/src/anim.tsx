import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Fade + rise in over `dur` frames starting at `delay` (relative to the sequence).
export const Rise: React.FC<{
  delay?: number;
  dur?: number;
  y?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, dur = 18, y = 24, children, style }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        opacity: t,
        transform: `translateY(${(1 - t) * y}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// Spring pop (scale) — good for badges and reveals.
export const Pop: React.FC<{
  delay?: number;
  from?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, from = 0.7, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.6 } });
  const scale = from + (1 - from) * s;
  return (
    <div style={{ opacity: Math.min(1, s * 1.4), transform: `scale(${scale})`, ...style }}>
      {children}
    </div>
  );
};
