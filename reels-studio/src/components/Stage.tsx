import React from "react";
import { Easing, interpolate, spring, useCurrentFrame } from "remotion";
import { C, CAPTION_Y, FPS, H, MONO, SANS, W } from "../theme";
import { f, LINES } from "../timeline";

/** InkBoard's board: canvas with a dot grid, drifting slowly. */
export function Paper({ drift = 0 }: { drift?: number }) {
  const frame = useCurrentFrame();
  const d = frame * 0.12 + drift;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: C.canvas,
        backgroundImage: `radial-gradient(circle, ${C.dot} 2.6px, transparent 3.1px)`,
        backgroundSize: "38px 38px",
        backgroundPosition: `${-d * 0.4}px ${-d}px`,
      }}
    />
  );
}

/** The X-ray stage: deep ink blue, a fine and a coarse grid, and dots at the crossings. */
export function Blueprint() {
  const frame = useCurrentFrame();
  const d = frame * 0.12;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: C.blueprint,
        backgroundImage: [
          `radial-gradient(circle, rgba(170,205,245,.32) 2px, transparent 2.6px)`,
          `linear-gradient(${C.blueprintLine} 1.5px, transparent 1.5px)`,
          `linear-gradient(90deg, ${C.blueprintLine} 1.5px, transparent 1.5px)`,
          `linear-gradient(${C.blueprintFine} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${C.blueprintFine} 1px, transparent 1px)`,
        ].join(","),
        backgroundSize: "114px 114px, 114px 114px, 114px 114px, 19px 19px, 19px 19px",
        backgroundPosition: `${-d * 0.4 - 57}px ${-d - 57}px, ${-d * 0.4}px ${-d}px, ${-d * 0.4}px ${-d}px, ${-d * 0.4}px ${-d}px, ${-d * 0.4}px ${-d}px`,
      }}
    >
      {/* A soft vignette keeps the eye in the middle. */}
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 260px rgba(4,10,20,.55)" }} />
    </div>
  );
}

/**
 * The sweep: a bright bar travels across the stage; `under` shows where it
 * hasn't been, `over` where it has. down: top → bottom; up: bottom → top.
 */
export function Sweep({ at, dur = 0.5, dir, under, over }: { at: number; dur?: number; dir: "down" | "up"; under: React.ReactNode; over: React.ReactNode }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [f(at), f(at + dur)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const y = dir === "down" ? -60 + p * (H + 120) : H + 60 - p * (H + 120);
  const clip = dir === "down" ? `inset(0 0 ${Math.max(0, H - y)}px 0)` : `inset(${Math.max(0, y)}px 0 0 0)`;
  return (
    <>
      <div style={{ position: "absolute", inset: 0 }}>{under}</div>
      <div style={{ position: "absolute", inset: 0, clipPath: clip }}>{over}</div>
      {p > 0 && p < 1 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: y - 3, height: 6, background: "#eef6ff", boxShadow: "0 0 18px 6px rgba(190,225,255,.85), 0 0 90px 30px rgba(140,190,240,.45)" }}>
          <div style={{ position: "absolute", right: 210, top: -36, fontFamily: MONO, fontSize: 19, letterSpacing: 2, color: "#eef6ff" }}>X-RAY · {dir === "down" ? "ON" : "OFF"}</div>
        </div>
      )}
    </>
  );
}

/** Tiny monospace labels in the top corners (the right one stops short of the right-hand 15%). */
export function Corners({ left, right, dark = false }: { left: string; right: string; dark?: boolean }) {
  const color = dark ? "rgba(207,226,247,.78)" : "rgba(38,29,23,.62)";
  const s: React.CSSProperties = { position: "absolute", top: 108, fontFamily: MONO, fontSize: 21, letterSpacing: 2.4, color, textTransform: "uppercase" };
  return (
    <>
      <div style={{ ...s, left: 70 }}>{left}</div>
      <div style={{ ...s, right: W - 900, textAlign: "right" }}>{right}</div>
      <div style={{ position: "absolute", top: 146, left: 70, width: 830, height: 1.5, background: dark ? "rgba(207,226,247,.22)" : "rgba(38,29,23,.14)" }} />
    </>
  );
}

