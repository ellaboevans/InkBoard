/**
 * Records one "take": a real browser session driven like a person would,
 * captured frame by frame through the Chrome DevTools screencast at device
 * scale 2 (desktop) or 3 (phone), plus a timeline of what the edit needs:
 * captions, camera focus rectangles, the page URL (for the frame's address
 * bar) and named marks.
 *
 * Output: video/.out/takes/<id>/{000001.jpg, …, take.json}.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { TAKES } from "./config";
import { pageDecorScript } from "./inject";

export type Rect = { x: number; y: number; width: number; height: number };
export type TakeEvent =
  | { t: number; type: "caption"; text: string; min: number }
  | { t: number; type: "focus"; rect: Rect; maxZoom?: number }
  | { t: number; type: "unfocus" }
  | { t: number; type: "url"; url: string }
  | { t: number; type: "mark"; name: string }
  | { t: number; type: "cut"; on: boolean }
  | { t: number; type: "speed"; on: boolean; factor: number };

export type Frame = { file: string; t: number };
export type Take = {
  id: string;
  device: "desktop" | "phone";
  viewport: { width: number; height: number };
  scale: number;
  start: number;
  end: number;
  frames: Frame[];
  events: TakeEvent[];
  toasts: { title: string; state: string | null }[];
  problems: string[];
};

export const DESKTOP = { width: 1280, height: 720, scale: 2 };
export const PHONE = { width: 390, height: 844, scale: 3 };
export const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
export const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const now = () => Date.now() / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** How long a caption must stay on screen to be read comfortably (seconds). */
export function readTime(text: string) {
  const words = text.trim().split(/\s+/).length;
  return Math.max(2.4, 0.9 + words * 0.29);
}

/**
 * One browser per device scale: the screencast only delivers full-resolution
 * frames when Chrome itself runs at that scale (--force-device-scale-factor);
 * the context's deviceScaleFactor alone gives CSS-size frames.
 */
const browsers = new Map<number, Browser>();
export async function getBrowser(scale = 1) {
  let b = browsers.get(scale);
  if (!b) {
    b = await chromium.launch({
      channel: process.env.PW_CHANNEL ?? "chrome",
      headless: true,
      args: ["--hide-scrollbars", "--font-render-hinting=none", "--disable-features=Translate", `--force-device-scale-factor=${scale}`],
    });
    browsers.set(scale, b);
  }
  return b;
}
export async function closeBrowser() {
  for (const b of browsers.values()) await b.close().catch(() => {});
  browsers.clear();
}

export class Recorder {
  readonly dir: string;
  private frames: Frame[] = [];
  private events: TakeEvent[] = [];
  private problems: string[] = [];
  private cdp?: CDPSession;
  private page?: Page;
  private seq = 0;
  private start = 0;
  private captionUntil = 0;
  private recording = false;
  private writes: Promise<void>[] = [];
  private mouse: [number, number] = [640, 400];
  readonly contexts: BrowserContext[] = [];

  constructor(
    readonly id: string,
    readonly device: "desktop" | "phone",
  ) {
    this.dir = path.join(TAKES, id);
  }

  get viewport() {
    return this.device === "phone" ? PHONE : DESKTOP;
  }

