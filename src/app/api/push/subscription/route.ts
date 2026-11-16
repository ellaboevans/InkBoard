import { getRequestMeta } from "@/server/auth/dal";
import { ipBucket } from "@/server/auth/ip";
import { relyingParty } from "@/server/auth/webauthn-config";
import { deleteSubscription, pushConfig, saveSubscription } from "@/server/push";
import { rateLimit } from "@/server/rate-limit";
import { MAX_SUBSCRIPTION_BODY_BYTES, parseEndpoint, parsePushSubscription } from "@/lib/push-rules";

/**
 * Notifications about new poems on this device (docs/PLAN.md, Phase 18).
 *   POST   { endpoint, keys: { p256dh, auth } }  turn on, or re-register (idempotent)
 *   DELETE { endpoint }                          turn off: the row is deleted
 *
 * Route handlers, not Server Actions: they run from a tap on prerendered
 * reader pages and from the quiet re-check when the app opens. Same-origin
 * only, rate-limited per IP bucket, and strict: an allowlisted push service
 * endpoint, exact key sizes, a small body.
 */
const HOUR = 60 * 60;
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

async function readSmallJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SUBSCRIPTION_BODY_BYTES) return undefined;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_SUBSCRIPTION_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function guard(request: Request, action: "subscribe" | "unsubscribe"): Promise<Response | null> {
  if (!pushConfig()) return json({ error: "not_configured" }, 404);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== relyingParty().origin) return json({ error: "forbidden" }, 403);
  const { ip } = await getRequestMeta();
  const limit = await rateLimit(`push:${action}:ip:${ipBucket(ip)}`, 30, HOUR);
  if (!limit.allowed) return json({ error: "rate_limited" }, 429, { "Retry-After": String(limit.retryAfter) });
  return null;
}

export async function POST(request: Request) {
  const refused = await guard(request, "subscribe");
  if (refused) return refused;
  const sub = parsePushSubscription(await readSmallJson(request));
  if (!sub) return json({ error: "invalid" }, 400);
  const created = await saveSubscription(sub);
  return json({ ok: true, created }, created ? 201 : 200);
}

export async function DELETE(request: Request) {
  const refused = await guard(request, "unsubscribe");
  if (refused) return refused;
  const endpoint = parseEndpoint(await readSmallJson(request));
  if (!endpoint) return json({ error: "invalid" }, 400);
  await deleteSubscription(endpoint);
  return json({ ok: true }, 200);
}
