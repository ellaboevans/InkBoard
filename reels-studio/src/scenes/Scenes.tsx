import React from "react";
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { Phone, S, SH, SW, type Layer } from "../components/Phone";
import { Blueprint, Corners, Paper, Tag } from "../components/Stage";
import { C, FPS, MONO, SANS, SERIF } from "../theme";
import { f } from "../timeline";

const cap = (src: string, at: number, enter?: Layer["enter"], dur?: number): Layer => ({ src, at, enter, dur });
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.bezier(0.2, 0.7, 0.2, 1)) =>
  interpolate(frame, [f(a), f(b)], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });
const spr = (frame: number, at: number, config = { damping: 14, stiffness: 180 }) => spring({ frame: frame - f(at), fps: FPS, config });

/** Copy a small patch of one capture onto another (CSS px), e.g. a box before it was ticked. */
function Patch({ src, from, to }: { src: string; from: [number, number, number, number]; to: [number, number] }) {
  const [x, y, w, h] = from;
  return (
    <div
      style={{
        position: "absolute",
        left: to[0],
        top: to[1],
        width: w,
        height: h,
        backgroundImage: `url(${staticFile(`captures/${src}`)})`,
        backgroundSize: `${SW}px ${SH}px`,
        backgroundPosition: `${-x}px ${-y}px`,
      }}
    />
  );
}

/** A number counting up, drawn over the capture's own number in the same face. */
function Count({ at, showFrom, dur, to, from = 0, box, font, size, align = "left", suffix = "", bg = C.card, color = C.ink }: {
  at: number; showFrom?: number; dur: number; to: number; from?: number; box: [number, number, number, number]; font: string; size: number; align?: "left" | "right"; suffix?: string; bg?: string; color?: string;
}) {
  const frame = useCurrentFrame();
  if (frame < f(showFrom ?? at) || frame >= f(at + dur) + 2) return null;
  const n = Math.round(ease(frame, at, at + dur, from, to, Easing.out(Easing.cubic)));
  const [x, y, w, h] = box;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: bg, fontFamily: font, fontSize: size, lineHeight: `${h}px`, color, textAlign: align, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      {n}
      {suffix}
    </div>
  );
}

/* ---------------------------------------------------------------- 0–3.0 */

function WhipStrip({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const shots = ["board-odalys.png", "board-juniper.png", "board-ama.png", "board-selorm.png"];
  const dist = (shots.length - 1) * SW;
  const e = Easing.bezier(0.55, 0, 0.25, 1);
  const p = ease(frame, at, at + 0.58, 0, 1, e);
  const p1 = ease(frame + 1, at, at + 0.58, 0, 1, e);
  const v = (p1 - p) * dist; // px per frame
  const blur = Math.min(32, v * 0.42);
  const id = `whip-${Math.round(at * 100)}`;
  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} x="-10%" y="0" width="120%" height="100%">
          <feGaussianBlur stdDeviation={`${blur} 0`} />
        </filter>
      </svg>
      <div style={{ position: "absolute", top: 0, left: 0, width: SW * shots.length, height: SH, transform: `translateX(${-p * dist}px) skewX(${-Math.min(9, v * 0.09)}deg)`, filter: blur > 0.3 ? `url(#${id})` : undefined }}>
        {shots.map((s, i) => (
          <Img key={s} src={staticFile(`captures/${s}`)} style={{ position: "absolute", left: i * SW, top: 0, width: SW, height: SH }} />
        ))}
      </div>
    </div>
  );
}

export function HookScene() {
  return (
    <>
      <Paper />
      <Phone
        layers={[cap("board-selorm.png", 0), { node: <WhipStrip at={1.5} />, at: 1.5 }, { src: "overlay-ndi.png", at: 2.1, enter: "pop", origin: [195, 421] }]}
        cam={[
          { at: 0.1, z: 1.55, fx: 195, fy: 421, ax: 540, ay: 860 },
          { at: 1.5, snap: true, z: 1, fx: 195, fy: 422, ay: 236 + 422 * S },
          { at: 2.12, z: 1.25, fx: 195, fy: 560, ay: 760 },
        ]}
        pose={[
          { at: 0, snap: true, rz: -2.5 },
          { at: 1.5, rz: 1.5, ry: -6, config: { damping: 12, stiffness: 120 } },
          { at: 2.1, rz: -1, ry: 0 },
        ]}
        taps={[{ at: 2.02, x: 195, y: 400 }]}
      />
      <Corners left="InkBoard · launch" right="01 · board" />
      <Tag items={[{ at: 0, text: "EWE · ŊDI · wò, xɔ̃nye" }, { at: 1.5, text: "14 AUTHORS · ONE BOARD" }, { at: 2.1, text: "READING · ŊDI" }]} />
    </>
  );
}

