/**
 * Every piece of text and chrome in the videos (captions, title cards, the
 * browser bar, end cards) is drawn by Chrome on a page of the app itself, so
 * it uses the app's own fonts (Geist, Newsreader, and the SIL fonts for
 * Ghanaian letters) and its paper-and-ink palette (CSS variables from
 * globals.css). Each overlay is a transparent PNG at its final pixel size,
 * cached by content.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { LIVE_HOST, OVERLAYS, PROD_URL } from "../lib/config";
import { getBrowser } from "../lib/recorder";

export type Overlay = { key: string; html: string; width: number; height: number; scale?: number };
export type Palette = Record<"paper" | "canvas" | "dot" | "ink" | "muted" | "primary" | "border" | "card" | "accent", string>;

const BASE_CSS = `
  #ov { position: absolute; left: 0; top: 0; display: flex; box-sizing: border-box;
    font-family: var(--font-sans-stack); color: var(--foreground); -webkit-font-smoothing: antialiased; }
  #ov * { box-sizing: border-box; }
  .serif { font-family: var(--font-serif-stack); }
  .muted { color: var(--muted-foreground); }
  .red { color: var(--primary); }
  .balance { text-wrap: balance; }
`;

let pages: Map<number, Page> | undefined;
let contexts: BrowserContext[] = [];

async function pageAt(scale: number) {
  pages ??= new Map();
  const existing = pages.get(scale);
  if (existing) return existing;
  const b = await getBrowser(scale);
  const ctx = await b.newContext({ viewport: { width: 2200, height: 2200 }, deviceScaleFactor: scale });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(`${PROD_URL}/offline`);
  await page.evaluate(async (css) => {
    document.body.style.display = "none";
    const style = document.createElement("style");
    style.textContent = css;
    document.documentElement.appendChild(style);
    const ov = document.createElement("div");
    ov.id = "ov";
    document.documentElement.appendChild(ov);
    document.documentElement.style.background = "transparent";
    await document.fonts.ready;
  }, BASE_CSS);
  pages.set(scale, page);
  return page;
}

export async function closeOverlayPages() {
  for (const c of contexts) await c.close().catch(() => {});
  contexts = [];
  pages = undefined;
}

export function overlayFile(o: Overlay) {
  const hash = createHash("sha1").update(`${o.width}x${o.height}@${o.scale ?? 1}:${o.html}`).digest("hex").slice(0, 12);
  return path.join(OVERLAYS, `${o.key}-${hash}.png`);
}

/** Render an overlay to a PNG (cached) and return its path. */
export async function renderOverlay(o: Overlay): Promise<string> {
  const file = overlayFile(o);
  if (existsSync(file)) return file;
  mkdirSync(OVERLAYS, { recursive: true });
  const page = await pageAt(o.scale ?? 1);
  await page.evaluate(
    async ({ html, width, height }) => {
      const ov = document.getElementById("ov")!;
      ov.style.width = `${width}px`;
      ov.style.height = `${height}px`;
      ov.innerHTML = html;
      await document.fonts.ready;
      await Promise.all(
        [...ov.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((r) => i.addEventListener("load", r, { once: true })))),
      );
    },
    { html: o.html, width: o.width, height: o.height },
  );
  await page.locator("#ov").screenshot({ path: file, omitBackground: true });
  return file;
}

/** The app's palette as sRGB hex, read from its CSS variables. */
export async function readPalette(): Promise<Palette> {
  const cache = path.join(OVERLAYS, "palette.json");
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Palette;
  const page = await pageAt(1);
  const vars = {
    paper: "--background",
    canvas: "--canvas",
    dot: "--canvas-dot",
    ink: "--foreground",
    muted: "--muted-foreground",
    primary: "--primary",
    border: "--border",
    card: "--card",
    accent: "--accent",
  };
  const palette = await page.evaluate((vars) => {
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const probe = document.createElement("div");
    document.documentElement.appendChild(probe);
    const out: Record<string, string> = {};
    for (const [name, v] of Object.entries(vars)) {
      probe.style.color = `var(${v})`;
      c.fillStyle = "#000";
      c.fillStyle = getComputedStyle(probe).color;
      c.fillRect(0, 0, 1, 1);
      const d = c.getImageData(0, 0, 1, 1).data;
      out[name] = "#" + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, "0")).join("");
    }
    probe.remove();
    return out;
  }, vars);
  mkdirSync(OVERLAYS, { recursive: true });
  writeFileSync(cache, JSON.stringify(palette, null, 2));
  return palette as Palette;
}

