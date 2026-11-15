/**
 * Pure rules for the "install InkBoard" nudge (docs/PLAN.md, Phase 15):
 * which platform we're on, how installing works there, whether we're already
 * running as the installed app, and when the card may appear.
 *
 * No DOM access here: the client store (src/lib/install-store.ts) feeds in
 * the user agent, media queries and the remembered state, so all of this is
 * unit-tested (tests/install-nudge.test.ts).
 */

export const PROMPT_READY_EVENT = "inkboard:install-prompt";

/**
 * Served as /install-capture.js (src/app/install-capture.js/route.ts) and
 * loaded by the root layout as an async resource script: catches
 * `beforeinstallprompt` before the page's load event and keeps it on window
 * (Chrome then skips its own mini-infobar). The client store picks it up
 * from there.
 */
export const INSTALL_CAPTURE_SCRIPT = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__inkboardInstallPrompt=e;dispatchEvent(new Event("${PROMPT_READY_EVENT}"))});`;

export type Platform =
  /** iPhone / iPad: no install API; "Share → Add to Home Screen" (Safari and, since iOS 16.4, other browsers). */
  | { kind: "ios"; device: "iphone" | "ipad"; safari: boolean }
  /** Safari 17+ on a Mac: File › Add to Dock. */
  | { kind: "mac-safari" }
  /** Any other phone browser: installable only if it fires `beforeinstallprompt` (Chrome, Edge, Samsung Internet). */
  | { kind: "mobile" }
  /** Any other desktop browser: same, via `beforeinstallprompt` (Chrome, Edge); Firefox never fires it. */
  | { kind: "desktop" };

/** How installing works here: the browser's own prompt, iOS share-sheet steps, or the Mac menu. */
export type InstallMethod = "prompt" | "ios" | "mac" | null;

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  // iPadOS 13+ says "Macintosh"; a touch screen gives it away.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (iPad || /iPhone|iPod/.test(ua)) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo/.test(ua);
    return { kind: "ios", device: iPad ? "ipad" : "iphone", safari: !otherBrowser };
  }
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)) {
    const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
    if (version >= 17) return { kind: "mac-safari" };
    return { kind: "desktop" }; // older Safari: can't install
  }
  return /Android|Mobile/.test(ua) ? { kind: "mobile" } : { kind: "desktop" };
}

/** Phones get the home-screen copy and the bottom-of-the-board placement's touch sizes. */
export const isPhoneLike = (p: Platform) => p.kind === "mobile" || (p.kind === "ios" && p.device === "iphone");

export function installMethod(p: Platform, hasPrompt: boolean): InstallMethod {
  if (hasPrompt) return "prompt";
  if (p.kind === "ios") return "ios";
  if (p.kind === "mac-safari") return "mac";
  return null;
}

/** Display modes an installed InkBoard window runs in (not "fullscreen": a browser tab in F11 matches that). */
export const INSTALLED_DISPLAY_MODES = ["standalone", "minimal-ui", "window-controls-overlay"] as const;

export function isRunningInstalled(displayModeMatches: boolean, navigatorStandalone: boolean | undefined): boolean {
  return displayModeMatches || navigatorStandalone === true;
}

// ---- Remembered state (localStorage, per browser) ---------------------------

export const VISIT_GAP_MS = 30 * 60_000; // a new visit after 30 minutes away
export const FIRST_VISIT_GRACE_MS = 20_000; // never in the first seconds of a first visit
export const NOT_NOW_MS = 30 * 24 * 60 * 60_000; // "Not now" hides it for 30 days
export const WRITER_WINDOW_MS = 10 * 60_000; // the writer card belongs to "right after" the first publish
export const POEMS_TO_NUDGE = 2;
const POEMS_KEPT = 10;

export type InstallMemory = {
  visits: number;
  /** When this visit started (ms). */
  visitStart: number;
  /** Last time the board was seen, to tell a new visit from a reload. */
  lastSeen: number;
  /** Distinct poems opened (ids, newest last, capped). */
  poems: string[];
  notNowUntil?: number;
  gotIt?: boolean;
  installed?: boolean;
  /** When this browser saw the editor's first-ever publish. */
  writerAt?: number;
};

export const emptyMemory = (): InstallMemory => ({ visits: 0, visitStart: 0, lastSeen: 0, poems: [] });

/** Validates whatever came out of localStorage; anything odd starts fresh. */
export function parseMemory(raw: string | null): InstallMemory {
  if (!raw) return emptyMemory();
  try {
    const v = JSON.parse(raw) as Partial<InstallMemory>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
    return {
      visits: num(v.visits) ?? 0,
      visitStart: num(v.visitStart) ?? 0,
      lastSeen: num(v.lastSeen) ?? 0,
      poems: Array.isArray(v.poems) ? v.poems.filter((p): p is string => typeof p === "string").slice(-POEMS_KEPT) : [],
      notNowUntil: num(v.notNowUntil),
      gotIt: v.gotIt === true || undefined,
      installed: v.installed === true || undefined,
      writerAt: num(v.writerAt),
    };
  } catch {
    return emptyMemory();
  }
}

/** Called once per page load: counts a visit when the last one was long enough ago. */
export function recordVisit(m: InstallMemory, now: number): InstallMemory {
  const newVisit = m.visits === 0 || now - m.lastSeen > VISIT_GAP_MS;
  return newVisit ? { ...m, visits: m.visits + 1, visitStart: now, lastSeen: now } : { ...m, lastSeen: now };
}

/** Idempotent (a re-mounted reader counts the same poem once). */
export function recordPoem(m: InstallMemory, id: string): InstallMemory {
  if (m.poems.includes(id)) return m;
  return { ...m, poems: [...m.poems, id].slice(-POEMS_KEPT) };
}

export function isDismissed(m: InstallMemory, now: number): boolean {
  return m.gotIt === true || (m.notNowUntil !== undefined && now < m.notNowUntil);
}

/**
 * Readers: from their second visit, or after opening two poems, but never in
 * the first seconds of a first visit. Returns when it becomes true if it
 * isn't yet (so the store can check again), else true/false.
 */
export function readerReady(m: InstallMemory, now: number): true | false | { at: number } {
  if (m.visits >= 2) return true;
  if (m.poems.length < POEMS_TO_NUDGE) return false;
  const at = m.visitStart + FIRST_VISIT_GRACE_MS;
  return now >= at ? true : { at };
}

export function writerReady(m: InstallMemory, now: number): boolean {
  return m.writerAt !== undefined && now - m.writerAt < WRITER_WINDOW_MS;
}

export type Audience = "reader" | "writer";

/**
 * Which card (if any) to show on its own, given where we are: the writer card
 * in the editor right after a first publish, the reader card on the board.
 */
export function autoCard(opts: {
  memory: InstallMemory;
  now: number;
  method: InstallMethod;
  installed: boolean;
  onBoard: boolean;
  inEditor: boolean;
}): Audience | null {
  const { memory: m, now } = opts;
  if (opts.installed || m.installed || !opts.method || isDismissed(m, now)) return null;
  if (opts.inEditor && writerReady(m, now)) return "writer";
  if (opts.onBoard && readerReady(m, now) === true) return "reader";
  return null;
}
