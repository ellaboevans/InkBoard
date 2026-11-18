/**
 * Notifications about new poems (docs/PLAN.md, Phase 18; research:
 * docs/research/push-notifications.md). Pure rules shared by the server
 * (src/server/push.ts), env validation (src/env.ts) and the tests: which
 * push endpoints we accept, what a subscription must look like, the VAPID
 * subject rule, the limits and the exact payload.
 */

/** At most one notification per author per device in this window. */
export const PER_AUTHOR_WINDOW_HOURS = 12;
/** At most DEVICE_DAILY_LIMIT notifications per device in this window. */
export const DEVICE_WINDOW_HOURS = 24;
export const DEVICE_DAILY_LIMIT = 3;
/** Subscriptions we couldn't use successfully for this long are deleted (cleanup cron). */
export const UNUSED_SUBSCRIPTION_DAYS = 90;
/** The push service keeps an undelivered notification for a day: old news after that. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Largest request body the notification routes read. A subscription is ~350
 * bytes; with the browser's remembered follows (≤ MAX_FOLLOWS slugs) it stays
 * well under this.
 */
export const MAX_SUBSCRIPTION_BODY_BYTES = 8192;
export const MAX_ENDPOINT_LENGTH = 1024;

/**
 * Push services we will POST to. Anything else is refused at subscribe time,
 * so the table can't make the server send requests to arbitrary URLs.
 * - Google FCM (Chrome, Edge on Android, Samsung Internet, Firefox on Android via its bridge)
 * - Mozilla autopush (Firefox)
 * - Apple (Safari on macOS, Home Screen web apps on iOS/iPadOS)
 * - Microsoft WNS (Edge on Windows)
 */
const EXACT_HOSTS = ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"];
const HOST_SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

const B64URL = /^[A-Za-z0-9_-]+$/;
function b64urlBytes(s: string): number | null {
  const bare = s.replace(/=+$/, "");
  if (!B64URL.test(bare)) return null;
  // Unpadded base64url: 4 chars → 3 bytes.
  const rem = bare.length % 4;
  if (rem === 1) return null;
  return Math.floor(bare.length / 4) * 3 + (rem === 0 ? 0 : rem - 1);
}

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/**
 * A browser's `PushSubscription.toJSON()`, checked strictly: an allowlisted
 * https endpoint, a P-256 public key (65 bytes, uncompressed) and a 16-byte
 * auth secret. Returns null for anything else.
 */
export function parsePushSubscription(input: unknown): PushSubscriptionInput | null {
  if (!input || typeof input !== "object") return null;
  const s = input as Record<string, unknown>;
  if (typeof s.endpoint !== "string" || !isAllowedPushEndpoint(s.endpoint)) return null;
  const keys = s.keys;
  if (!keys || typeof keys !== "object") return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (p256dh.length > 100 || auth.length > 30) return null;
  if (b64urlBytes(p256dh) !== 65 || b64urlBytes(auth) !== 16) return null;
  return { endpoint: s.endpoint, p256dh: p256dh.replace(/=+$/, ""), auth: auth.replace(/=+$/, "") };
}

const RESERVED_TLDS = [".invalid", ".test", ".example", ".localhost", ".local"];
function isPlaceholderHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "0.0.0.0" || /^127\./.test(h)) return true;
  if (!h.includes(".")) return true; // "intranet" style names aren't reachable contacts
  return RESERVED_TLDS.some((t) => h.endsWith(t));
}

/**
 * Is this a VAPID `sub` claim push services accept? An https URL or a mailto:
 * address on a real domain. Apple answers BadJwtToken for localhost and
 * reserved names (measured: research doc §6.3), and RFC 8292 asks for a
 * contact URI.
 */
