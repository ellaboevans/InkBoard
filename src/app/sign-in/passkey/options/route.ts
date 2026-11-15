import { getRequestMeta } from "@/server/auth/dal";
import { startPasskeySignIn } from "@/server/auth/passkeys";
import { relyingParty } from "@/server/auth/webauthn-config";
import { setCeremonyToken } from "@/server/auth/webauthn-cookie";

/**
 * POST /sign-in/passkey/options: options for a usernameless passkey sign-in
 * (the button, or autofill on the email field), with the challenge tied to
 * this browser by a short-lived cookie (webauthn-cookie.ts).
 *
 * A route handler rather than a Server Action on purpose: the sign-in page
 * asks for these on load, and a Server Action in flight made Next's router
 * put back the URL it started from, undoing a flash param just stripped
 * (passkey-sign-in.tsx). It only makes a challenge for the asking browser,
 * rate-limited per IP bucket; signing in still needs the passkey.
 */
export async function POST(request: Request) {
  // Like a Server Action's own check: only our pages may ask (no cross-site
  // posts overwriting a browser's ceremony cookie).
  const rp = relyingParty();
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== rp.origin) return new Response("Forbidden", { status: 403 });
  const { ip } = await getRequestMeta();
  const res = await startPasskeySignIn({ rp, ip });
  if (!res.ok) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(res.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  await setCeremonyToken("authentication", res.token);
  return Response.json(res.options, { headers: { "Cache-Control": "no-store" } });
}
