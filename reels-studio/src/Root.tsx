import React from "react";
import { Composition } from "remotion";
import "./fonts";
import { DURATION, LaunchReel } from "./LaunchReel";
import { FPS, H, W } from "./theme";

export function Root() {
  return <Composition id="LaunchReel" component={LaunchReel} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={W} height={H} />;
}