/* ---------------------------------------------------------------- 3.0–9.0 */

export function WriteScene() {
  const frame = useCurrentFrame();
  const label = frame < f(5) ? "02 · sign in" : frame < f(7.45) ? "03 · write" : "04 · publish";
  return (
    <>
      <Paper drift={200} />
      <Phone
        layers={[
          cap("signin-code-0.png", 3.0),
          cap("signin-code-1.png", 3.62),
          cap("signin-code-2.png", 3.76),
          cap("signin-code-3.png", 3.9),
          cap("signin-code-4.png", 4.04),
          cap("signin-code-5.png", 4.18),
          cap("signin-code-6.png", 4.32),
          cap("signin-done.png", 4.62, "fade", 0.18),
          cap("editor-0.png", 5.0, "slideUp", 0.32),
          cap("editor-1.png", 5.42),
          cap("editor-2.png", 5.8),
          cap("editor-3.png", 6.12),
          cap("editor-4.png", 6.44),
          cap("editor-5.png", 6.76),
          cap("editor-6.png", 7.06, "fade", 0.12),
          cap("publish-0.png", 7.45, "slideUp", 0.3),
          cap("publish-toast.png", 8.1, "fade", 0.14),
        ]}
        cam={[
          { at: 3.3, z: 1.4, fx: 195, fy: 423, ax: 540, ay: 860 },
          { at: 4.62, z: 1.0, fy: 422, ay: 236 + 422 * S },
          { at: 5.05, z: 1.5, fx: 195, fy: 400, ay: 900 },
          { at: 7.45, z: 1.3, fy: 610, ay: 880 },
          { at: 7.98, z: 1.44 },
          { at: 8.16, z: 1.0, fy: 422, ay: 236 + 422 * S },
        ]}
        pose={[
          { at: 3.0, snap: true, rz: -9, ry: 32, x: 140, y: 160, s: 0.86, o: 0 },
          { at: 3.0, rz: -2, ry: 0, x: 0, y: 0, s: 1, o: 1 },
          { at: 5.0, rz: 1.2 },
          { at: 7.45, rz: -1.2 },
        ]}
        taps={[
          { at: 3.45, x: 195, y: 423 },
          { at: 5.38, x: 49, y: 545 },
          { at: 5.7, x: 49, y: 545 },
          { at: 6.4, x: 141, y: 545 },
          { at: 6.6, x: 95, y: 545 },
          { at: 6.72, x: 95, y: 545 },
          { at: 7.94, x: 195, y: 625 },
        ]}
      />
      <Corners left="InkBoard · launch" right={label} />
      <Tag
        items={[
          { at: 3.0, text: "SIGN IN · EMAIL CODE" },
          { at: 4.62, text: "SIGNED IN · ABLA DZIFA" },
          { at: 5.0, text: "GA LETTERS · ɛ ŋ ɔ" },
          { at: 6.44, text: "GA · Oyiwala dɔŋŋ" },
          { at: 7.45, text: "PUBLISH · AKWAABA" },
          { at: 8.1, text: "POEM PUBLISHED" },
        ]}
      />
    </>
  );
}

/* ---------------------------------------------------------------- 9.0–15.0 */

