import React from "react";
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { C, MONO } from "../../theme";
import { FPS } from "../theme";
import { f, track, type Key } from "../timeline";

/** Screen sizes in CSS px (the captures are 2× and 3× of these). */
export const BROWSER = { w: 1440, h: 900, s: 0.88, top: 156, bar: 40 };
export const PHONE = { w: 390, h: 844, s: 0.94, top: 128 };

export type Enter = "cut" | "fade" | "slideUp" | "slideLeft" | "pop" | "reveal" | { scroll: number };
export type Layer = { src?: string; node?: React.ReactNode; at: number; enter?: Enter; dur?: number; origin?: [number, number] };
export type Cam = Key & Partial<{ z: number; fx: number; fy: number; ax: number; ay: number }>;
export type Pose = Key & Partial<{ rz: number; ry: number; x: number; y: number; s: number; o: number }>;
/** A cursor stop (screen CSS px): the pointer arrives at `at`, and clicks there if `click`. */
export type Stop = { at: number; x: number; y: number; click?: boolean };
export type Tap = { at: number; x: number; y: number };

const ease = Easing.bezier(0.2, 0.7, 0.2, 1);

function LayerView({ layer, frame, next, w, h }: { layer: Layer; frame: number; next?: Layer; w: number; h: number }) {
  const t0 = f(layer.at);
  const dur = Math.max(1, f(layer.dur ?? 0.3));
  const p = interpolate(frame, [t0, t0 + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const enter = layer.enter ?? "cut";
  let style: React.CSSProperties = {};
  if (enter === "fade") style = { opacity: p };
  if (enter === "slideUp") style = { transform: `translateY(${(1 - p) * h}px)`, boxShadow: "0 -20px 40px rgba(38,29,23,.16)" };
  if (enter === "slideLeft") style = { transform: `translateX(${(1 - p) * w}px)`, boxShadow: "-20px 0 40px rgba(38,29,23,.16)" };
  if (enter === "reveal") style = { clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` };
  if (typeof enter === "object") style = { transform: `translateY(${(1 - p) * enter.scroll}px)` };
  if (enter === "pop") {
    const k = spring({ frame: frame - t0, fps: FPS, config: { damping: 14, stiffness: 180 } });
    const [ox, oy] = layer.origin ?? [w / 2, h / 2];
    style = { transform: `scale(${0.3 + 0.7 * k})`, transformOrigin: `${ox}px ${oy}px`, opacity: Math.min(1, k * 2.5) };
  }
  if (next && frame >= f(next.at)) {
    const q = interpolate(frame, [f(next.at), f(next.at) + Math.max(1, f(next.dur ?? 0.3))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
    if (next.enter === "slideUp") style = { ...style, transform: `translateY(${-q * 140}px)`, filter: `brightness(${1 - q * 0.1})` };
    if (next.enter === "slideLeft") style = { ...style, transform: `translateX(${-q * 160}px)`, filter: `brightness(${1 - q * 0.1})` };
    if (typeof next.enter === "object") style = { ...style, transform: `translateY(${-q * next.enter.scroll}px)` };
  }
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", ...style }}>
      {layer.src ? <Img src={staticFile(`captures/wn/${layer.src}`)} style={{ width: w, height: h, display: "block" }} /> : layer.node}
    </div>
  );
}

function Ripple({ at, x, y, frame }: { at: number; x: number; y: number; frame: number }) {
  const t = frame - f(at);
  if (t < 0 || t > f(0.6)) return null;
  const r = interpolate(t, [0, f(0.5)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <div style={{ position: "absolute", left: x - 10, top: y - 10, width: 20, height: 20, borderRadius: 99, border: `3px solid ${C.red}`, background: "rgba(133,46,44,.14)", opacity: 1 - r, transform: `scale(${1 + r * 2.4})` }} />;
}

function TapDot({ tap, frame }: { tap: Tap; frame: number }) {
  const t = frame - f(tap.at);
  if (t < -f(0.22) || t > f(0.6)) return null;
  const press = interpolate(t, [-f(0.22), -f(0.05), f(0.12), f(0.3)], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", left: tap.x - 17, top: tap.y - 17, width: 34, height: 34, borderRadius: 99, background: "rgba(38,29,23,.26)", border: "2px solid rgba(255,255,255,.9)", opacity: press }} />
      <Ripple at={tap.at} x={tap.x} y={tap.y} frame={frame} />
    </>
  );
}

/** The pointer: eased moves between stops, a small press on each click. */
function Cursor({ stops, frame }: { stops: Stop[]; frame: number }) {
  if (!stops.length) return null;
  const t = frame / FPS;
  if (t < stops[0].at - 0.6) return null;
  let x = stops[0].x, y = stops[0].y;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const move = Math.min(0.6, Math.max(0.15, b.at - a.at - 0.1));
    const p = interpolate(t, [b.at - move, b.at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
    if (t >= b.at - move) {
      x = a.x + (b.x - a.x) * p;
      y = a.y + (b.y - a.y) * p;
    }
  }
  const press = stops.some((s) => s.click && t >= s.at - 0.06 && t <= s.at + 0.1);
  const enter = interpolate(t, [stops[0].at - 0.6, stops[0].at - 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      {stops.filter((s) => s.click).map((s, i) => <Ripple key={i} at={s.at} x={s.x} y={s.y} frame={frame} />)}
      <div style={{ position: "absolute", left: x, top: y, opacity: enter, transform: `scale(${press ? 0.88 : 1})`, transformOrigin: "3px 2px" }}>
        <svg width="26" height="30" viewBox="0 0 26 30" style={{ position: "absolute", left: -3, top: -2, filter: "drop-shadow(0 1.5px 2px rgba(40,25,15,.4))" }}>
          <path d="M3 2 L3 24 L8.6 18.8 L12.4 27.4 L16.4 25.6 L12.7 17.3 L20.4 17 Z" fill="#231a15" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </div>
    </>
  );
}

const CAM0 = { z: 1, fx: 0, fy: 0, ax: 0, ay: 0 };
const POSE0 = { rz: 0, ry: 0, x: 0, y: 0, s: 1, o: 1 };

/**
 * A floating card: a browser (a plain bar with the page's address, no real chrome) or a phone.
 * Camera keys zoom on a screen point (fx, fy) and carry it to a frame point (ax, ay).
 */
export function Device({
  kind,
  url = "",
  layers,
  cam = [],
  pose = [],
  cursor = [],
  taps = [],
  cx = 960,
  children,
  dark = false,
}: {
  kind: "browser" | "phone";
  url?: string;
  layers: Layer[];
  cam?: Cam[];
  pose?: Pose[];
  cursor?: Stop[];
  taps?: Tap[];
  cx?: number;
  children?: React.ReactNode;
  dark?: boolean;
}) {
  const frame = useCurrentFrame();
  const d = kind === "browser" ? BROWSER : PHONE;
  const left = cx - (d.w * d.s) / 2;
  const rest = (x: number, y: number) => ({ x: left + x * d.s, y: d.top + y * d.s });
  const home = rest(d.w / 2, d.h / 2);
  const c = track(frame, cam, ["z", "fx", "fy", "ax", "ay"], { ...CAM0, fx: d.w / 2, fy: d.h / 2, ax: home.x, ay: home.y });
  const p = track(frame, pose, ["rz", "ry", "x", "y", "s", "o"], POSE0);
  const r = rest(c.fx, c.fy);
  const visible = layers.filter((l, i) => frame >= f(l.at) && (i + 1 >= layers.length || frame < f(layers[i + 1].at) + f(layers[i + 1].dur ?? 0.3) + 1));
  const radius = (kind === "browser" ? 20 : 26) / d.s;
  const bar = kind === "browser" ? BROWSER.bar : 0;
  if (p.o <= 0.001) return null;
  // The top band keeps the corner labels and the tag readable: the stage fades out under them.
  const mask = "linear-gradient(to bottom, transparent 66px, black 118px)";
  return (
    <div style={{ position: "absolute", inset: 0, WebkitMaskImage: mask, maskImage: mask }}>
    <div style={{ position: "absolute", inset: 0, transformOrigin: `${r.x}px ${r.y}px`, transform: `translate(${c.ax - r.x}px, ${c.ay - r.y}px) scale(${c.z})`, opacity: Math.min(1, p.o) }}>
      <div style={{ position: "absolute", left, top: d.top - bar * d.s, width: d.w, height: d.h + bar, transformOrigin: "0 0", transform: `scale(${d.s})` }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "50% 50%",
            transform: `perspective(2200px) translate(${p.x / d.s}px, ${p.y / d.s}px) rotateY(${p.ry}deg) rotateZ(${p.rz}deg) scale(${p.s})`,
            borderRadius: radius,
            boxShadow: `0 ${30 / d.s}px ${64 / d.s}px rgba(38,29,23,${dark ? 0.5 : 0.26}), 0 ${8 / d.s}px ${20 / d.s}px rgba(38,29,23,0.16)`,
            background: C.paper,
          }}
        >
          {kind === "browser" && (
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bar, borderRadius: `${radius}px ${radius}px 0 0`, background: "#efe7da", borderBottom: "1px solid rgba(38,29,23,.1)", display: "flex", alignItems: "center", padding: "0 18px", gap: 9 }}>
              {["#d9cdbd", "#d9cdbd", "#d9cdbd"].map((col, i) => <div key={i} style={{ width: 13, height: 13, borderRadius: 99, background: col }} />)}
              <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <div style={{ minWidth: 420, padding: "5px 18px", borderRadius: 99, background: "rgba(253,250,244,.9)", fontFamily: MONO, fontSize: 15, color: C.muted, textAlign: "center", letterSpacing: 0.3 }}>{url}</div>
              </div>
              <div style={{ width: 57 }} />
            </div>
          )}
          <div style={{ position: "absolute", left: 0, top: bar, width: d.w, height: d.h, borderRadius: kind === "browser" ? `0 0 ${radius}px ${radius}px` : radius, overflow: "hidden", background: C.paper }}>
            {visible.map((l) => {
              const i = layers.indexOf(l);
              return <LayerView key={i} layer={l} frame={frame} next={layers[i + 1]} w={d.w} h={d.h} />;
            })}
            {children}
            {taps.map((t, i) => <TapDot key={i} tap={t} frame={frame} />)}
            <Cursor stops={cursor} frame={frame} />
          </div>
          <div style={{ position: "absolute", inset: -1.2 / d.s, borderRadius: radius + 1 / d.s, border: `${1.6 / d.s}px solid rgba(255,255,255,0.75)`, boxShadow: `0 0 0 ${1 / d.s}px rgba(38,29,23,0.15)`, pointerEvents: "none" }} />
        </div>
      </div>
    </div>
    </div>
  );
}

/** A floating picture (a share image or a cover) with the same card treatment. */
export function Picture({ src, at, w, ratio, cx, cy, rot = 0, out, from }: { src: string; at: number; w: number; ratio: number; cx: number; cy: number; rot?: number; out?: number; from?: [number, number] }) {
  const frame = useCurrentFrame();
  if (frame < f(at) || (out !== undefined && frame > f(out) + 12)) return null;
  const k = spring({ frame: frame - f(at), fps: FPS, config: { damping: 14, stiffness: 180 } });
  const o = out !== undefined ? interpolate(frame, [f(out), f(out) + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const h = w * ratio;
  const [fx, fy] = from ?? [cx, cy + 60];
  const x = fx + (cx - fx) * k;
  const y = fy + (cy - fy) * k;
  return (
    <div style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, borderRadius: 18, overflow: "hidden", opacity: Math.min(1, k * 2.5) * o, transform: `rotate(${rot * k}deg) scale(${0.7 + 0.3 * k})`, boxShadow: "0 30px 64px rgba(38,29,23,.28), 0 8px 20px rgba(38,29,23,.16), 0 0 0 1.5px rgba(255,255,255,.75)" }}>
      <Img src={staticFile(`captures/wn/${src}`)} style={{ width: w, height: h, display: "block" }} />
    </div>
  );
}
