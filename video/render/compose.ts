/**
 * The compositor: turns takes (recorded frames + timelines) and an edit
 * decision list into finished frames, drawn on a canvas and piped to ffmpeg.
 *
 * Two formats share it:
 * - "wide" (1920×1080): the browser window (or phone) stays put on the
 *   branded background; zooms happen inside the window; captions sit in the
 *   band below it (beside the phone for phone scenes).
 * - "reel" (1080×1920): captions in the top safe area; the device is framed
 *   by a camera that keeps whatever it zooms to inside the platforms' safe
 *   zone (clear of Instagram's bottom and right-hand buttons).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { TAKES } from "../lib/config";
import type { Rect, Take, TakeEvent } from "../lib/recorder";
import {
  browserBar,
  captionReel,
  caption16,
  renderOverlay,
  type Overlay,
  type Palette,
} from "./overlays";

export const FPS = 30;
const XFADE = 0.5; // between segments
const CUT_FADE = 0.35; // across a cut inside a take
const CAM = 0.95; // camera move duration
const CAPTION_FADE = 0.3;

export type Format = "wide" | "reel";
export const SIZE: Record<Format, { W: number; H: number }> = {
  wide: { W: 1920, H: 1080 },
  reel: { W: 1080, H: 1920 },
};

/** Where in a take a clip starts/ends: a mark name, or seconds from the take start. */
export type At = string | number;

export type Extra = {
  overlay: Overlay;
  from: At;
  to?: At;
  /** Top-left in output px (wide) — or "center". */
  x: number;
  y: number;
  width: number;
};

export type ClipSeg = {
  kind: "clip";
  take: string;
  from?: At;
  to?: At;
  /** "take": the take's own captions; an array: captions at marks/offsets; false: none. */
  captions?: "take" | { at: At; text: string }[] | false;
  /** Ignore the take's camera events (show the whole screen). */
  noCamera?: boolean;
  /** Extra camera targets (reel), at marks or offsets, in screen CSS px. */
  camera?: { at: At; rect: Rect | null; maxZoom?: number }[];
  extras?: Extra[];
  /** Hold the last frame this long after `to`. */
  hold?: number;
};

export type CardSeg = {
  kind: "card";
  overlay: Overlay;
  duration: number;
  /** Text for the .srt / voiceover (the card's words). */
  text: string;
  /** Show a dimmed board frame behind the card (take id + time). */
  backdrop?: { take: string; at: At };
};

export type Segment = ClipSeg | CardSeg;

// ── takes ───────────────────────────────────────────────────────────────

const takes = new Map<string, Take>();
export function take(id: string): Take {
  let t = takes.get(id);
  if (!t) {
    t = JSON.parse(readFileSync(path.join(TAKES, id, "take.json"), "utf8")) as Take;
    takes.set(id, t);
  }
  return t;
}

function resolveAt(t: Take, at: At | undefined, fallback: number): number {
  if (at === undefined) return fallback;
  if (typeof at === "number") return at >= 0 ? t.start + at : t.end + at;
  const [name, offset] = at.split(/(?=[+-]\d)/);
  const m = t.events.find((e) => e.type === "mark" && e.name === name);
  if (!m) throw new Error(`Take ${t.id} has no mark "${name}"`);
  return m.t + (offset ? Number(offset) : 0);
}

