import { parseOwnerProof, parsePrefs, parsePushSubscription } from "@/lib/push-rules";
import { deleteSubscription, saveSubscription } from "@/server/push";
import { guard, json, readSmallJson } from "@/server/push-http";

/**
 * Notifications about new poems on this device (docs/PLAN.md, Phase 18).
 *   POST   { endpoint, keys: { p256dh, auth }, prefs? }  turn on, or re-register (idempotent)
 *   DELETE { endpoint, auth }                            turn off: the row is deleted
 *
 * Both answer with the device's preferences (Phase 18 round 2). Changing an
 * existing row needs its auth secret, which only the owning browser has:
 * knowing an endpoint is never enough. `prefs` (the mode and followed
 * authors the browser remembers) only apply to a new row, so a lost
 * subscription comes back with its follows.
 *
 * Route handlers, not Server Actions: they run from a tap on prerendered
 * reader pages and from the quiet re-check when the app opens. Same-origin
 * only, rate-limited per IP bucket, and strict: an allowlisted push service
 * endpoint, exact key sizes, a small body.
 */
export async function POST(request: Request) {
  const refused = await guard(request, "subscribe");
  if (refused) return refused;
  const body = await readSmallJson(request);
  const sub = parsePushSubscription(body);
  if (!sub) return json({ error: "invalid" }, 400);
  const raw = (body as Record<string, unknown>).prefs;
  const prefs = raw === undefined ? null : parsePrefs(raw);
  if (raw !== undefined && !prefs) return json({ error: "invalid" }, 400);
  const res = await saveSubscription(sub, prefs);
  // Someone else's endpoint (a different auth secret): the same answer as junk.
  if (!res.ok) return json({ error: "invalid" }, 400);
  return json({ ok: true, created: res.created, prefs: res.prefs }, res.created ? 201 : 200);
}

export async function DELETE(request: Request) {
  const refused = await guard(request, "unsubscribe");
  if (refused) return refused;
  const proof = parseOwnerProof(await readSmallJson(request));
  if (!proof) return json({ error: "invalid" }, 400);
  // Deleted or not (unknown endpoint, wrong secret): the same answer.
  await deleteSubscription(proof);
  return json({ ok: true }, 200);
}
