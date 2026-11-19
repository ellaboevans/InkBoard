import React from "react";
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { C, FPS } from "../theme";
import { f, track, type Key } from "../timeline";

/** The phone's screen in CSS px (the captures are 390 × 844 at 3×). */
export const SW = 390;
export const SH = 844;
/** Frame px per CSS px at rest, and where the card rests. */
export const S = 1.62;
export const REST = { left: 540 - (SW * S) / 2, top: 236 };
export const restPoint = (x: number, y: number) => ({ x: REST.left + x * S, y: REST.top + y * S });

export type Enter = "cut" | "fade" | "slideUp" | "slideLeft" | "pop" | "reveal" | { scroll: number };
export type Layer = { src?: string; node?: React.ReactNode; at: number; enter?: Enter; dur?: number; origin?: [number, number] };

/** Camera: zoom z on the screen point (fx, fy), carried to the frame point (ax, ay). */
export type Cam = Key & Partial<{ z: number; fx: number; fy: number; ax: number; ay: number }>;
/** The card's own pose: tilt (degrees), offset (frame px), scale, opacity. */
export type Pose = Key & Partial<{ rz: number; ry: number; rx: number; x: number; y: number; s: number; o: number }>;
export type Tap = { at: number; x: number; y: number };

const CAM0 = { z: 1, fx: SW / 2, fy: SH / 2, ax: 540, ay: REST.top + (SH / 2) * S };
const POSE0 = { rz: 0, ry: 0, rx: 0, x: 0, y: 0, s: 1, o: 1 };

function LayerView({ layer, frame, next }: { layer: Layer; frame: number; next?: Layer }) {
  const t0 = f(layer.at);
  const dur = f(layer.dur ?? 0.28);
  const p = interpolate(frame, [t0, t0 + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.7, 0.2, 1) });
  const enter = layer.enter ?? "cut";
  let style: React.CSSProperties = {};
  if (enter === "fade") style = { opacity: p };
  if (enter === "slideUp") style = { transform: `translateY(${(1 - p) * SH}px)`, boxShadow: "0 -20px 40px rgba(38,29,23,.18)" };
  if (enter === "slideLeft") style = { transform: `translateX(${(1 - p) * SW}px)`, boxShadow: "-20px 0 40px rgba(38,29,23,.18)" };
  if (enter === "reveal") style = { clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` };
  if (typeof enter === "object") style = { transform: `translateY(${(1 - p) * enter.scroll}px)` };
  if (enter === "pop") {
    const k = spring({ frame: frame - t0, fps: FPS, config: { damping: 14, stiffness: 180 } });
    const [ox, oy] = layer.origin ?? [SW / 2, SH / 2];
    style = { transform: `scale(${0.28 + 0.72 * k})`, transformOrigin: `${ox}px ${oy}px`, opacity: Math.min(1, k * 2.5), borderRadius: 20 * (1 - k) };
  }
  // The layer being replaced moves out of the way.
  if (next && frame >= f(next.at)) {
    const q = interpolate(frame, [f(next.at), f(next.at) + f(next.dur ?? 0.28)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.7, 0.2, 1) });
    if (next.enter === "slideUp") style = { ...style, transform: `translateY(${-q * 140}px)`, filter: `brightness(${1 - q * 0.12})` };
    if (next.enter === "slideLeft") style = { ...style, transform: `translateX(${-q * 120}px)`, filter: `brightness(${1 - q * 0.12})` };
    if (typeof next.enter === "object") style = { ...style, transform: `translateY(${-q * next.enter.scroll}px)` };
  }
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", ...style }}>
      {layer.src ? <Img src={staticFile(`captures/${layer.src}`)} style={{ width: SW, height: SH, display: "block" }} /> : layer.node}
    </div>
  );
}

export function TapMark({ tap, frame }: { tap: Tap; frame: number }) {
  const t = frame - f(tap.at);
  if (t < -f(0.22) || t > f(0.6)) return null;
  const press = interpolate(t, [-f(0.22), -f(0.05), f(0.12), f(0.3)], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ring = interpolate(t, [0, f(0.5)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <>
      <div style={{ position: "absolute", left: tap.x - 17, top: tap.y - 17, width: 34, height: 34, borderRadius: 99, background: "rgba(38,29,23,.26)", border: "2px solid rgba(255,255,255,.9)", opacity: press, transform: `scale(${0.8 + press * 0.2})` }} />
      {t >= 0 && (
        <div style={{ position: "absolute", left: tap.x - 10, top: tap.y - 10, width: 20, height: 20, borderRadius: 99, border: `3px solid ${C.red}`, background: "rgba(133,46,44,.14)", opacity: 1 - ring, transform: `scale(${1 + ring * 2.6})` }} />
      )}
    </>
  );
}

export function Phone({
  layers,
  cam = [],
  pose = [],
  taps = [],
  children,
  dark = false,
}: {
  layers: Layer[];
  cam?: Cam[];
  pose?: Pose[];
  taps?: Tap[];
  children?: React.ReactNode;
  dark?: boolean;
}) {
  const frame = useCurrentFrame();
  const c = track(frame, cam, ["z", "fx", "fy", "ax", "ay"], CAM0);
  const p = track(frame, pose, ["rz", "ry", "rx", "x", "y", "s", "o"], POSE0);
  const r = restPoint(c.fx, c.fy);
  const visible = layers.map((l, i) => ({ l, i })).filter(({ l }, i) => frame >= f(l.at) && (i + 1 >= layers.length || frame < f(layers[i + 1].at) + f(layers[i + 1].dur ?? 0.28) + 1));
  const radius = 26 / S;
  // The top band keeps the corner labels and tags readable: the stage fades out under them.
  const mask = "linear-gradient(to bottom, transparent 196px, black 262px)";
  return (
    <div style={{ position: "absolute", inset: 0, WebkitMaskImage: mask, maskImage: mask }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        transformOrigin: `${r.x}px ${r.y}px`,
        transform: `translate(${c.ax - r.x}px, ${c.ay - r.y}px) scale(${c.z})`,
        opacity: p.o,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: REST.left,
          top: REST.top,
          width: SW,
          height: SH,
          transformOrigin: "0 0",
          transform: `scale(${S})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "50% 50%",
            transform: `perspective(1400px) translate(${p.x / S}px, ${p.y / S}px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotateZ(${p.rz}deg) scale(${p.s})`,
            borderRadius: radius,
            boxShadow: `0 ${34 / S}px ${70 / S}px rgba(38,29,23,${dark ? 0.55 : 0.3}), 0 ${10 / S}px ${22 / S}px rgba(38,29,23,0.18)`,
          }}
        >
          <div style={{ position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden", background: C.paper }}>
            {visible.map(({ l, i }) => (
              <LayerView key={i} layer={l} frame={frame} next={layers[i + 1]} />
            ))}
            {children}
            {taps.map((t, i) => (
              <TapMark key={i} tap={t} frame={frame} />
            ))}
          </div>
          {/* Thin glassy border: a light inner edge and a faint dark outer one. */}
          <div
            style={{
              position: "absolute",
              inset: -1.2 / S,
              borderRadius: radius + 1 / S,
              border: `${1.6 / S}px solid rgba(255,255,255,0.75)`,
              boxShadow: `0 0 0 ${1 / S}px rgba(38,29,23,0.16), inset 0 0 0 ${1 / S}px rgba(255,255,255,0.35)`,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
    </div>
  );
}