/** The take's time ranges a clip shows, with cuts removed: [from, to, playback speed]. */
function clipRanges(t: Take, a: number, b: number): Range[] {
  const plain: [number, number][] = [];
  let cursor = a;
  let cutStart: number | null = null;
  for (const e of t.events) {
    if (e.type !== "cut") continue;
    if (e.on) cutStart = e.t;
    else if (cutStart !== null) {
      const [c0, c1] = [cutStart, e.t];
      cutStart = null;
      if (c1 <= cursor || c0 >= b) continue; // outside this clip
      if (c0 > cursor) plain.push([cursor, c0]);
      cursor = Math.min(b, Math.max(cursor, c1));
    }
  }
  if (cursor < b) plain.push([cursor, b]);

  // Faster playback where the take asked for it (rec.fast).
  const fast: [number, number, number][] = [];
  let open: { t: number; factor: number } | null = null;
  for (const e of t.events) {
    if (e.type !== "speed") continue;
    if (e.on) open = { t: e.t, factor: e.factor };
    else if (open) {
      fast.push([open.t, e.t, open.factor]);
      open = null;
    }
  }
  const out: Range[] = [];
  for (const [r0, r1] of plain) {
    let x = r0;
    for (const [f0, f1, k] of fast) {
      if (f1 <= x || f0 >= r1) continue;
      if (f0 > x) out.push([x, f0, 1]);
      out.push([Math.max(x, f0), Math.min(r1, f1), k]);
      x = Math.min(r1, f1);
    }
    if (x < r1) out.push([x, r1, 1]);
  }
  return out.filter(([x, y]) => y - x > 1e-3);
}
type Range = [number, number, number];

// ── camera ──────────────────────────────────────────────────────────────

/** Camera: the screen point (cx, cy) in CSS px is shown at zoom z. */
type Cam = { cx: number; cy: number; z: number };
type Key = { t: number; from: Cam; to: Cam };

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function mix(a: Cam, b: Cam, k: number): Cam {
  return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)) };
}

type CamEvent = { t: number; rect: Rect | null; maxZoom?: number };

function camKeys(events: CamEvent[], target: (e: CamEvent) => Cam, home: Cam): Key[] {
  const keys: Key[] = [];
  let state = home;
  let last: Key | null = null;
  for (const e of [...events].sort((x, y) => x.t - y.t)) {
    if (last) state = mix(last.from, last.to, ease((e.t - last.t) / CAM));
    last = { t: e.t, from: state, to: target(e) };
    keys.push(last);
  }
  return keys;
}

function camAt(keys: Key[], t: number, home: Cam): Cam {
  let k: Key | null = null;
  for (const key of keys) if (key.t <= t) k = key;
  if (!k) return home;
  return mix(k.from, k.to, ease((t - k.t) / CAM));
}

// ── frames ──────────────────────────────────────────────────────────────

class FrameSource {
  private cache = new Map<string, Image>();
  constructor(readonly t: Take) {}
  private index(time: number) {
    const f = this.t.frames;
    let lo = 0;
    let hi = f.length - 1;
    if (time <= f[0].t) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].t <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  async at(time: number): Promise<Image> {
    const file = this.t.frames[this.index(time)].file;
    let img = this.cache.get(file);
    if (!img) {
      img = await loadImage(readFileSync(path.join(TAKES, this.t.id, file)));
      this.cache.set(file, img);
      if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
    }
    return img;
  }
}

// ── images ──────────────────────────────────────────────────────────────