function StoryCard({ at }: { at: number }) {
  const frame = useCurrentFrame();
  if (frame < f(at)) return null;
  const k = spr(frame, at);
  const r = spr(frame, at + 0.12, { damping: 14, stiffness: 120 });
  const w = 520;
  const h = (w * 1920) / 1080;
  const cx = interpolate(k, [0, 1], [540, 540]);
  const cy = interpolate(k, [0, 1], [930, 720]);
  const s = interpolate(k, [0, 1], [0.38, 1]);
  const pull = interpolate(frame, [f(at), f(at + 2.4)], [1.05, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: cx - w / 2,
        top: cy - h / 2,
        width: w,
        height: h,
        transform: `perspective(1600px) scale(${s * pull}) rotateZ(${-6 + 6 * r}deg) rotateY(${(1 - r) * -14}deg)`,
        borderRadius: 24,
        overflow: "hidden",
        boxShadow: "0 40px 80px rgba(38,29,23,.32), 0 12px 24px rgba(38,29,23,.18), 0 0 0 1.5px rgba(255,255,255,.7)",
        opacity: Math.min(1, k * 3),
      }}
    >
      <Img src={staticFile("captures/pic-akwaaba-page.png")} style={{ width: w, height: h, display: "block" }} />
    </div>
  );
}

function LinkChip({ at, text, y }: { at: number; text: string; y: number }) {
  const frame = useCurrentFrame();
  if (frame < f(at)) return null;
  const k = spr(frame, at, { damping: 15, stiffness: 240 });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 26px",
          borderRadius: 999,
          background: C.paper,
          border: "1.5px solid rgba(38,29,23,.16)",
          boxShadow: "0 12px 30px rgba(38,29,23,.18)",
          fontFamily: MONO,
          fontSize: 30,
          color: C.ink,
          transform: `translateY(${(1 - k) * 30}px) scale(${0.9 + 0.1 * k})`,
          opacity: Math.min(1, k * 2),
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {text}
      </div>
    </div>
  );
}

export function ShareScene() {
  const frame = useCurrentFrame();
  const label = frame < f(10) ? "05 · live" : frame < f(12) ? "06 · posters" : "07 · share";
  return (
    <>
      <Paper drift={400} />
      <Phone
        layers={[cap("board-akwaaba.png", 9.0), cap("share-page.png", 10.0, "slideLeft", 0.3), cap("share-ink.png", 10.68, "fade", 0.12), cap("share-board.png", 11.32, "fade", 0.12)]}
        cam={[
          { at: 9.0, snap: true, z: 1.6, fx: 195, fy: 421, ax: 540, ay: 860 },
          { at: 9.08, z: 1.0, fy: 422, ay: 236 + 422 * S },
          { at: 10.05, z: 1.3, fx: 195, fy: 300, ay: 800 },
          { at: 10.68, z: 1.4 },
          { at: 10.82, z: 1.3 },
          { at: 11.32, z: 1.4 },
          { at: 11.46, z: 1.3 },
          { at: 12.0, z: 1.0, fy: 422, ay: 236 + 422 * S },
        ]}
        pose={[
          { at: 9.0, snap: true, rz: 1.5 },
          { at: 12.0, s: 0.8, y: 420, rz: -4, o: 0 },
        ]}
        taps={[
          { at: 9.86, x: 195, y: 421 },
          { at: 10.6, x: 195, y: 430 },
          { at: 11.24, x: 300, y: 430 },
        ]}
      />
      <StoryCard at={12.05} />
      <LinkChip at={12.75} y={1206} text="tryinkboard.elabo.me/s/fp957s" />
      <Corners left="InkBoard · launch" right={label} />
      <Tag
        items={[
          { at: 9.0, text: "LIVE · ON THE BOARD" },
          { at: 10.0, text: "SHARE AS IMAGE · PAGE" },
          { at: 10.68, text: "SHARE AS IMAGE · INK" },
          { at: 11.32, text: "SHARE AS IMAGE · BOARD" },
          { at: 12.05, text: "STORY · 1080 × 1920" },
          { at: 12.75, text: "SHORT LINK · /s/fp957s" },
        ]}
      />
    </>
  );
}

/* ---------------------------------------------------------------- 14.5–20.5 (blueprint) */

const COVERS = [
  { src: "cover-odo-ne-ekaa.webp", dx: -270, rot: -13, dy: 40 },
  { src: "cover-the-ferry-at-yeji.webp", dx: 0, rot: 0, dy: 0 },
  { src: "cover-letters-to-the-lighthouse-keeper.webp", dx: 270, rot: 13, dy: 40 },
];

