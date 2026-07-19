import React from "react";
import { Composition } from "remotion";
import { FPS } from "./theme";
import { CliOnly } from "./CliOnly";
import { AdLevels } from "./AdLevels";
import { Comparison } from "./Comparison";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CliOnly"
        component={CliOnly}
        durationInFrames={420}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="AdLevels"
        component={AdLevels}
        durationInFrames={415}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Comparison"
        component={Comparison}
        durationInFrames={300}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