const images = new Map<string, Image>();
export async function overlayImage(o: Overlay): Promise<Image> {
  const file = await renderOverlay(o);
  let img = images.get(file);
  if (!img) {
    img = await loadImage(readFileSync(file));
    images.set(file, img);
  }
  return img;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ── layouts ─────────────────────────────────────────────────────────────

/** Device geometry: where the screen (CSS px) lands on the canvas, at camera rest. */
type Geometry = {
  /** Window/phone outer rect at rest (canvas px). */
  frame: Rect;
  /** Screen rect at rest (canvas px). */
  screen: Rect;
  /** Canvas px per screen CSS px at rest. */
  s: number;
  bar: number; // bar height (canvas px at rest)
  radius: number;
};

const PHONE_BEZEL = 13;
const PHONE_BAR = 46; // CSS px, the phone browser's address bar

function wideGeometry(device: Take["device"], vp: Take["viewport"]): Geometry {
  if (device === "desktop") {
    const s = 1440 / vp.width;
    const bar = 52;
    const frame = { x: 240, y: 30, width: 1440, height: bar + vp.height * s };
    return { frame, screen: { x: 240, y: 30 + bar, width: 1440, height: vp.height * s }, s, bar, radius: 16 };
  }
  // Phone: tall on the left, caption beside it.
  const h = 1010;
  const s = (h - 2 * PHONE_BEZEL) / (vp.height + PHONE_BAR);
  const w = vp.width * s + 2 * PHONE_BEZEL;
  const frame = { x: 600 - w / 2, y: 35, width: w, height: h };
  const bar = PHONE_BAR * s;
  return {
    frame,
    screen: { x: frame.x + PHONE_BEZEL, y: frame.y + PHONE_BEZEL + bar, width: vp.width * s, height: vp.height * s },
    s,
    bar,
    radius: 54,
  };
}

/** Reel: the device at rest, below the caption area. */
function reelGeometry(device: Take["device"], vp: Take["viewport"]): Geometry {
  if (device === "desktop") {
    const s = 900 / vp.width;
    const bar = 52 * 0.8;
    const frame = { x: 90, y: 760, width: 900, height: bar + vp.height * s };
    return { frame, screen: { x: 90, y: 760 + bar, width: 900, height: vp.height * s }, s, bar, radius: 14 };
  }
  // Big enough to read on a phone; its lower edge may run under the platform's
  // own buttons, so the camera keeps whatever matters inside REEL_SAFE.
  const s = 1.6;
  const bar = PHONE_BAR * s;
  const w = vp.width * s + 2 * PHONE_BEZEL;
  const frame = { x: 505 - w / 2, y: 610, width: w, height: (vp.height + PHONE_BAR) * s + 2 * PHONE_BEZEL };
  return {
    frame,
    screen: { x: frame.x + PHONE_BEZEL, y: frame.y + PHONE_BEZEL + bar, width: vp.width * s, height: vp.height * s },
    s,
    bar,
    radius: 56,
  };
}

/** The reel's safe area for anything that matters (Instagram/TikTok/Shorts overlays avoided). */
export const REEL_SAFE = { x: 70, y: 600, width: 860, height: 830 };
const REEL_CLIP_TOP = 585;

// ── drawing a clip frame ───────────────────────────────────────────────

type ClipState = {
  seg: ClipSeg;
  t: Take;
  src: FrameSource;
  ranges: Range[];
  duration: number;
  keys: Key[];
  home: Cam;
  geo: Geometry;
  captions: { start: number; end: number; text: string }[];
  urls: { t: number; url: string }[];
  extras: (Extra & { start: number; end: number })[];
};

export function sourceTime(st: ClipState, local: number): { a: number; b?: number; k?: number } {
  let acc = 0;
  const R = st.ranges;
  for (let i = 0; i < R.length; i++) {
    const [r0, r1, sp] = R[i];
    const len = (r1 - r0) / sp;
    if (local < acc + len || i === R.length - 1) {
      const into = local - acc;
      const a = Math.min(r1, r0 + into * sp);
      // Cross-fade across a cut (a jump in the take's time), not a speed change.
      const cutBefore = i > 0 && r0 - R[i - 1][1] > 0.01;
      const cutAfter = i < R.length - 1 && R[i + 1][0] - r1 > 0.01;
      if (cutBefore && into < CUT_FADE / 2) {
        const prev = R[i - 1][1] - (CUT_FADE / 2 - into);
        return { a: prev, b: a, k: (into + CUT_FADE / 2) / CUT_FADE };
      }
      const left = acc + len - local;
      if (cutAfter && left < CUT_FADE / 2) {
        const next = R[i + 1][0] + (CUT_FADE / 2 - left);
        return { a, b: next, k: (CUT_FADE / 2 - left) / CUT_FADE };
      }
      return { a };
    }
    acc += len;
  }
  return { a: R[0][0] };
}

function prepareClip(seg: ClipSeg, format: Format): ClipState {
  const t = take(seg.take);
  const a = resolveAt(t, seg.from, t.start);
  const b = resolveAt(t, seg.to, t.end);
  if (b <= a) throw new Error(`Clip ${seg.take}: empty range`);
  const ranges = clipRanges(t, a, b);
  const shown = ranges.reduce((s, [x, y, sp]) => s + (y - x) / sp, 0);
  const duration = shown + (seg.hold ?? 0);
  const vp = t.viewport;
  const geo = format === "wide" ? wideGeometry(t.device, vp) : reelGeometry(t.device, vp);
  const home: Cam = { cx: vp.width / 2, cy: vp.height / 2, z: 1 };

  // Local (output) time of a source time.
  const local = (time: number) => {
    let acc = 0;
    for (const [r0, r1, sp] of ranges) {
      if (time <= r1) return acc + Math.max(0, time - r0) / sp;
      acc += (r1 - r0) / sp;
    }
    return acc;
  };

  // Camera events.
  let events: CamEvent[] = [];
  if (!seg.noCamera) {
    events = t.events
      .filter((e): e is Extract<TakeEvent, { type: "focus" | "unfocus" }> => e.type === "focus" || e.type === "unfocus")
      .map((e) => ({ t: e.t, rect: e.type === "focus" ? e.rect : null, maxZoom: e.type === "focus" ? e.maxZoom : undefined }));
  }
  for (const c of seg.camera ?? []) events.push({ t: resolveAt(t, c.at, a), rect: c.rect, maxZoom: c.maxZoom });

  const target = (e: CamEvent): Cam => {
    if (!e.rect) return home;
    const r = e.rect;
    let z: number;
    if (format === "wide") {
      z = Math.min(vp.width / r.width, vp.height / r.height, e.maxZoom ?? (t.device === "phone" ? 1.6 : 2.0));
      z = Math.max(1, z);
    } else {
      // Fit the rect into the reel's safe area, relative to the device's rest scale.
      const zs = Math.min(REEL_SAFE.width / (r.width * geo.s), REEL_SAFE.height / (r.height * geo.s));
      // Reel zoom limits are higher: the device starts small on a phone screen.
      z = Math.max(1, Math.min(zs, t.device === "phone" ? 1.8 : 3.0));
    }
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, z };
  };
  const keys = camKeys(events, target, home);

  // Captions.
  let captions: ClipState["captions"] = [];
  if (seg.captions === "take" || seg.captions === undefined) {
    const caps = t.events.filter((e): e is Extract<TakeEvent, { type: "caption" }> => e.type === "caption");
    const before = caps.filter((c) => c.t <= a).pop();
    const inside = caps.filter((c) => c.t > a && c.t < b);
    const list = [...(before ? [before] : []), ...inside];
    captions = list.map((c, i) => ({
      start: c === before ? 0 : local(c.t),
      end: i + 1 < list.length ? local(list[i + 1].t) : duration,
      text: c.text,
    }));
  } else if (seg.captions) {
    const list = seg.captions.map((c) => ({ start: Math.max(0, local(resolveAt(t, c.at, a))), text: c.text }));
    captions = list.map((c, i) => ({ ...c, end: i + 1 < list.length ? list[i + 1].start : duration }));
  }

  const urls = t.events
    .filter((e): e is Extract<TakeEvent, { type: "url" }> => e.type === "url")
    .map((e) => ({ t: e.t, url: e.url }));

  const extras = (seg.extras ?? []).map((x) => ({
    ...x,
    start: local(resolveAt(t, x.from, a)),
    end: x.to === undefined ? duration : local(resolveAt(t, x.to, b)),
  }));

  return { seg, t, src: new FrameSource(t), ranges, duration, keys, home, geo, captions, urls, extras };
}