  /** A fresh browser context ("a computer"), decorated for the camera. */
  async context(options: BrowserContextOptions = {}) {
    const vp = this.viewport;
    const b = await getBrowser(vp.scale);
    const ctx = await b.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.scale,
      locale: "en-GB",
      timezoneId: "Africa/Accra",
      colorScheme: "light",
      reducedMotion: "no-preference",
      ...(this.device === "phone"
        ? { isMobile: true, hasTouch: true, userAgent: ANDROID_UA }
        : { userAgent: MAC_UA }),
      ...options,
    });
    await ctx.addInitScript({ content: pageDecorScript(this.device === "phone" ? "touch" : "mouse") });
    this.contexts.push(ctx);
    return ctx;
  }

  /** Start capturing `page` (switching from the previous one, if any). */
  async attach(page: Page) {
    if (this.cdp) await this.detachCdp();
    this.page = page;
    page.on("pageerror", (e) => this.problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|ERR_INTERNET_DISCONNECTED|_vercel\/insights|status of 404/.test(m.text())) {
        this.problems.push(`console: ${m.text().slice(0, 300)}`);
      }
    });
    page.on("requestfailed", (r) => {
      const err = r.failure()?.errorText ?? "";
      if (!/ERR_ABORTED|ERR_INTERNET_DISCONNECTED/.test(err) && !r.url().includes("_vercel")) this.problems.push(`requestfailed: ${r.url()} ${err}`);
    });
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame() && this.recording) this.events.push({ t: now(), type: "url", url: f.url() });
    });
    const cdp = await page.context().newCDPSession(page);
    this.cdp = cdp;
    const vp = this.viewport;
    cdp.on("Page.screencastFrame", (f) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      if (!this.recording) return;
      const ts = f.metadata.timestamp && Math.abs(f.metadata.timestamp - now()) < 2 ? f.metadata.timestamp : now();
      const file = `${String(++this.seq).padStart(6, "0")}.jpg`;
      this.frames.push({ file, t: ts });
      this.writes.push(writeFile(path.join(this.dir, file), Buffer.from(f.data, "base64")));
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: vp.width * vp.scale,
      maxHeight: vp.height * vp.scale,
      everyNthFrame: 1,
    });
    if (this.recording) this.events.push({ t: now(), type: "url", url: page.url() });
    // The cursor appears where the pointer is.
    if (this.device === "desktop") await page.mouse.move(this.mouse[0], this.mouse[1]);
  }

  private async detachCdp() {
    try {
      await this.cdp?.send("Page.stopScreencast");
      await this.cdp?.detach();
    } catch {}
    this.cdp = undefined;
  }

  get p(): Page {
    if (!this.page) throw new Error("No page attached");
    return this.page;
  }

  /** Begin the take (frames before this are discarded). */
  async begin() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    await this.settle();
    this.start = now();
    this.recording = true;
    this.events.push({ t: this.start, type: "url", url: this.p.url() });
    // Nudge a repaint so the take starts with a frame.
    await this.p.evaluate(() => document.documentElement.getBoundingClientRect());
    if (this.device === "desktop") await this.p.mouse.move(this.mouse[0] + 1, this.mouse[1]);
    await sleep(300);
  }

  /** Wait for fonts, images and animations to settle. */
  async settle(ms = 400) {
    try {
      await this.p.waitForLoadState("load", { timeout: 15_000 });
      await this.p.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => i.addEventListener("load", r, { once: true }))),
        );
      });
    } catch {}
    await sleep(ms);
  }

  async end(name = this.id) {
    await this.captionDone();
    await sleep(400);
    this.recording = false;
    const toasts = this.page
      ? await this.page.evaluate(() => (window as unknown as { __vtoasts?: { title: string; state: string | null }[] }).__vtoasts ?? []).catch(() => [])
      : [];
    await this.detachCdp();
    await Promise.all(this.writes);
    const take: Take = {
      id: name,
      device: this.device,
      viewport: { width: this.viewport.width, height: this.viewport.height },
      scale: this.viewport.scale,
      start: this.start,
      end: now(),
      frames: this.frames,
      events: this.events,
      toasts: [...this.toastLog, ...toasts],
      problems: this.problems,
    };
    writeFileSync(path.join(this.dir, "take.json"), JSON.stringify(take, null, 1));
    for (const c of this.contexts) await c.close().catch(() => {});
    const errors = take.toasts.filter((t) => t.state === "error");
    console.log(
      `  ✓ ${name}: ${(take.end - take.start).toFixed(1)}s, ${take.frames.length} frames` +
        (errors.length ? `, ERROR TOASTS: ${errors.map((e) => e.title).join("; ")}` : "") +
        (take.problems.length ? `\n    problems:\n    - ${take.problems.join("\n    - ")}` : ""),
    );
    if (errors.length) throw new Error(`Take ${name} showed an error toast: ${errors[0].title}`);
    return take;
  }

  private toastLog: { title: string; state: string | null }[] = [];
  /** Keep the toasts of the current page before navigating away from it. */
  async collectToasts() {
    const toasts = await this.p
      .evaluate(() => {
        const w = window as unknown as { __vtoasts?: { title: string; state: string | null }[] };
        const out = w.__vtoasts?.splice(0) ?? [];
        return out;
      })
      .catch(() => []);
    this.toastLog.push(...toasts);
  }

  // ── timeline ──────────────────────────────────────────────────────────

  /** Show a caption; waits until the previous one has been readable long enough. */
  async caption(text: string, { min }: { min?: number } = {}) {
    await this.captionDone();
    const hold = min ?? readTime(text);
    this.events.push({ t: now(), type: "caption", text, min: hold });
    this.captionUntil = now() + hold;
  }

  /** Wait until the current caption has been on screen for its reading time. */
  async captionDone() {
    const left = this.captionUntil - now();
    if (left > 0) await sleep(left * 1000);
  }

  mark(name: string) {
    this.events.push({ t: now(), type: "mark", name });
  }

  /** Point the camera at an element or rectangle (CSS px in the viewport). */
  async focus(target: Locator | Rect, { pad = 28, maxZoom }: { pad?: number; maxZoom?: number } = {}) {
    const box = "x" in target ? target : await target.boundingBox();
    if (!box) throw new Error("focus: target not visible");
    const vp = this.viewport;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const rect = {
      x,
      y,
      width: Math.min(vp.width, box.x + box.width + pad) - x,
      height: Math.min(vp.height, box.y + box.height + pad) - y,
    };
    this.events.push({ t: now(), type: "focus", rect, maxZoom });
  }

  unfocus() {
    this.events.push({ t: now(), type: "unfocus" });
  }

  /** Leave out what happens inside (e.g. waiting for a server); the edit cross-fades over it. */
  async cut<T>(fn: () => Promise<T>): Promise<T> {
    const t0 = now();
    this.events.push({ t: t0, type: "cut", on: true });
    try {
      return await fn();
    } finally {
      await sleep(150);
      const t1 = now();
      this.events.push({ t: t1, type: "cut", on: false });
      // The cut time never reaches the screen: the caption must stay that much longer.
      if (this.captionUntil > t0) this.captionUntil += t1 - t0;
    }
  }

  /**
   * Play what happens inside faster in the edit (typing, mostly). Captions
   * already on screen get the time back, so they stay readable.
   */
  async fast<T>(fn: () => Promise<T>, factor = 1.8): Promise<T> {
    const t0 = now();
    this.events.push({ t: t0, type: "speed", on: true, factor });
    try {
      return await fn();
    } finally {
      const t1 = now();
      this.events.push({ t: t1, type: "speed", on: false, factor });
      if (this.captionUntil > t0) this.captionUntil += (t1 - t0) * (1 - 1 / factor);
    }
  }

  async hold(ms: number) {
    await sleep(ms);
  }

  // ── pointer and keyboard, at human speed ──────────────────────────────

  async moveTo(x: number, y: number, duration?: number) {
    const [x0, y0] = this.mouse;
    const dist = Math.hypot(x - x0, y - y0);
    const ms = duration ?? Math.min(900, Math.max(300, dist * 1.1));
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await this.p.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k);
      await sleep(ms / steps / 2);
    }
    this.mouse = [x, y];
  }

  async center(target: Locator, { dx = 0.5, dy = 0.5 } = {}) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("target not visible");
    return [box.x + box.width * dx, box.y + box.height * dy] as const;
  }

  /** Move to an element and click it, like a person: a short pause before pressing. */
  async click(target: Locator, opts: { dx?: number; dy?: number; pause?: number } = {}) {
    await target.waitFor({ state: "visible" });
    if (this.device === "phone") return this.tap(target, opts);
    const [x, y] = await this.center(target, opts);
    await this.moveTo(x, y);
    await sleep(opts.pause ?? 180);
    await this.p.mouse.down();
    await sleep(70);
    await this.p.mouse.up();
    await sleep(250);
  }

  async hover(target: Locator, opts: { dx?: number; dy?: number } = {}) {
    const [x, y] = await this.center(target, opts);
    await this.moveTo(x, y);
  }

  /** Type into a field at a steady pace (click it first). */
  async type(target: Locator, text: string, { delay = 55, click = true, fast }: { delay?: number; click?: boolean; fast?: number } = {}) {
    if (click) await this.click(target);
    const keys = async () => {
      for (const ch of text) {
        if (ch === "\n") await this.p.keyboard.press("Enter");
        else await this.p.keyboard.insertText(ch);
        await sleep(delay + (/[ ,.]/.test(ch) ? delay * 0.8 : 0));
      }
    };
    // Typing plays faster in the edit (as in most product demos); 1 = real time.
    const factor = fast ?? (text.length > 10 ? 1.8 : 1.4);
    if (factor === 1) await keys();
    else await this.fast(keys, factor);
  }

  async press(key: string, pause = 250) {
    await this.p.keyboard.press(key);
    await sleep(pause);
  }

  /** Smooth wheel scrolling (desktop) at the current pointer position. */
  async wheel(dy: number, { dx = 0, ms = 700, ctrl = false } = {}) {
    const steps = Math.max(4, Math.round(ms / 20));
    let done = 0;
    let doneX = 0;
    if (ctrl) await this.p.keyboard.down("Control");
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      const target = dy * k;
      const targetX = dx * k;
      await this.p.mouse.wheel(targetX - doneX, target - done);
      done = target;
      doneX = targetX;
      await sleep(ms / steps);
    }
    if (ctrl) await this.p.keyboard.up("Control");
  }

  /** Scroll the page so the element sits `offset` px from the top, smoothly. */
  async scrollTo(target: Locator, { offset = 120, ms = 800 } = {}) {
    // Re-measure and continue: images loading can lengthen the page mid-scroll.
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = await target.boundingBox();
      if (!box) throw new Error("scrollTo: not visible");
      const dy = box.y - offset;
      if (Math.abs(dy) < 24) return;
      if (this.device === "phone") {
        await this.swipeScroll(dy, ms);
      } else {
        // Scroll where the content is (the pointer may still be over a sidebar).
        const [mx, my] = this.mouse;
        const x = Math.min(1200, Math.max(box.x + 20, Math.min(box.x + box.width - 20, mx)));
        if (Math.abs(x - mx) > 4) await this.moveTo(x, Math.min(620, Math.max(120, my)));
        await this.wheel(dy, { ms: attempt === 0 ? ms : ms / 2 });
      }
      await sleep(300);
    }
  }

  // ── touch (phone) ─────────────────────────────────────────────────────

  private async touch(type: "touchStart" | "touchMove" | "touchEnd", points: [number, number][]) {
    await this.cdp!.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })),
    });
  }

  async tap(target: Locator, opts: { dx?: number; dy?: number; pause?: number } = {}) {
    const [x, y] = await this.center(target, opts);
    await sleep(opts.pause ?? 250);
    await this.touch("touchStart", [[x, y]]);
    await sleep(110);
    await this.touch("touchEnd", []);
    await sleep(300);
  }

  /** One-finger drag from (x, y) by (dx, dy). */
  async drag(x: number, y: number, dx: number, dy: number, ms = 900) {
    const steps = Math.round(ms / 16);
    await this.touch("touchStart", [[x, y]]);
    await sleep(80);
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await this.touch("touchMove", [[x + dx * k, y + dy * k]]);
      await sleep(ms / steps);
    }
    await sleep(60);
    await this.touch("touchEnd", []);
  }

  /** Two-finger pinch around (x, y): distance d0 → d1. */
  async pinch(x: number, y: number, d0: number, d1: number, ms = 1000) {
    const steps = Math.round(ms / 16);
    const pts = (d: number): [number, number][] => [
      [x - d / 2, y - d / 4],
      [x + d / 2, y + d / 4],
    ];
    await this.touch("touchStart", pts(d0));
    for (let i = 1; i <= steps; i++) {
      await this.touch("touchMove", pts(d0 + (d1 - d0) * ease(i / steps)));
      await sleep(ms / steps);
    }
    await this.touch("touchEnd", []);
  }

  /** Scroll a phone page by swiping (content moves up for dy > 0). */
  async swipeScroll(dy: number, ms = 800) {
    const vp = this.viewport;
    let left = dy;
    while (Math.abs(left) > 2) {
      const step = Math.sign(left) * Math.min(Math.abs(left), vp.height * 0.45);
      await this.drag(vp.width * 0.6, vp.height * 0.62, 0, -step, ms);
      left -= step;
      await sleep(350);
    }
  }

  // ── mouse drag (desktop) ──────────────────────────────────────────────

  async mouseDrag(fromX: number, fromY: number, dx: number, dy: number, ms = 1000) {
    await this.moveTo(fromX, fromY);
    await sleep(150);
    await this.p.mouse.down();
    const steps = Math.round(ms / 16);
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await this.p.mouse.move(fromX + dx * k, fromY + dy * k);
      await sleep(ms / steps / 1.4);
    }
    this.mouse = [fromX + dx, fromY + dy];
    // Hold still before letting go, so the board doesn't fling.
    await sleep(220);
    await this.p.mouse.move(fromX + dx, fromY + dy);
    await sleep(80);
    await this.p.mouse.up();
    await sleep(200);
  }
}
