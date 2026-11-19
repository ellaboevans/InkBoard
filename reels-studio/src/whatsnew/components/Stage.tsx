import React from "react";
import { Easing, interpolate, spring, useCurrentFrame } from "remotion";
import { C, MONO, SANS, SERIF } from "../../theme";
import { pageBreaks } from "../pages";
import { CAPTION_Y, FPS, H, W } from "../theme";
import { CHAPTERS, f, LINES, type Chapter } from "../timeline";

/** Monospace labels in the top corners, with a hairline under them. */
export function Corners({ right, dark = false }: { right: string; dark?: boolean }) {
  const color = dark ? "rgba(207,226,247,.78)" : "rgba(38,29,23,.6)";
  const s: React.CSSProperties = { position: "absolute", top: 26, fontFamily: MONO, fontSize: 17, letterSpacing: 2.2, color, textTransform: "uppercase" };
  return (
    <>
      <div style={{ ...s, left: 60 }}>InkBoard · what&apos;s new</div>
      <div style={{ ...s, right: 60, textAlign: "right" }}>{right}</div>
      <div style={{ position: "absolute", top: 56, left: 60, right: 60, height: 1.5, background: dark ? "rgba(207,226,247,.22)" : "rgba(38,29,23,.13)" }} />
    </>
  );
}

/** A bright bar crossing the stage: `over` shows where it has been. */
export function Sweep({ at, dur = 0.5, dir, under, over }: { at: number; dur?: number; dir: "down" | "up"; under: React.ReactNode; over: React.ReactNode }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [f(at), f(at + dur)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const y = dir === "down" ? -40 + p * (H + 80) : H + 40 - p * (H + 80);
  const clip = dir === "down" ? `inset(0 0 ${Math.max(0, H - y)}px 0)` : `inset(${Math.max(0, y)}px 0 0 0)`;
  return (
    <>
      <div style={{ position: "absolute", inset: 0 }}>{under}</div>
      <div style={{ position: "absolute", inset: 0, clipPath: clip }}>{over}</div>
      {p > 0 && p < 1 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: y - 2.5, height: 5, background: "#eef6ff", boxShadow: "0 0 16px 5px rgba(190,225,255,.85), 0 0 70px 24px rgba(140,190,240,.42)" }} />
      )}
    </>
  );
}

/** The chapter card, drawn on the blueprint: the number, the title, and where it sits among the chapters. */
export function ChapterCard({ c }: { c: Chapter }) {
  const frame = useCurrentFrame();
  const k = spring({ frame: frame - f(c.at + 0.25), fps: FPS, config: { damping: 15, stiffness: 160 } });
  const out = interpolate(frame, [f(c.end - 0.55), f(c.end - 0.1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, transform: `translateY(${-out * 20}px)` }}>
      <div style={{ fontFamily: MONO, fontSize: 26, letterSpacing: 8, color: "#8fc0f2", opacity: k, transform: `translateY(${(1 - k) * 24}px)` }}>CHAPTER {c.n}</div>
      <div style={{ fontFamily: SERIF, fontSize: 108, lineHeight: 1.05, color: C.blueprintInk, letterSpacing: -1, opacity: k, transform: `translateY(${(1 - k) * 36}px)`, textAlign: "center" }}>{c.title}</div>
      <div style={{ display: "flex", gap: 14, marginTop: 30, opacity: k }}>
        {CHAPTERS.map((x) => (
          <div key={x.id} style={{ width: x.n === c.n ? 54 : 26, height: 6, borderRadius: 3, background: x.n === c.n ? "#8fc0f2" : x.n < c.n ? "rgba(143,192,242,.55)" : "rgba(143,192,242,.18)" }} />
        ))}
      </div>
      {/* Blueprint frame marks around the title. */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ position: "absolute", left: i % 2 ? undefined : 300, right: i % 2 ? 300 : undefined, top: i < 2 ? 300 : undefined, bottom: i < 2 ? undefined : 300, width: 40, height: 40, opacity: 0.55 * k,
          borderTop: i < 2 ? "2px solid #8fc0f2" : undefined, borderBottom: i >= 2 ? "2px solid #8fc0f2" : undefined, borderLeft: i % 2 ? undefined : "2px solid #8fc0f2", borderRight: i % 2 ? "2px solid #8fc0f2" : undefined }} />
      ))}
    </div>
  );
}

/** One line at a time in the dark pill, the spoken word highlighted; hidden while a chapter card speaks. */
export function Captions() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const line = [...LINES].reverse().find((l) => t >= l.at - 0.05);
  if (!line || line.chapter) return null;
  const next = LINES[LINES.indexOf(line) + 1];
  const endAt = Math.min(line.at + line.duration + 0.4, next ? next.at - 0.05 : Infinity);
  if (t > endAt) return null;
  const rel = t - line.at;
  const pages = pageBreaks(line.words.map((w) => w.text));
  const pi = Math.max(0, pages.findLastIndex((p) => rel >= line.words[p[0]].start - 0.05));
  const page = pages[pi];
  const pageAt = line.at + (pi === 0 ? -0.05 : line.words[page[0]].start - 0.05);
  const k = spring({ frame: frame - f(pageAt), fps: FPS, config: { damping: 18, stiffness: 320 } });
  const fade = interpolate(t, [endAt - 0.12, endAt], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: CAPTION_Y - 34, display: "flex", justifyContent: "center", opacity: fade }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "10px 22px",
          borderRadius: 14,
          background: "rgba(31,24,19,.93)",
          boxShadow: "0 10px 26px rgba(20,12,8,.28), inset 0 0 0 1.5px rgba(253,250,244,.18)",
          transform: `translateY(${(1 - k) * 12}px) scale(${0.95 + 0.05 * k})`,
          opacity: Math.min(1, k * 2),
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 38,
          lineHeight: "48px",
          letterSpacing: -0.3,
          whiteSpace: "nowrap",
          maxWidth: W - 300,
        }}
      >
        {page.map((wi, i) => {
          const w = line.words[wi];
          const said = rel >= w.start - 0.04;
          const active = said && (i === page.length - 1 || rel < line.words[page[i + 1]].start - 0.04);
          const a = spring({ frame: frame - f(line.at + w.start - 0.04), fps: FPS, config: { damping: 20, stiffness: 400 } });
          return (
            <span key={wi} style={{ position: "relative", color: said ? C.onRed : "rgba(253,250,243,.42)", padding: "0 6px", margin: "0 -6px" }}>
              {active && <span style={{ position: "absolute", inset: "2px 0", borderRadius: 8, background: C.red, transform: `scale(${0.8 + 0.2 * a})`, opacity: a }} />}
              <span style={{ position: "relative" }}>{w.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