function CoverFan({ at, back }: { at: number; back: number }) {
  const frame = useCurrentFrame();
  const b = spr(frame, back, { damping: 16, stiffness: 140 });
  const w = 290;
  const h = w * 1.5;
  return (
    <div style={{ position: "absolute", inset: 0, transformOrigin: "540px 700px", transform: `translateY(${-300 * b}px) scale(${1 - 0.3 * b})`, opacity: 1 - 0.45 * b }}>
      {COVERS.map((c, i) => {
        const k = spr(frame, at + (i * 4) / FPS);
        return (
          <div
            key={c.src}
            style={{
              position: "absolute",
              left: 540 - w / 2 + c.dx * k,
              top: 690 - h / 2 + c.dy * k,
              width: w,
              height: h,
              transform: `rotate(${c.rot * k}deg) scale(${0.6 + 0.4 * k})`,
              opacity: Math.min(1, k * 2.5),
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 30px 60px rgba(0,0,0,.5), 0 0 0 2px rgba(190,220,250,.55)",
              zIndex: i === 1 ? 2 : 1,
            }}
          >
            <Img src={staticFile(`captures/${c.src}`)} style={{ width: w, height: h, display: "block" }} />
          </div>
        );
      })}
      {/* Blueprint dimension line under the middle cover. */}
      <div style={{ position: "absolute", left: 540 - w / 2, top: 690 + h / 2 + 34, width: w, opacity: ease(frame, at + 0.35, at + 0.6) }}>
        <div style={{ height: 2, background: "rgba(190,220,250,.8)" }} />
        <div style={{ position: "absolute", left: 0, top: -10, width: 2, height: 22, background: "rgba(190,220,250,.8)" }} />
        <div style={{ position: "absolute", right: 0, top: -10, width: 2, height: 22, background: "rgba(190,220,250,.8)" }} />
        <div style={{ marginTop: 12, marginLeft: -100, marginRight: -100, whiteSpace: "nowrap", textAlign: "center", fontFamily: MONO, fontSize: 21, letterSpacing: 2, color: C.blueprintInk }}>UPLOADED COVER · 2 : 3</div>
      </div>
    </div>
  );
}

export function NovelsStage() {
  const frame = useCurrentFrame();
  const label = frame < f(17.5) ? "08 · novels" : "09 · read";
  return (
    <>
      <Blueprint />
      <CoverFan at={14.7} back={16.15} />
      <Phone
        dark
        layers={[
          cap("novel-ferry.png", 14.5),
          cap("chapter-default.png", 17.5, "slideLeft", 0.3),
          cap("chapter-settings-open.png", 18.78, "fade", 0.12),
          cap("chapter-larger.png", 19.18, "fade", 0.16),
          cap("chapter-largest.png", 19.58, "fade", 0.16),
        ]}
        cam={[
          { at: 17.55, z: 1.6, fx: 125, fy: 290, ax: 540, ay: 860 },
          { at: 18.45, z: 1.3, fx: 250, fy: 230, ay: 760 },
        ]}
        pose={[
          { at: 14.5, snap: true, y: 1950, rz: 4 },
          { at: 16.15, y: 0, rz: -1.5, config: { damping: 14, stiffness: 150 } },
        ]}
        taps={[
          { at: 18.68, x: 360, y: 26 },
          { at: 19.08, x: 260, y: 112 },
          { at: 19.48, x: 337, y: 112 },
        ]}
      />
      <Corners left="InkBoard · x-ray" right={label} dark />
      <Tag
        dark
        items={[
          { at: 14.9, text: "NOVELS · UPLOADED COVERS" },
          { at: 16.15, text: "THE FERRY AT YEJI · 4 CHAPTERS" },
          { at: 17.5, text: "DROP CAP · CHAPTER 1" },
          { at: 18.78, text: "TEXT SIZE · DEFAULT" },
          { at: 19.18, text: "TEXT SIZE · LARGER" },
          { at: 19.58, text: "TEXT SIZE · LARGEST" },
        ]}
      />
    </>
  );
}


/* ---------------------------------------------------------------- 20.0–23.0 */

