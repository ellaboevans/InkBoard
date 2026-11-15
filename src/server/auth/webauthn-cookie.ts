import "server-only";
import { cookies } from "next/headers";
import { PASSKEY_CHALLENGE_TTL_SECONDS } from "./passkeys";

/*
 * Binds a WebAuthn challenge to the browser that asked for it: the start
 * action puts a random token in a short-lived httpOnly cookie, and the finish
 * action can only take the challenge stored under that token (as a SHA-256,
 * passkeys.ts). One cookie per ceremony kind, so the sign-in autofill and a
 * profile registration don't clobber each other. Server Actions only.
 * Same `__Host-` rule as the session cookie (cookie.ts).
 */

type Ceremony = "registration" | "authentication" | "step-up";

const prefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
const NAMES: Record<Ceremony, string> = {
  registration: `${prefix}poemhub_webauthn_reg`,
  authentication: `${prefix}poemhub_webauthn_signin`,
  "step-up": `${prefix}poemhub_webauthn_stepup`,
};

const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
} as const;

export async function setCeremonyToken(ceremony: Ceremony, token: string): Promise<void> {
  (await cookies()).set(NAMES[ceremony], token, { ...options, maxAge: PASSKEY_CHALLENGE_TTL_SECONDS });
}

/** Read and clear the token (each one is good for one finish attempt). */
export async function takeCeremonyToken(ceremony: Ceremony): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(NAMES[ceremony])?.value ?? null;
  if (token) jar.set(NAMES[ceremony], "", { ...options, maxAge: 0 });
  return token;
}