// ── templates ───────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The feather logo tile (same drawing as src/app/icon.svg). */
export async function logoSvg(): Promise<string> {
  const cache = path.join(OVERLAYS, "icon.svg");
  if (existsSync(cache)) return readFileSync(cache, "utf8");
  const svg = await (await fetch(`${PROD_URL}/icon.svg`)).text();
  mkdirSync(OVERLAYS, { recursive: true });
  writeFileSync(cache, svg);
  return svg;
}
const logoImg = (svg: string, size: number) =>
  `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="display:block;border-radius:${size * 0.22}px">`;

/** Walkthrough caption, in the band under the browser frame. */
export const caption16 = (text: string): Overlay => ({
  key: "cap16",
  width: 1720,
  height: 176,
  html: `<div class="balance" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;
    font-size:47px;line-height:1.2;font-weight:600;letter-spacing:-0.01em">${esc(text)}</div>`,
});

/** Reel caption, in the top safe area. */
export const captionReel = (text: string): Overlay => ({
  key: "capreel",
  width: 840,
  height: 330,
  html: `<div class="balance" style="width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;text-align:center;
    font-size:64px;line-height:1.14;font-weight:650;letter-spacing:-0.015em">${esc(text)}</div>`,
});

export const title16 = (kicker: string, title: string, sub: string): Overlay => ({
  key: "title16",
  width: 1920,
  height: 1080,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 220px">
    <div class="red" style="font-size:32px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase">${esc(kicker)}</div>
    <div class="serif" style="font-size:132px;line-height:1.02;margin-top:22px;letter-spacing:-0.02em">${esc(title)}</div>
    <div class="muted balance" style="font-size:46px;line-height:1.3;margin-top:34px;max-width:1300px">${esc(sub)}</div>
  </div>`,
});

export const titleReel = (kicker: string, title: string, sub: string): Overlay => ({
  key: "titlereel",
  width: 1080,
  height: 1920,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 160px 120px 90px">
    <div class="red" style="font-size:34px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase">${esc(kicker)}</div>
    <div class="serif" style="font-size:120px;line-height:1.02;margin-top:20px">${esc(title)}</div>
    <div class="muted balance" style="font-size:52px;line-height:1.25;margin-top:30px">${esc(sub)}</div>
  </div>`,
});

/** The intro title: logo, name, one line. */
export const intro16 = (svg: string, line: string): Overlay => ({
  key: "intro16",
  width: 1920,
  height: 1080,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="display:flex;align-items:center;gap:36px">${logoImg(svg, 150)}
      <div class="serif" style="font-size:150px;line-height:1">InkBoard</div></div>
    <div class="balance" style="font-size:54px;line-height:1.25;margin-top:56px;max-width:1300px;font-weight:500">${esc(line)}</div>
  </div>`,
});

export const outro16 = (line1: string, line2: string): Overlay => ({
  key: "outro16",
  width: 1920,
  height: 1080,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div class="serif" style="font-size:118px;line-height:1.05">${esc(line1)}</div>
    <div style="font-size:58px;line-height:1.25;margin-top:34px;font-weight:600" class="red">${esc(line2)}</div>
  </div>`,
});

export const outroReel = (line1: string, line2: string): Overlay => ({
  key: "outroreel",
  width: 1080,
  height: 1920,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 150px 160px 70px">
    <div class="serif balance" style="font-size:112px;line-height:1.05">${esc(line1)}</div>
    <div class="red balance" style="font-size:62px;line-height:1.2;margin-top:36px;font-weight:600">${esc(line2)}</div>
  </div>`,
});

export const endCard16 = (svg: string): Overlay => ({
  key: "end16",
  width: 1920,
  height: 1080,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
    ${logoImg(svg, 190)}
    <div class="serif" style="font-size:132px;line-height:1;margin-top:44px">InkBoard</div>
    <div style="font-size:54px;margin-top:40px;font-weight:600;letter-spacing:-0.005em">${esc(LIVE_HOST)}</div>
  </div>`,
});