export function PassageStage() {
  const frame = useCurrentFrame();
  return (
    <>
      <Paper drift={700} />
      <Phone
        layers={[cap("passage-0.png", 20.0), cap("passage-1.png", 21.15, "fade", 0.1), { src: "passage-2.png", at: 21.62, enter: { scroll: 419 }, dur: 0.32 }]}
        cam={[
          { at: 20.55, z: 1.4, fx: 195, fy: 690, ax: 540, ay: 820 },
          { at: 21.62, fy: 271, config: { damping: 30, stiffness: 300 } },
        ]}
        pose={[{ at: 20.0, snap: true, rz: -1.5 }]}
        taps={[
          { at: 21.1, x: 59, y: 729 },
          { at: 22.05, x: 59, y: 421 },
        ]}
      >
        {frame >= f(21.62) && frame < f(22.08) && (
          <>
            <Patch src="passage-0.png" from={[46, 716, 26, 26]} to={[46, 408]} />
            <Patch src="passage-1.png" from={[30, 662, 200, 22]} to={[30, 242]} />
          </>
        )}
      </Phone>
      <Corners left="InkBoard · launch" right="10 · quote" />
      <Tag
        items={[
          { at: 20.0, text: "SHARE A PASSAGE" },
          { at: 21.15, text: "PASSAGE · 193 / 600" },
          { at: 22.05, text: (t) => `PASSAGE · ${Math.round(interpolate(t, [22.05, 22.6], [193, 344], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }))} / 600` },
        ]}
      />
    </>
  );
}


/* ---------------------------------------------------------------- 23.0–25.5 */

export function PrivateScene() {
  return (
    <>
      <Paper drift={900} />
      <Phone
        layers={[
          cap("private-novel.png", 23.0),
          cap("private-0.png", 23.85, "slideLeft", 0.28),
          cap("private-1.png", 24.2),
          cap("private-2.png", 24.42),
          cap("private-3.png", 24.64),
          cap("private-open.png", 24.98, "reveal", 0.45),
        ]}
        cam={[
          { at: 23.0, snap: true, z: 1.15, fx: 205, fy: 345, ax: 540, ay: 820 },
          { at: 23.04, z: 1.5 },
          { at: 23.85, z: 1.4, fx: 195, fy: 380 },
          { at: 24.98, z: 1.0, fy: 422, ay: 236 + 422 * S },
        ]}
        pose={[{ at: 23.0, snap: true, rz: 2.2 }, { at: 24.98, rz: -0.8 }]}
        taps={[
          { at: 24.0, x: 194, y: 426 },
          { at: 24.88, x: 194, y: 470 },
        ]}
      />
      <Corners left="InkBoard · launch" right="11 · private" />
      <Tag items={[{ at: 23.0, text: "PRIVATE NOVEL · LOCKED" }, { at: 23.85, text: "ONE PASSWORD · EVERY CHAPTER" }, { at: 24.98, text: "UNLOCKED · CHAPTER 1" }]} />
    </>
  );
}

/* ---------------------------------------------------------------- 25.5–28.0 */

function LockScreen({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const k = spr(frame, at, { damping: 15, stiffness: 200 });
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1b1511", backgroundImage: "radial-gradient(circle, rgba(216,208,195,.13) 1.3px, transparent 1.6px)", backgroundSize: "19px 19px", fontFamily: SANS, color: C.paper }}>
      <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", fontSize: 17, fontWeight: 500, opacity: 0.85 }}>Thursday 19 November</div>
      <div style={{ position: "absolute", top: 88, width: "100%", textAlign: "center", fontSize: 92, fontWeight: 300, letterSpacing: -2 }}>7:24</div>
      <div
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          top: 250,
          padding: "13px 14px",
          borderRadius: 22,
          background: "rgba(253,250,244,.95)",
          color: C.ink,
          display: "flex",
          gap: 12,
          transform: `translateY(${(1 - k) * -260}px) scale(${0.92 + 0.08 * k})`,
          opacity: Math.min(1, k * 2),
          boxShadow: "0 10px 30px rgba(0,0,0,.4)",
        }}
      >
        <Img src={staticFile("feather-tile.svg")} style={{ width: 40, height: 40, borderRadius: 10, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: C.muted }}>
            <span style={{ fontWeight: 600, color: C.ink }}>InkBoard</span>
            <span>now</span>
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 650, marginTop: 2, lineHeight: 1.25 }}>New chapter: The Ferry at Yeji, Chapter 4</div>
          <div style={{ fontSize: 15, marginTop: 2 }}>By Odalys Moon</div>
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 10, left: "50%", width: 134, height: 5, marginLeft: -67, borderRadius: 3, background: "rgba(253,250,244,.8)" }} />
    </div>
  );
}