export function isUsableVapidSubject(subject: string): boolean {
  let url: URL;
  try {
    url = new URL(subject);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return !isPlaceholderHost(url.hostname);
  if (url.protocol === "mailto:") {
    const m = /^([^@\s]+)@([^@\s?]+)$/.exec(decodeURIComponent(url.pathname));
    return Boolean(m) && !isPlaceholderHost(m![2]);
  }
  return false;
}

/**
 * The subject to sign with: VAPID_SUBJECT if set, else the site's own URL
 * when that is a real https origin. Null means "can't send": the caller
 * reports it as a configuration error.
 */
export function resolveVapidSubject(explicit: string | undefined, site: URL): string | null {
  if (explicit) return isUsableVapidSubject(explicit) ? explicit : null;
  const origin = site.origin;
  return isUsableVapidSubject(origin) ? origin : null;
}

/** A VAPID key pair as web-push generates it: P-256, base64url. */
export function isVapidKeyPair(publicKey: string, privateKey: string): boolean {
  return b64urlBytes(publicKey) === 65 && b64urlBytes(privateKey) === 32;
}

export type NewPoemPayload = {
  /** The (latest) poem's title, as shown on the board; for a chapter, "New chapter: <novel>, Chapter n". */
  title: string;
  /** The author's pen name ("New poem by …", "3 new poems by …"). */
  author: string;
  /** One poem: /p/<author>/<poem>; one chapter: /a/<author>/n/<novel>/<chapter>. A group (count ≥ 2): the author page, /a/<author>. */
  url: string;
  /** One notification per author: a later poem in the window replaces it. */
  tag: string;
  /** Poems and chapters by this author in the current 12-hour window on this device, this one included. */
  count: number;
};

/**
 * The whole payload of a new-poem notification. Only public facts: the title
 * and pen name (both on the board), the link and the count. Never poem text;
 * private poems are never announced at all. A test pins these exact fields.
 */
export function newPoemPayload(p: {
  editorId: string;
  title: string;
  penName: string;
  authorSlug: string;
  poemSlug: string;
  count: number;
}): NewPoemPayload {
  const author = encodeURIComponent(p.authorSlug);
  return {
    title: p.title,
    author: p.penName,
    url: p.count > 1 ? `/a/${author}` : `/p/${author}/${encodeURIComponent(p.poemSlug)}`,
    tag: `author:${p.editorId}`,
    count: p.count,
  };
}

/**
 * A new chapter's notification (Phase 24): exactly the same five fields as a
 * poem's (the same type, so the worker and the limits treat them alike).
 * The title says what it is, "New chapter: The Ferry at Yeji, Chapter 4",
 * numbered among published chapters like the page; one chapter links to its
 * page, a group (count ≥ 2) to the author page. Never chapter text: chapters
 * are announced only to devices that follow the author.
 */
export function newChapterPayload(p: {
  editorId: string;
  novelTitle: string;
  number: number;
  penName: string;
  authorSlug: string;
  novelSlug: string;
  chapterSlug: string;
  count: number;
}): NewPoemPayload {
  const author = encodeURIComponent(p.authorSlug);
  return {
    title: `New chapter: ${p.novelTitle}, Chapter ${p.number}`,
    author: p.penName,
    url:
      p.count > 1
        ? `/a/${author}`
        : `/a/${author}/n/${encodeURIComponent(p.novelSlug)}/${encodeURIComponent(p.chapterSlug)}`,
    tag: `author:${p.editorId}`,
    count: p.count,
  };
}

/** RFC 8030 Topic (≤ 32 URL-safe characters), per author: an undelivered push is replaced by the newer one. */
export function pushTopic(editorId: string): string {
  return editorId.replace(/-/g, "").slice(0, 32);
}

/** Quiet updates ("3 new poems by …") per author per device, after the first alert in a window. */
export const UPDATES_PER_WINDOW = 5;

/**
 * Apple's push service (Safari on macOS, iOS Home Screen apps) doesn't
 * replace a notification with the same tag (WebKit bug 258922, open) and iOS
 * can't silence one, so an "update" would arrive as another buzzing
 * notification. Those devices get the first alert only (round 1 behaviour).
 */
export function supportsQuietUpdates(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return !(host === "push.apple.com" || host.endsWith(".push.apple.com"));
  } catch {
    return false;
  }
}

export type PushMode = "all" | "followed";
export const MAX_FOLLOWS = 100;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** A browser's preferences as it remembers them: re-applied if the server lost the subscription. */
export type PushPrefs = { mode: PushMode; follows: string[] };

export function parsePrefs(input: unknown): PushPrefs | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  if (p.mode !== "all" && p.mode !== "followed") return null;
  if (!Array.isArray(p.follows) || p.follows.length > MAX_FOLLOWS) return null;
  if (!p.follows.every((f) => typeof f === "string" && SLUG.test(f))) return null;
  return { mode: p.mode, follows: [...new Set(p.follows as string[])] };
}

/**
 * Proof that the request comes from the browser that owns a subscription:
 * its endpoint and its auth secret (which the browser keeps; the endpoint
 * alone is not enough).
 */
export type OwnerProof = { endpoint: string; auth: string };
export function parseOwnerProof(input: unknown): OwnerProof | null {
  if (!input || typeof input !== "object") return null;
  const s = input as Record<string, unknown>;
  const auth = s.auth ?? (s.keys as Record<string, unknown> | undefined)?.auth;
  if (typeof s.endpoint !== "string" || !isAllowedPushEndpoint(s.endpoint)) return null;
  if (typeof auth !== "string" || auth.length > 30 || b64urlBytes(auth) !== 16) return null;
  return { endpoint: s.endpoint, auth: auth.replace(/=+$/, "") };
}

export type PrefsOp =
  | { op: "get" }
  | { op: "mode"; mode: PushMode }
  | { op: "follow"; author: string }
  | { op: "unfollow"; author: string };
export function parsePrefsOp(input: unknown): PrefsOp | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (o.op === "get") return { op: "get" };
  if (o.op === "mode" && (o.mode === "all" || o.mode === "followed")) return { op: "mode", mode: o.mode };
  if ((o.op === "follow" || o.op === "unfollow") && typeof o.author === "string" && SLUG.test(o.author)) {
    return { op: o.op, author: o.author };
  }
  return null;
}

/** What a push service's status code means for the subscription. */
export function pushOutcome(status: number): "sent" | "gone" | "retry" | "error" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500 || status <= 0) return "retry";
  return "error"; // 400/401/403/413: our request was wrong (bad JWT, too big); keep the subscription
}
