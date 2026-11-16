"use client";

import { detectPlatform, INSTALLED_DISPLAY_MODES, isRunningInstalled } from "./install-nudge";
import { notify } from "./notify";

/*
 * Client-only store behind "Notifications on this device" (docs/PLAN.md,
 * Phase 18), read with useSyncExternalStore like the install store: the
 * server snapshot is "unavailable", so nothing renders until the browser has
 * been asked. Actions are called from event handlers only; `syncOnOpen` runs
 * once per page load from the worker registration.
 *
 * Permission is only ever requested from the switch's own tap.
 */

export type PushStatus =
  /** Not configured on this server (no VAPID key), or not yet read: render nothing. */
  | "unavailable"
  /** This browser has no web push. */
  | "unsupported"
  /** iPhone/iPad in a browser tab: push needs the Home Screen app. */
  | "ios-install"
  /** The person (or a policy) blocked notifications for this site. */
  | "blocked"
  | "off"
  | "on";

export type PushSnapshot = {
  status: PushStatus;
  /** A tap is being handled (permission prompt, subscribing, the server). */
  busy: boolean;
  /** Notification.permission, for the after-install offer. */
  permission: NotificationPermission | "unsupported";
  /** The after-install offer was answered (turned on or "Not now"): never again. */
  offerDone: boolean;
};

const SERVER: PushSnapshot = { status: "unavailable", busy: false, permission: "unsupported", offerDone: true };
const OFFER_KEY = "inkboard-push-offer";
const SYNC_KEY = "inkboard-push-sync";
const API = "/api/push/subscription";

let snapshot = SERVER;
const listeners = new Set<() => void>();
let started = false;

const publicKey = () => process.env.INKBOARD_VAPID_PUBLIC_KEY ?? "";

function set(next: Partial<PushSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function storage(kind: "local" | "session") {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null; // blocked storage: behave as if nothing was remembered
  }
}
function read(kind: "local" | "session", key: string) {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(kind: "local" | "session", key: string, value: string) {
  try {
    storage(kind)?.setItem(key, value);
  } catch {
    // Not remembered; fine.
  }
}

function hasPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIosTab() {
  const p = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  if (p.kind !== "ios") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = isRunningInstalled(
    matchMedia(INSTALLED_DISPLAY_MODES.map((m) => `(display-mode: ${m})`).join(", ")).matches,
    nav.standalone,
  );
  return !installed;
}

/** The registration that owns subscriptions (scope "/"), without waiting for one to appear. */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  try {
    return await navigator.serviceWorker.getRegistration("/");
  } catch {
    return undefined;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  try {
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

async function refresh() {
  if (!publicKey()) return set({ status: "unavailable" });
  if (!hasPush()) {
    return set({ status: isIosTab() ? "ios-install" : "unsupported", permission: "unsupported" });
  }
  const permission = Notification.permission;
  if (permission === "denied") return set({ status: "blocked", permission });
  const sub = permission === "granted" ? await currentSubscription() : null;
  set({ status: sub ? "on" : "off", permission });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  snapshot = { ...snapshot, offerDone: read("local", OFFER_KEY) === "done" };
  void refresh();
  // Permission changed in the browser's settings while the page is open.
  navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((p) => p.addEventListener("change", () => void refresh()))
    .catch(() => {});
}

export function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => SERVER;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Was this subscription made with our current VAPID key? (A new key invalidates old subscriptions.) */
function sameKey(sub: PushSubscription): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // can't tell (older browsers): assume so
  const a = new Uint8Array(k);
  const b = keyBytes(publicKey());
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no service worker")), 15_000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

async function subscribeHere(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing)) return existing;
  if (existing) await existing.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey()) });
}

async function post(sub: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- Actions (event handlers only) ------------------------------------------

/** The switch was turned on: ask permission (this tap only), subscribe, tell the server. */
export async function turnOn() {
  if (snapshot.busy) return;
  set({ busy: true });
  try {
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      // Dismissed: still off, nothing to say. Blocked: the switch explains how to undo it.
      return set({ status: permission === "denied" ? "blocked" : "off", permission });
    }
    const sub = await subscribeHere(await readyRegistration());
    if (!(await post(sub))) {
      await sub.unsubscribe().catch(() => {});
      throw new Error("server refused");
    }
    write("session", SYNC_KEY, sub.endpoint);
    set({ status: "on", permission });
  } catch {
    notify.error("Couldn't turn on notifications", "Check your connection and try again.");
    await refresh();
  } finally {
    set({ busy: false });
  }
}

/** The switch was turned off: unsubscribe here, and delete the address on the server. */
export async function turnOff() {
  if (snapshot.busy) return;
  set({ busy: true });
  try {
    const sub = await currentSubscription();
    if (sub) {
      const deleted = await fetch(API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      await sub.unsubscribe();
      // Unsubscribed here either way; the server forgets the address at its
      // next try (the push service answers "gone").
      if (!deleted) notify.error("Turned off on this device", "We couldn't reach InkBoard just now; the address will be deleted the next time we try it.");
    }
    set({ status: "off" });
  } catch {
    notify.error("Couldn't turn off notifications", "Try again, or turn them off in your browser's settings.");
    await refresh();
  } finally {
    set({ busy: false });
  }
}

/** The after-install offer was answered: never shown again in this browser. */
export function finishOffer() {
  write("local", OFFER_KEY, "done");
  set({ offerDone: true });
}

/**
 * When the app opens with permission granted: if this browser holds a
 * subscription, make sure the server still has it (re-register quietly if it
 * lost it, or if our key changed). Once per browser session; never prompts.
 */
export async function syncOnOpen() {
  if (!publicKey() || !hasPush() || Notification.permission !== "granted") return;
  const reg = await registration();
  let sub = (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
  if (!reg || !sub) return;
  if (!sameKey(sub)) {
    try {
      sub = await subscribeHere(reg);
    } catch {
      return;
    }
  } else if (read("session", SYNC_KEY) === sub.endpoint) {
    return;
  }
  if (await post(sub)) write("session", SYNC_KEY, sub.endpoint);
  if (started) void refresh();
}
