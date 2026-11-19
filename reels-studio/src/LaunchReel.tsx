import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Captions, Sweep } from "./components/Stage";
import { AllScene, FollowScene, HookScene, LockupScene, NovelsStage, PassageStage, PrivateScene, ShareScene, WriteScene } from "./scenes/Scenes";
import { C } from "./theme";
import { f } from "./timeline";

/** Which scene owns which seconds; the two sweeps show both of their scenes. */
const PLAN: { from: number; to: number; render: () => React.ReactNode }[] = [
  { from: 0, to: 3.0, render: () => <HookScene /> },
  { from: 3.0, to: 9.0, render: () => <WriteScene /> },
  { from: 9.0, to: 14.5, render: () => <ShareScene /> },
  { from: 14.5, to: 15.0, render: () => <Sweep at={14.5} dir="down" under={<ShareScene />} over={<NovelsStage />} /> },
  { from: 15.0, to: 20.0, render: () => <NovelsStage /> },
  { from: 20.0, to: 20.5, render: () => <Sweep at={20.0} dir="up" under={<NovelsStage />} over={<PassageStage />} /> },
  { from: 20.5, to: 23.0, render: () => <PassageStage /> },
  { from: 23.0, to: 25.5, render: () => <PrivateScene /> },
  { from: 25.5, to: 28.0, render: () => <FollowScene /> },
  { from: 28.0, to: 31.0, render: () => <AllScene /> },
  { from: 31.0, to: 35.0, render: () => <LockupScene /> },
];

export const DURATION = 35.0;

export function LaunchReel() {
  const frame = useCurrentFrame();
  const scene = PLAN.find((s) => frame >= f(s.from) && frame < f(s.to)) ?? PLAN[PLAN.length - 1];
  return (
    <AbsoluteFill style={{ background: C.canvas, overflow: "hidden" }}>
      {scene.render()}
      <Captions />
    </AbsoluteFill>
  );
}
