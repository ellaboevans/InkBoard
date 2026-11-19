import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Blueprint } from "../components/Stage";
import { C } from "../theme";
import { Captions, ChapterCard, Corners, Sweep } from "./components/Stage";
import { ColdOpen, Ending, FollowSection, PassageSection, PhotoSection, PrivateSection, ReadersSection, ShareSection, StatsSection, WritersSection } from "./scenes";
import { CHAPTERS, DURATION, f, SWEEP, T, type Chapter } from "./timeline";

export { DURATION };

/** The sections in order: before chapter 1 comes the cold open; after chapter 8, stats. */
const SECTIONS = [ColdOpen, ShareSection, PhotoSection, FollowSection, WritersSection, ReadersSection, PrivateSection, PassageSection, StatsSection];

function Card({ c }: { c: Chapter }) {
  return (
    <>
      <Blueprint />
      <ChapterCard c={c} />
      <Corners right={`Chapter ${c.n} of ${CHAPTERS.length}`} dark />
    </>
  );
}

export function WhatsNew() {
  const frame = useCurrentFrame();
  const t = frame / 30;
  let body: React.ReactNode = null;
  const endAt = T("end") - 0.25;
  if (t >= endAt) {
    body = <Sweep at={endAt} dir="down" under={<StatsSection />} over={<Ending />} dur={0.45} />;
    if (t >= endAt + 0.5) body = <Ending />;
  } else {
    for (let i = 0; i < CHAPTERS.length; i++) {
      const c = CHAPTERS[i];
      const Before = SECTIONS[i];
      const After = SECTIONS[i + 1];
      if (t < c.at) { body = <Before />; break; }
      if (t < c.at + SWEEP) { body = <Sweep at={c.at} dir="down" under={<Before />} over={<Card c={c} />} />; break; }
      if (t < c.end - SWEEP) { body = <Card c={c} />; break; }
      if (t < c.end) { body = <Sweep at={c.end - SWEEP} dir="up" under={<Card c={c} />} over={<After />} />; break; }
      if (i === CHAPTERS.length - 1) body = <After />;
    }
  }
  void f;
  return (
    <AbsoluteFill style={{ background: C.canvas, overflow: "hidden" }}>
      {body}
      <Captions />
    </AbsoluteFill>
  );
}
