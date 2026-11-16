import { guard, json, readSmallJson } from "@/server/push-http";
import { parseOwnerProof, parsePrefsOp } from "@/lib/push-rules";
import { changePrefs } from "@/server/push";

/**
 * A device's notification preferences (docs/PLAN.md, Phase 18 round 2):
 *   POST { endpoint, auth, op: "get" | "mode" | "follow" | "unfollow", mode?, author? }
 * → { mode, follows: [{ slug, penName }] }
 *
 * Only the browser that owns the subscription can read or change them: it
 * sends the endpoint *and* the auth secret, which it never shares. A POST
 * even for reads, so the secret is never in a URL. Same checks as
 * subscribing (allowlist, sizes, same origin, IP-bucket rate limit); an
 * unknown endpoint and a wrong secret get the same 404.
 */
export async function POST(request: Request) {
  const refused = await guard(request, "prefs");
  if (refused) return refused;
  const body = await readSmallJson(request);
  const proof = parseOwnerProof(body);
  const op = parsePrefsOp(body);
  if (!proof || !op) return json({ error: "invalid" }, 400);
  const prefs = await changePrefs(proof, op);
  if (!prefs) return json({ error: "not_found" }, 404);
  return json(prefs, 200);
}
