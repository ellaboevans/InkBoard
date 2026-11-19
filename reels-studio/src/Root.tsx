import React from "react";
import { Composition } from "remotion";
import "./fonts";
import { DURATION, LaunchReel } from "./LaunchReel";
import { FPS, H, W } from "./theme";
import * as WN from "./whatsnew/theme";
import { DURATION as WN_DURATION, WhatsNew } from "./whatsnew/WhatsNew";

export function Root() {
  return (
    <>
      <Composition id="LaunchReel" component={LaunchReel} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={W} height={H} />
      <Composition id="WhatsNew" component={WhatsNew} durationInFrames={Math.round(WN_DURATION * WN.FPS)} fps={WN.FPS} width={WN.W} height={WN.H} />
    </>
  );
}
