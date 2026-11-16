import "server-only";
import { MAX_SUBSCRIPTION_BODY_BYTES } from "@/lib/push-rules";
import { getRequestMeta } from "@/server/auth/dal";
import { ipBucket } from "@/server/auth/ip";
import { relyingParty } from "@/server/auth/webauthn-config";
import { pushConfig } from "@/server/push";
import { rateLimit } from "@/server/rate-limit";

/*
 * Shared checks for the notification routes (/api/push/*, docs/PLAN.md
 * Phase 18): configured, same origin, rate-limited per IP bucket, and a
 * small JSON body.
 */
const HOUR = 60 * 60;
export const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function readSmallJson(request: Request): Promise<unknown> {
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

export async function guard(request: Request, action: "subscribe" | "unsubscribe" | "prefs"): Promise<Response | null> {
  if (!pushConfig()) return json({ error: "not_configured" }, 404);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== relyingParty().origin) return json({ error: "forbidden" }, 403);
  const { ip } = await getRequestMeta();
  const limit = await rateLimit(`push:${action}:ip:${ipBucket(ip)}`, action === "prefs" ? 60 : 30, HOUR);
  if (!limit.allowed) return json({ error: "rate_limited" }, 429, { "Retry-After": String(limit.retryAfter) });
  return null;
}