/** A floating label card that pops when its text changes. */
export function Tag({ items, x = 70, y = 172, dark = false }: { items: { at: number; text: string | ((t: number) => string) }[]; x?: number; y?: number; dark?: boolean }) {
  const frame = useCurrentFrame();
  const cur = [...items].reverse().find((i) => frame >= f(i.at));
  if (!cur) return null;
  const k = spring({ frame: frame - f(cur.at), fps: FPS, config: { damping: 16, stiffness: 260 } });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transformOrigin: "0 50%",
        transform: `scale(${0.86 + 0.14 * k})`,
        opacity: Math.min(1, k * 1.6),
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 20px 12px 16px",
        borderRadius: 12,
        background: dark ? "rgba(19,34,53,.92)" : "rgba(253,250,244,.94)",
        border: dark ? "1.5px solid rgba(160,200,240,.5)" : "1.5px solid rgba(38,29,23,.16)",
        boxShadow: dark ? "0 10px 30px rgba(0,0,0,.35)" : "0 10px 26px rgba(38,29,23,.14)",
        fontFamily: MONO,
        fontSize: 23,
        letterSpacing: 1.6,
        color: dark ? C.blueprintInk : C.ink,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ width: 6, alignSelf: "stretch", borderRadius: 3, background: dark ? "#7fb6ef" : C.red }} />
      {typeof cur.text === "function" ? cur.text(frame / FPS) : cur.text}
    </div>
  );
}

/** One line at a time, in a dark rounded pill, with the spoken word highlighted. */
export function Captions() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const line = [...LINES].reverse().find((l) => t >= l.at - 0.06);
  if (!line) return null;
  const nextLine = LINES[LINES.indexOf(line) + 1];
  const endAt = Math.min(line.at + line.duration + 0.45, nextLine ? nextLine.at - 0.06 : Infinity);
  if (t > endAt) return null;
  const rel = t - line.at;
  // Pages: a new page starts at a word marked `page`.
  const pages: (typeof line.words)[] = [[]];
  for (const w of line.words) {
    if (w.page && pages[pages.length - 1].length) pages.push([]);
    pages[pages.length - 1].push(w);
  }
  const pi = Math.max(0, pages.findLastIndex((p) => rel >= p[0].start - 0.06));
  const page = pages[pi];
  const pageAt = line.at + (pi === 0 ? -0.06 : page[0].start - 0.06);
  const k = spring({ frame: frame - f(pageAt), fps: FPS, config: { damping: 18, stiffness: 320 } });
  const out = interpolate(t, [endAt - 0.12, endAt], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: CAPTION_Y - 48, display: "flex", justifyContent: "center", opacity: out }}>
      <div
        style={{
          maxWidth: 700,
          display: "flex",
          flexWrap: "nowrap",
          gap: 13,
          padding: "16px 26px",
          borderRadius: 18,
          background: "rgba(31,24,19,.93)",
          boxShadow: "0 14px 34px rgba(20,12,8,.32), inset 0 0 0 1.5px rgba(253,250,244,.2)",
          transform: `translateY(${(1 - k) * 18}px) scale(${0.94 + 0.06 * k})`,
          opacity: Math.min(1, k * 2),
          fontFamily: SANS,
          fontWeight: 650,
          fontSize: 50,
          lineHeight: "64px",
          letterSpacing: -0.4,
          whiteSpace: "nowrap",
        }}
      >
        {page.map((w, i) => {
          const active = rel >= w.start - 0.04 && (i === page.length - 1 || rel < page[i + 1].start - 0.04);
          const said = rel >= w.start - 0.04;
          const a = spring({ frame: frame - f(line.at + w.start - 0.04), fps: FPS, config: { damping: 20, stiffness: 400 } });
          return (
            <span
              key={i}
              style={{
                position: "relative",
                color: said ? C.onRed : "rgba(253,250,243,.42)",
                padding: "0 8px",
                margin: "0 -8px",
              }}
            >
              {active && (
                <span
                  style={{
                    position: "absolute",
                    inset: "2px 0",
                    borderRadius: 10,
                    background: C.red,
                    transform: `scale(${0.8 + 0.2 * a})`,
                    opacity: a,
                    zIndex: 0,
                  }}
                />
              )}
              <span style={{ position: "relative" }}>{w.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
