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

/** Largest request body the subscribe/unsubscribe routes read. A real subscription is ~350 bytes. */
export const MAX_SUBSCRIPTION_BODY_BYTES = 2048;
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

/** For unsubscribing: just the endpoint, same rules. */
export function parseEndpoint(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const e = (input as Record<string, unknown>).endpoint;
  return typeof e === "string" && isAllowedPushEndpoint(e) ? e : null;
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
  /** The poem's title, as shown on the board. */
  title: string;
  /** The author's pen name ("New poem by …"). */
  author: string;
  /** The poem's path on this site, /p/<author>/<poem>. */
  url: string;
  /** One notification per poem: a second push for it replaces the first. */
  tag: string;
};

/**
 * The whole payload of a new-poem notification. Only public facts: the title
 * and pen name (both on the board) and the link. Never poem text; private
 * poems are never announced at all. A test pins these exact fields.
 */
export function newPoemPayload(p: {
  poemId: string;
  title: string;
  penName: string;
  authorSlug: string;
  poemSlug: string;
}): NewPoemPayload {
  return {
    title: p.title,
    author: p.penName,
    url: `/p/${encodeURIComponent(p.authorSlug)}/${encodeURIComponent(p.poemSlug)}`,
    tag: `poem:${p.poemId}`,
  };
}

/** RFC 8030 Topic (≤ 32 URL-safe characters): an undelivered push for the same poem is replaced. */
export function pushTopic(poemId: string): string {
  return poemId.replace(/-/g, "").slice(0, 32);
}

/** What a push service's status code means for the subscription. */
export function pushOutcome(status: number): "sent" | "gone" | "retry" | "error" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500 || status <= 0) return "retry";
  return "error"; // 400/401/403/413: our request was wrong (bad JWT, too big); keep the subscription
}