/** After a "standalone" mark the phone runs InkBoard as an installed app: no browser bar. */
function standaloneAt(st: ClipState, time: number) {
  return st.t.events.some((e) => e.type === "mark" && e.name === "standalone" && e.t <= time);
}

function urlAt(st: ClipState, time: number) {
  let url = st.urls[0]?.url ?? "/";
  for (const u of st.urls) if (u.t <= time) url = u.url;
  return url;
}

/** Clamp the camera so the zoomed view never shows past the screen's edges. */
function clampCam(c: Cam, vp: { width: number; height: number }): Cam {
  const w = vp.width / c.z;
  const h = vp.height / c.z;
  return {
    z: c.z,
    cx: Math.min(vp.width - w / 2, Math.max(w / 2, c.cx)),
    cy: Math.min(vp.height - h / 2, Math.max(h / 2, c.cy)),
  };
}

async function drawScreen(ctx: SKRSContext2D, st: ClipState, local: number, draw: (img: Image) => void) {
  const time = sourceTime(st, Math.min(local, st.duration - (st.seg.hold ?? 0) - 1e-3));
  draw(await st.src.at(time.a));
  if (time.b !== undefined && time.k !== undefined) {
    ctx.save();
    ctx.globalAlpha = ease(time.k);
    draw(await st.src.at(time.b));
    ctx.restore();
  }
}