export const endCardReel = (svg: string): Overlay => ({
  key: "endreel",
  width: 1080,
  height: 1920,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 80px 200px 0">
    ${logoImg(svg, 200)}
    <div class="serif" style="font-size:138px;line-height:1;margin-top:44px">InkBoard</div>
    <div style="font-size:58px;margin-top:40px;font-weight:600">${esc(LIVE_HOST)}</div>
  </div>`,
});

/** Browser title bar with an address pill (drawn at 2x for the reel's zooms). */
export const browserBar = (url: string, width: number): Overlay => {
  let host = LIVE_HOST;
  let rest = "";
  try {
    const u = new URL(url);
    rest = u.pathname === "/" ? "" : u.pathname;
    rest += u.search;
  } catch {
    host = url;
  }
  return {
    key: "bar",
    width,
    height: 52,
    scale: 2,
    html: `<div style="width:100%;height:100%;display:flex;align-items:center;padding:0 18px;gap:9px;background:#efe8dc;
      border-radius:16px 16px 0 0;border-bottom:1px solid rgba(60,40,20,.10)">
      <span style="width:13px;height:13px;border-radius:50%;background:#e9695e"></span>
      <span style="width:13px;height:13px;border-radius:50%;background:#e9b84f"></span>
      <span style="width:13px;height:13px;border-radius:50%;background:#6cbf5d"></span>
      <div style="flex:1;display:flex;justify-content:center;padding-right:60px">
        <div style="min-width:520px;max-width:900px;height:32px;border-radius:9px;background:rgba(255,253,248,.92);
          display:flex;align-items:center;justify-content:center;gap:8px;font-size:15.5px;padding:0 18px;
          box-shadow:inset 0 0 0 1px rgba(60,40,20,.08)">
          <svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="6" width="10" height="7.5" rx="2" fill="#7b6f63"/><path d="M3.3 6V4.4a2.7 2.7 0 0 1 5.4 0V6" stroke="#7b6f63" stroke-width="1.6" fill="none"/></svg>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:#2b211b">${esc(host)}</span><span style="color:#7b6f63">${esc(rest)}</span></span>
        </div>
      </div>
    </div>`,
  };
};

/** A generic link preview (as a chat app shows a shared link), around the real share card image. */
export const linkPreview = (ogPng: string, title: string, url: string, width: number): Overlay => ({
  key: "preview",
  width,
  height: Math.round(width * 0.525 + 200),
  scale: 2,
  html: `<div style="width:100%;height:100%;padding:14px">
    <div style="border-radius:22px;overflow:hidden;background:#fffdf8;box-shadow:0 20px 50px -18px rgba(50,30,15,.45),0 0 0 1px rgba(60,40,20,.08)">
      <img src="data:image/png;base64,${readFileSync(ogPng).toString("base64")}" style="display:block;width:100%;aspect-ratio:1200/630">
      <div style="padding:20px 26px 24px">
        <div class="muted" style="font-size:19px">${esc(new URL(url).host)}</div>
        <div style="font-size:26px;font-weight:600;margin-top:6px">${esc(title)}</div>
      </div>
    </div></div>`,
});

/** A downloaded file, shown as a document card with its first lines. */
export const fileCard = (name: string, text: string, width: number, height: number): Overlay => ({
  key: "file",
  width,
  height,
  scale: 2,
  html: `<div style="width:100%;height:100%;padding:14px">
    <div style="height:100%;border-radius:20px;overflow:hidden;background:#fffdf8;box-shadow:0 22px 50px -18px rgba(50,30,15,.45),0 0 0 1px rgba(60,40,20,.08);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:12px;padding:16px 22px;background:#efe8dc;font-size:19px;font-weight:600">
        <svg width="18" height="22" viewBox="0 0 18 22"><path d="M2 1h9l5 5v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="#fff" stroke="#7b6f63" stroke-width="1.5"/><path d="M11 1v5h5" fill="none" stroke="#7b6f63" stroke-width="1.5"/></svg>
        ${esc(name)}</div>
      <pre style="margin:0;padding:20px 24px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:17px;line-height:1.5;white-space:pre-wrap;color:#2b211b;flex:1;overflow:hidden">${esc(text)}</pre>
    </div></div>`,
});

/** Thumbnail text block. */
export const coverText = (svg: string, title: string, sub: string, width: number, height: number, size: number): Overlay => ({
  key: "cover",
  width,
  height,
  html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center">
    <div style="display:flex;align-items:center;gap:${size * 0.22}px">${logoImg(svg, size * 0.9)}
      <div class="serif" style="font-size:${size}px;line-height:1">InkBoard</div></div>
    <div class="balance" style="font-size:${size * 0.62}px;line-height:1.1;margin-top:${size * 0.35}px;font-weight:700;letter-spacing:-0.02em">${esc(title)}</div>
    <div class="red balance" style="font-size:${size * 0.36}px;line-height:1.25;margin-top:${size * 0.22}px;font-weight:600">${esc(sub)}</div>
  </div>`,
});