export function FollowScene() {
  return (
    <>
      <Paper drift={1100} />
      <Phone
        dark
        layers={[{ node: <LockScreen at={25.82} />, at: 25.5 }, cap("stats.png", 26.55, "slideUp", 0.3)]}
        cam={[
          { at: 25.85, z: 1.2, fx: 195, fy: 300, ax: 540, ay: 760 },
          { at: 26.6, z: 1.22, fy: 420, ay: 236 + 422 * S },
        ]}
        pose={[
          { at: 25.5, snap: true, y: -1500, rz: -7 },
          { at: 25.5, y: 0, rz: -1.5 },
          { at: 26.55, rz: 1.5 },
        ]}
        taps={[{ at: 26.4, x: 195, y: 290 }]}
      >
        <Count at={26.75} showFrom={26.55} dur={0.75} to={128} box={[33, 167, 110, 40]} font={SERIF} size={36} />
        <Count at={26.9} showFrom={26.55} dur={0.8} to={684} box={[262, 645, 95, 20]} font={SANS} size={14} align="right" suffix=" visits" />
        <Count at={26.98} showFrom={26.55} dur={0.8} to={412} box={[262, 706, 95, 20]} font={SANS} size={14} align="right" suffix=" visits" />
        <Count at={27.06} showFrom={26.55} dur={0.8} to={351} box={[262, 767, 95, 20]} font={SANS} size={14} align="right" suffix=" visits" />
      </Phone>
      <Corners left="InkBoard · launch" right="12 · follow" />
      <Tag items={[{ at: 25.5, text: "NEW CHAPTER · TO FOLLOWERS" }, { at: 26.55, text: "STATS · ONLY YOU SEE THESE" }]} />
    </>
  );
}

/* ---------------------------------------------------------------- 28.0–31.0 */

const FAN = [
  { kind: "img", src: "pic-ndi-board.png", w: 330, ratio: 1920 / 1080, cx: 300, cy: 640, rot: -11, blur: 1.2 },
  { kind: "img", src: "pic-ferry-passage.png", w: 330, ratio: 1920 / 1080, cx: 728, cy: 690, rot: 8, blur: 0.8 },
  { kind: "img", src: "cover-the-ferry-at-yeji.webp", w: 270, ratio: 1.5, cx: 330, cy: 1110, rot: -6, blur: 0 },
  { kind: "img", src: "board-selorm.png", w: 330, ratio: SH / SW, cx: 640, cy: 1000, rot: 4, blur: 0 },
] as const;

export function AllScene() {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [f(28), f(31)], [1, 1.1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <Paper drift={1300} />
      <div style={{ position: "absolute", inset: 0, transformOrigin: "540px 850px", transform: `scale(${push})` }}>
        {FAN.map((c, i) => {
          const k = spr(frame, 28.0 + (i * 4) / FPS);
          const h = c.w * c.ratio;
          const x = interpolate(k, [0, 1], [540, c.cx]);
          const y = interpolate(k, [0, 1], [980, c.cy]);
          return (
            <div
              key={c.src}
              style={{
                position: "absolute",
                left: x - c.w / 2,
                top: y - h / 2,
                width: c.w,
                height: h,
                transform: `rotate(${c.rot * k}deg) scale(${0.45 + 0.55 * k})`,
                opacity: Math.min(1, k * 2.5),
                borderRadius: 20,
                overflow: "hidden",
                filter: c.blur ? `blur(${c.blur}px)` : undefined,
                boxShadow: `0 ${20 + i * 10}px ${44 + i * 16}px rgba(38,29,23,${0.18 + i * 0.05}), 0 0 0 1.5px rgba(255,255,255,.75)`,
              }}
            >
              <Img src={staticFile(`captures/${c.src}`)} style={{ width: c.w, height: h, display: "block" }} />
            </div>
          );
        })}
      </div>
      <Corners left="InkBoard · launch" right="13 · all" />
      <Tag items={[{ at: 28.0, text: "POEMS · NOVELS · PICTURES" }]} />
    </>
  );
}