const barCache = new Map<string, Overlay>();
function barFor(url: string, width: number) {
  const key = `${width}:${url}`;
  let o = barCache.get(key);
  if (!o) {
    o = browserBar(url, width);
    barCache.set(key, o);
  }
  return o;
}

async function drawClipWide(ctx: SKRSContext2D, st: ClipState, local: number, pal: Palette) {
  const { geo, t } = st;
  const vp = t.viewport;
  const src = sourceTime(st, Math.min(local, st.duration - (st.seg.hold ?? 0) - 1e-3));
  const cam = clampCam(camAt(st.keys, src.a, st.home), vp);
  const { frame, screen } = geo;

  // Window body + shadow.
  ctx.save();
  ctx.shadowColor = "rgba(60, 35, 15, 0.28)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = t.device === "phone" ? "#1f1915" : pal.paper;
  roundRect(ctx, frame.x, frame.y, frame.width, frame.height, geo.radius);
  ctx.fill();
  ctx.restore();

  // Screen, zoomed inside the window.
  ctx.save();
  const innerR = t.device === "phone" ? [0, 0, geo.radius - PHONE_BEZEL, geo.radius - PHONE_BEZEL] : [0, 0, geo.radius, geo.radius];
  roundRect(ctx, screen.x, screen.y, screen.width, screen.height, innerR);
  ctx.clip();
  const sw = vp.width / cam.z;
  const sh = vp.height / cam.z;
  const sx = cam.cx - sw / 2;
  const sy = cam.cy - sh / 2;
  const sc = t.scale;
  await drawScreen(ctx, st, local, (img) => ctx.drawImage(img, sx * sc, sy * sc, sw * sc, sh * sc, screen.x, screen.y, screen.width, screen.height));
  ctx.restore();

  // Address bar.
  const barW = t.device === "phone" ? vp.width : 1440;
  const bar = await overlayImage(t.device === "phone" ? phoneBar(urlAt(st, src.a)) : barFor(urlAt(st, src.a), barW));
  if (t.device === "phone") {
    ctx.save();
    roundRect(ctx, screen.x, frame.y + PHONE_BEZEL, screen.width, geo.bar, [geo.radius - PHONE_BEZEL, geo.radius - PHONE_BEZEL, 0, 0]);
    ctx.clip();
    if (standaloneAt(st, src.a)) {
      ctx.fillStyle = pal.canvas;
      ctx.fillRect(screen.x, frame.y + PHONE_BEZEL, screen.width, geo.bar);
    } else {
      ctx.drawImage(bar, screen.x, frame.y + PHONE_BEZEL, screen.width, geo.bar);
    }
    ctx.restore();
  } else {
    ctx.drawImage(bar, frame.x, frame.y, frame.width, geo.bar);
  }
}

