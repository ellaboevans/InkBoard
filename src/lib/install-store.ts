"use client";

import {
  autoCard,
  detectPlatform,
  INSTALLED_DISPLAY_MODES,
  installMethod,
  isRunningInstalled,
  NOT_NOW_MS,
  parseMemory,
  PROMPT_READY_EVENT,
  readerReady,
  recordPoem,
  recordVisit,
  type Audience,
  type InstallMemory,
  type InstallMethod,
  type Platform,
} from "./install-nudge";

/*
 * Client-only store behind the install nudge (docs/PLAN.md, Phase 15), read
 * with useSyncExternalStore. Nothing here runs on the server: the server
 * snapshot is "nothing to show", so prerendering and hydration never see it.
 *
 * It lives at module level (not in React state), so the card can't re-show
 * when a route kept in <Activity> is shown again, and a visit is counted once
 * per page load however often components mount.
 *
 * `beforeinstallprompt` can fire before React hydrates, so an inline script
 * in the root layout (INSTALL_CAPTURE_SCRIPT) catches it first and parks it
 * on window; the store picks it up from there.
 */

type PromptEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
declare global {
  interface Window {
    __inkboardInstallPrompt?: PromptEvent;
  }
}


const STORAGE_KEY = "inkboard-install";
export type SlotKind = "board-bottom" | "board-top" | "editor";

export type InstallSnapshot = {
  /** False on the server and until the store has read the browser. */
  ready: boolean;
  platform: Platform;
  /** How to install here; null when it isn't possible or InkBoard is already installed. */
  method: InstallMethod;
  /** The card to show, and whether the person asked for it (toolbar button, account menu). */
  card: { audience: Audience; manual: boolean } | null;
  /** Wide screens show the card under the toolbar; phones in the bottom column. */
  wide: boolean;
  /** The card is folding back into the toolbar button ("Not now" on wide screens). */
  folding: boolean;
  /** Briefly ring the toolbar button after the card folded into it. */
  pulse: boolean;
  slots: Partial<Record<SlotKind, HTMLElement>>;
};

const SERVER: InstallSnapshot = {
  ready: false,
  platform: { kind: "desktop" },
  method: null,
  card: null,
  wide: false,
  folding: false,
  pulse: false,
  slots: {},
};

let snapshot = SERVER;
const listeners = new Set<() => void>();
let started = false;
let memory: InstallMemory = parseMemory(null);
let platform: Platform = { kind: "desktop" };
let runningInstalled = false;
let wide = false;
let manual: Audience | null = null;
/** The auto card was closed in this page load (Not now / Got it / Esc / installed). */
let closed = false;
let folding = false;
let pulse = false;
let recheck: ReturnType<typeof setTimeout> | undefined;
const slots: Partial<Record<SlotKind, HTMLElement>> = {};

function load(): InstallMemory {
  try {
    return parseMemory(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseMemory(null); // private mode / storage blocked: behave as a first visit
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Not remembered; fine.
  }
}

function emit() {
  const now = Date.now();
  const prompt = window.__inkboardInstallPrompt;
  const method = runningInstalled || memory.installed ? null : installMethod(platform, Boolean(prompt));
  const auto = closed
    ? null
    : autoCard({
        memory,
        now,
        method,
        installed: runningInstalled,
        onBoard: Boolean(slots["board-bottom"] || slots["board-top"]),
        inEditor: Boolean(slots.editor),
      });
  const card = method && manual ? { audience: manual, manual: true } : auto ? { audience: auto, manual: false } : null;

  // A reader who opened two poems quickly: look again once the grace period is over.
  clearTimeout(recheck);
  const r = readerReady(memory, now);
  if (!card && typeof r === "object") recheck = setTimeout(emit, r.at - now + 50);

  snapshot = { ready: true, platform, method, card, wide, folding, pulse, slots: { ...slots } };
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const installedQuery = matchMedia(INSTALLED_DISPLAY_MODES.map((m) => `(display-mode: ${m})`).join(", "));
  const nav = navigator as Navigator & { standalone?: boolean };
  runningInstalled = isRunningInstalled(installedQuery.matches, nav.standalone);
  installedQuery.addEventListener("change", (e) => {
    runningInstalled = isRunningInstalled(e.matches, nav.standalone);
    emit();
  });
  const wideQuery = matchMedia("(min-width: 640px)"); // Tailwind's sm, like the toolbar
  wide = wideQuery.matches;
  wideQuery.addEventListener("change", (e) => {
    wide = e.matches;
    emit();
  });
  memory = recordVisit(load(), Date.now());
  save();
  addEventListener(PROMPT_READY_EVENT, emit);
  addEventListener("appinstalled", () => {
    window.__inkboardInstallPrompt = undefined;
    memory = { ...memory, installed: true };
    save();
    manual = null;
    closed = true;
    emit();
  });
  emit();
}

export function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => SERVER;

// ---- Actions (called from event handlers, never from render or effects) ------

/** Where the card may render. Used as a ref callback; returns its cleanup. */
export function registerSlot(kind: SlotKind, el: HTMLElement | null) {
  if (!el) return;
  slots[kind] = el;
  if (started) emit();
  return () => {
    if (slots[kind] === el) delete slots[kind];
    if (started) emit();
  };
}

/** A poem was shown to a reader (idempotent per poem). */
export function notePoemOpened(id: string) {
  start();
  const next = recordPoem(memory, id);
  if (next === memory) return;
  memory = next;
  save();
  emit();
}

/** The editor's first-ever publish just happened in this browser. */
export function noteFirstPublish() {
  start();
  memory = { ...memory, writerAt: Date.now() };
  closed = false;
  save();
  emit();
}

/** Toolbar button / account menu: the native prompt where there is one, else the instructions. */
export function requestInstall(audience: Audience) {
  if (snapshot.method === "prompt") return void promptInstall();
  manual = snapshot.card?.manual && snapshot.card.audience === audience ? null : audience;
  folding = false;
  emit();
}

/** "Install": must run inside the click (the prompt needs a user gesture). */
export async function promptInstall() {
  const event = window.__inkboardInstallPrompt;
  if (!event) return;
  // An event can prompt once; the browser fires a new one if it's still installable later.
  window.__inkboardInstallPrompt = undefined;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "dismissed") return notNow();
  // Accepted: the writer card is done with (a full page load mustn't re-arm it).
  memory = { ...memory, writerAt: undefined };
  save();
  manual = null;
  closed = true;
  emit(); // `appinstalled` follows and hides everything for good
}

/** "Not now" (and Esc): hidden for 30 days. On wide screens it folds back into the toolbar button. */
export function notNow() {
  memory = { ...memory, notNowUntil: Date.now() + NOT_NOW_MS, writerAt: undefined };
  save();
  const fold = wide && Boolean(slots["board-top"]) && snapshot.card?.audience === "reader";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (fold && !reduced) {
    folding = true;
    emit();
    return; // finishFold() runs when the animation ends
  }
  close(fold);
}

/** "Got it" (iOS / Mac Safari, which have no prompt): hidden for good. */
export function gotIt() {
  memory = { ...memory, gotIt: true, writerAt: undefined };
  save();
  close(false);
}

export function finishFold() {
  if (folding) close(true);
}

function close(pulseButton: boolean) {
  manual = null;
  closed = true;
  folding = false;
  pulse = pulseButton;
  emit();
  if (pulseButton) {
    setTimeout(() => {
      pulse = false;
      emit();
    }, 2400);
  }
}