/* ---------------------------------------------------------------- 31.0–35.0 */

function Stamp({ at }: { at: number }) {
  const frame = useCurrentFrame();
  if (frame < f(at)) return null;
  const k = spr(frame, at);
  const s = 1.6 - 0.6 * k;
  return (
    <div style={{ position: "absolute", left: 540 - 300, top: 640 - 100, width: 600, height: 200, transform: `rotate(-9deg) scale(${s})`, opacity: Math.min(0.94, k * 3), mixBlendMode: "multiply" }}>
      <svg width="600" height="200" viewBox="0 0 600 200">
        <filter id="ink" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.75" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <g filter="url(#ink)" fill="none" stroke={C.red}>
          <rect x="8" y="8" width="584" height="184" rx="18" strokeWidth="9" />
          <rect x="24" y="24" width="552" height="152" rx="10" strokeWidth="3" />
          <text x="300" y="132" textAnchor="middle" fill={C.red} stroke="none" fontFamily={SANS} fontWeight={850} fontSize="96" letterSpacing="10">
            INKBOARD
          </text>
        </g>
      </svg>
    </div>
  );
}

export function LockupScene() {
  const frame = useCurrentFrame();
  const card = spr(frame, 31.0, { damping: 16, stiffness: 200 });
  const impact = frame >= f(31.5) ? spr(frame, 31.5, { damping: 9, stiffness: 300 }) : 0;
  const bump = 1 - 0.025 * Math.sin(Math.min(1, impact) * Math.PI);
  const word = spr(frame, 32.0, { damping: 15, stiffness: 200 });
  const pill = spr(frame, 32.45, { damping: 14, stiffness: 180 });
  return (
    <>
      <Paper drift={1500} />
      <div
        style={{
          position: "absolute",
          left: 540 - 360,
          top: 640 - 230,
          width: 720,
          height: 460,
          borderRadius: 28,
          background: C.paper,
          boxShadow: "0 40px 90px rgba(38,29,23,.26), 0 12px 26px rgba(38,29,23,.14), 0 0 0 1.5px rgba(255,255,255,.8)",
          transform: `translateY(${(1 - card) * 120}px) scale(${(0.92 + 0.08 * card) * bump}) rotate(1.5deg)`,
          opacity: Math.min(1, card * 2),
          padding: "54px 60px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 70, color: C.ink, lineHeight: 1 }}>Ŋdi</div>
        <div style={{ width: 70, height: 3, background: C.red, margin: "26px 0 28px", opacity: 0.7 }} />
        <div style={{ fontFamily: SERIF, fontSize: 44, lineHeight: 1.35, color: C.ink }}>
          Ŋdi na wò, xɔ̃nye.
          <br />
          Dzidzɔ na wò.
        </div>
        <div style={{ fontFamily: SANS, fontSize: 26, color: C.muted, marginTop: 30 }}>Selorm Agbɔ · in Ewe</div>
      </div>
      <Stamp at={31.35} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 965, display: "flex", justifyContent: "center", alignItems: "center", gap: 26, opacity: Math.min(1, word * 2), transform: `translateY(${(1 - word) * 40}px)` }}>
        <Img src={staticFile("feather-tile.svg")} style={{ width: 104, height: 104 }} />
        <div style={{ fontFamily: SERIF, fontWeight: 650, fontSize: 120, letterSpacing: -2, color: C.ink, lineHeight: 1 }}>InkBoard</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1170, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            padding: "18px 46px 20px",
            borderRadius: 999,
            background: C.red,
            color: C.onRed,
            textAlign: "center",
            boxShadow: "0 16px 36px rgba(133,46,44,.35)",
            transform: `scale(${0.7 + 0.3 * pill})`,
            opacity: Math.min(1, pill * 2),
          }}
        >
          <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: 44, lineHeight: 1.15 }}>Start writing free</div>
          <div style={{ fontFamily: MONO, fontSize: 29, letterSpacing: 0.5, opacity: 0.92, marginTop: 4 }}>tryinkboard.elabo.me</div>
        </div>
      </div>
      <Corners left="InkBoard · launch" right="14 · start" />
    </>
  );
}