async function drawClipReel(ctx: SKRSContext2D, st: ClipState, local: number, pal: Palette) {
  const { geo, t } = st;
  const vp = t.viewport;
  const src = sourceTime(st, Math.min(local, st.duration - (st.seg.hold ?? 0) - 1e-3));
  const cam = camAt(st.keys, src.a, st.home);
  // Layer transform: screen CSS point (cx, cy) goes to an anchor; at rest that's
  // where it sits; when zoomed, the safe area's centre.
  const restX = geo.screen.x + cam.cx * geo.s;
  const restY = geo.screen.y + cam.cy * geo.s;
  const zk = Math.min(1, (cam.z - 1) / 0.35);
  const ax = lerp(restX, REEL_SAFE.x + REEL_SAFE.width / 2, zk);
  const ay = lerp(restY, REEL_SAFE.y + REEL_SAFE.height / 2, zk);
  const S = geo.s * cam.z;
  // Canvas position of a screen CSS point.
  const X = (x: number) => ax + (x - cam.cx) * S;
  const Y = (y: number) => ay + (y - cam.cy) * S;
  const k = S / geo.s; // scale of frame parts

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, REEL_CLIP_TOP, 1080, 1920 - REEL_CLIP_TOP);
  ctx.clip();

  const sx0 = X(0);
  const sy0 = Y(0);
  const sw = vp.width * S;
  const sh = vp.height * S;
  const bez = (t.device === "phone" ? PHONE_BEZEL : 0) * k;
  const barH = geo.bar * k;
  const fx = sx0 - bez;
  const fy = sy0 - barH - bez;
  const fw = sw + 2 * bez;
  const fh = sh + barH + 2 * bez;
  const R = geo.radius * k;

  ctx.save();
  ctx.shadowColor = "rgba(60, 35, 15, 0.28)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = t.device === "phone" ? "#1f1915" : pal.paper;
  roundRect(ctx, fx, fy, fw, fh, R);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const innerR = t.device === "phone" ? [0, 0, R - bez, R - bez] : [0, 0, R, R];
  roundRect(ctx, sx0, sy0, sw, sh, innerR);
  ctx.clip();
  const sc = t.scale;
  await drawScreen(ctx, st, local, (img) => ctx.drawImage(img, 0, 0, vp.width * sc, vp.height * sc, sx0, sy0, sw, sh));
  ctx.restore();

  const bar = await overlayImage(t.device === "phone" ? phoneBar(urlAt(st, src.a)) : barFor(urlAt(st, src.a), 1280));
  ctx.save();
  if (t.device === "phone") {
    roundRect(ctx, sx0, fy + bez, sw, barH, [R - bez, R - bez, 0, 0]);
    ctx.clip();
    if (standaloneAt(st, src.a)) {
      ctx.fillStyle = pal.canvas;
      ctx.fillRect(sx0, fy + bez, sw, barH);
    } else {
      ctx.drawImage(bar, sx0, fy + bez, sw, barH);
    }
  } else {
    ctx.drawImage(bar, fx, fy, fw, barH);
  }
  ctx.restore();
  ctx.restore();
}

/** The phone browser's address bar (Chrome on Android style, kept neutral). */
function phoneBar(url: string): Overlay {
  let rest = "";
  try {
    const u = new URL(url);
    rest = u.pathname === "/" ? "" : u.pathname;
  } catch {}
  const o = browserBar(url, 390);
  return {
    ...o,
    key: "pbar",
    height: PHONE_BAR,
    scale: 3,
    html: `<div style="width:100%;height:100%;display:flex;align-items:center;padding:0 12px;background:#efe8dc">
      <div style="flex:1;height:32px;border-radius:16px;background:rgba(255,253,248,.95);display:flex;align-items:center;gap:7px;padding:0 14px;
        font-size:14.5px;box-shadow:inset 0 0 0 1px rgba(60,40,20,.08);overflow:hidden">
        <svg width="11" height="13" viewBox="0 0 12 14"><rect x="1" y="6" width="10" height="7.5" rx="2" fill="#7b6f63"/><path d="M3.3 6V4.4a2.7 2.7 0 0 1 5.4 0V6" stroke="#7b6f63" stroke-width="1.6" fill="none"/></svg>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:#2b211b">tryinkboard.elabo.me</span><span style="color:#7b6f63">${rest
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</span></span>
      </div></div>`,
  };
}

// ── background ──────────────────────────────────────────────────────────

const bgCache = new Map<string, Canvas>();
export function background(format: Format, pal: Palette): Canvas {
  const key = `${format}`;
  const cached = bgCache.get(key);
  if (cached) return cached;
  const { W, H } = SIZE[format];
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = pal.canvas;
  ctx.fillRect(0, 0, W, H);
  // Soft light from the top, like the board.
  const g = ctx.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, Math.max(W, H) * 0.9);
  g.addColorStop(0, "rgba(255,252,245,0.75)");
  g.addColorStop(1, "rgba(255,252,245,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // The board's dot grid.
  ctx.fillStyle = pal.dot;
  ctx.globalAlpha = 0.55;
  const step = 28;
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  bgCache.set(key, c);
  return c;
}

// ── segments → frames ──────────────────────────────────────────────────

type Prepared =
  | { kind: "clip"; st: ClipState; duration: number }
  | { kind: "card"; seg: CardSeg; duration: number; backdrop?: ClipState };

export function prepare(segments: Segment[], format: Format): Prepared[] {
  return segments.map((s) => {
    if (s.kind === "clip") {
      const st = prepareClip(s, format);
      return { kind: "clip", st, duration: st.duration };
    }
    const backdrop = s.backdrop
      ? prepareClip({ kind: "clip", take: s.backdrop.take, from: s.backdrop.at, captions: false, noCamera: true }, format)
      : undefined;
    return { kind: "card", seg: s, duration: s.duration, backdrop };
  });
}

export type Placed = { p: Prepared; start: number; end: number };

/** Lay segments end to end, overlapping by the cross-fade. */
export function place(prepared: Prepared[]): { placed: Placed[]; duration: number } {
  const placed: Placed[] = [];
  let t = 0;
  for (const p of prepared) {
    const start = placed.length ? t - XFADE : 0;
    placed.push({ p, start, end: start + p.duration });
    t = start + p.duration;
  }
  return { placed, duration: t };
}

async function drawCaption(ctx: SKRSContext2D, format: Format, text: string, alpha: number, rise: number, device: Take["device"]) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (format === "wide") {
    if (device === "phone") {
      const img = await overlayImage(sideCaption(text));
      ctx.drawImage(img, 900, 540 - img.height / 2 + rise);
    } else {
      const img = await overlayImage(caption16(text));
      ctx.drawImage(img, (1920 - img.width) / 2, 897 + rise);
    }
  } else {
    const img = await overlayImage(captionReel(text));
    ctx.drawImage(img, 80, 240 + rise);
  }
  ctx.restore();
}

/** Caption beside the phone (wide format). */
export const sideCaption = (text: string): Overlay => ({
  key: "capside",
  width: 860,
  height: 600,
  html: `<div class="balance" style="width:100%;height:100%;display:flex;align-items:center;font-size:58px;line-height:1.18;font-weight:600;letter-spacing:-0.012em">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</div>`,
});

async function drawPrepared(ctx: SKRSContext2D, p: Prepared, local: number, format: Format, pal: Palette) {
  if (p.kind === "card") {
    if (p.backdrop) {
      ctx.save();
      if (format === "wide") await drawClipWide(ctx, p.backdrop, 0, pal);
      else await drawClipReel(ctx, p.backdrop, 0, pal);
      ctx.restore();
      const { W, H } = SIZE[format];
      ctx.fillStyle = pal.canvas;
      ctx.globalAlpha = 0.86;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const img = await overlayImage(p.seg.overlay);
    // Gentle settle: 1.5% zoom-out over the card.
    const k = ease(Math.min(1, local / 1.2));
    const s = 1.015 - 0.015 * k;
    const { W, H } = SIZE[format];
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.3 + k);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    return;
  }
  const st = p.st;
  if (format === "wide") await drawClipWide(ctx, st, local, pal);
  else await drawClipReel(ctx, st, local, pal);

  for (const x of st.extras) {
    if (local < x.start || local > x.end) continue;
    const kin = ease((local - x.start) / 0.45);
    const kout = ease((x.end - local) / 0.35);
    const k = Math.min(kin, kout);
    const img = await overlayImage(x.overlay);
    const h = (img.height / img.width) * x.width;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.drawImage(img, x.x, x.y + (1 - k) * 30, x.width, h);
    ctx.restore();
  }

  for (const c of st.captions) {
    if (local < c.start || local > c.end) continue;
    const kin = c.start <= 0 ? 1 : ease((local - c.start) / CAPTION_FADE);
    const kout = c.end >= st.duration ? 1 : ease((c.end - local) / CAPTION_FADE);
    await drawCaption(ctx, format, c.text, Math.min(kin, kout), (1 - kin) * 14, st.t.device);
  }
}

/** Caption intervals in output time (for the .srt and the voiceover script). */
export function captionTimeline(placed: Placed[], offset = 0) {
  const out: { start: number; end: number; text: string }[] = [];
  for (const { p, start, end } of placed) {
    if (p.kind === "card") {
      out.push({ start: offset + start + XFADE / 2, end: offset + end - XFADE / 2, text: p.seg.text });
      continue;
    }
    for (const c of p.st.captions) {
      out.push({ start: offset + start + Math.max(c.start, XFADE / 2), end: offset + Math.min(start + c.end, end - XFADE / 2), text: c.text });
    }
  }
  return out.filter((c) => c.end - c.start > 0.3);
}

/**
 * Render placed segments to an MP4 (video only; the silent audio track is
 * added when the parts are joined). `fadeIn`/`fadeOut`: dip from/to the
 * background at the part's edges.
 */
export async function renderPart(
  placed: Placed[],
  duration: number,
  format: Format,
  pal: Palette,
  out: string,
  { fadeIn = 0.45, fadeOut = 0.45 } = {},
) {
  const { W, H } = SIZE[format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const layer = createCanvas(W, H);
  const lctx = layer.getContext("2d");
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = "high";
  const bg = background(format, pal);

  const ff = spawn(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
      "-r", String(FPS), "-g", String(FPS * 2), "-bf", "2", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-x264-params", "keyint=60:min-keyint=60:scenecut=0", out],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise<void>((resolve, reject) => {
    ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  const frames = Math.round(duration * FPS);
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0);
    const active = placed.filter((s) => t >= s.start && t < s.end);
    for (let i = 0; i < active.length; i++) {
      const s = active[i];
      const local = t - s.start;
      // A segment fading in over the previous one.
      const fadeK = i > 0 ? ease(local / XFADE) : 1;
      if (fadeK >= 1 || i === 0) {
        await drawPrepared(ctx, s.p, local, format, pal);
      } else {
        lctx.drawImage(bg, 0, 0);
        await drawPrepared(lctx, s.p, local, format, pal);
        ctx.save();
        ctx.globalAlpha = fadeK;
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      }
    }
    // Dip from / to the background at the part's edges.
    const edge = Math.min(fadeIn > 0 ? t / fadeIn : 1, fadeOut > 0 ? (duration - t) / fadeOut : 1);
    if (edge < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - ease(Math.max(0, edge));
      ctx.drawImage(bg, 0, 0);
      ctx.restore();
    }
    const buf = canvas.data();
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % (FPS * 10) === 0 && f > 0) {
      const rate = f / ((Date.now() - started) / 1000);
      process.stdout.write(`    ${(t).toFixed(0)}s/${duration.toFixed(0)}s (${rate.toFixed(1)} fps)\n`);
    }
  }
  ff.stdin.end();
  await done;
}

/** A single still frame (covers, checks): segment `p` at local time `local`. */
export async function still(p: Prepared, local: number, format: Format, pal: Palette): Promise<Canvas> {
  const { W, H } = SIZE[format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(background(format, pal), 0, 0);
  await drawPrepared(ctx, p, local, format, pal);
  return canvas;
}
