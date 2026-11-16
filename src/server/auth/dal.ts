import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/env";
import { generateToken } from "@/server/crypto";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, SESSION_COOKIE } from "./cookie";
import { clientIpFromForwardedFor } from "./ip";
import {
  createSession,
  revokeSessionToken,
  validateSession,
  type SessionEditor,
  type SessionOptions,
} from "./sessions";

/**
 * Data Access Layer: the single place that turns a request into an editor.
 * Every Server Component, Server Action and Route Handler that needs auth
 * must go through here. `proxy.ts` only does an optimistic cookie check.
 */
const getCurrentSession = cache(
  async (): Promise<{ editor: SessionEditor; sessionId: string } | null> => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return validateSession(token);
  },
);

export async function getCurrentEditor(): Promise<SessionEditor | null> {
  return (await getCurrentSession())?.editor ?? null;
}

/**
 * The onboarded editor plus the id of the session making this request, for
 * the profile page's device list ("this device") and "sign out other devices".
 * The session id is not a secret (the cookie token is); it's safe to render.
 */
export async function requireOnboardedSession(): Promise<{
  editor: SessionEditor & { penName: string; slug: string };
  sessionId: string;
}> {
  const editor = await requireOnboardedEditor();
  const session = await getCurrentSession();
  // requireOnboardedEditor already redirected if there was no session.
  return { editor, sessionId: session!.sessionId };
}

/** Use in admin pages/actions. Redirects to sign-in when there's no session. */
export async function requireEditor(): Promise<SessionEditor> {
  const editor = await getCurrentEditor();
  if (!editor) redirect("/sign-in");
  return editor;
}

/** Like requireEditor, but also requires onboarding (pen name) to be done. */
export async function requireOnboardedEditor(): Promise<
  SessionEditor & { penName: string; slug: string }
> {
  const editor = await requireEditor();
  if (!editor.penName || !editor.slug) redirect("/admin/onboarding");
  return editor as SessionEditor & { penName: string; slug: string };
}

/** Client metadata for auditing and rate limiting. */
export async function getRequestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  return {
    ip: clientIpFromForwardedFor(h.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS),
    userAgent: h.get("user-agent"),
  };
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/**
 * Server Actions / Route Handlers only (cookies are read-only in RSC).
 * On a public device ("This isn't my device") the cookie gets no Expires or
 * Max-Age, so the browser drops it when it closes, and the server ends the
 * session after 12 hours anyway (browsers that restore sessions keep such
 * cookies, so the server-side expiry is what really counts).
 */
export async function startSession(editorId: string, options: SessionOptions = {}): Promise<void> {
  const meta = await getRequestMeta();
  const { token, expiresAt } = await createSession(editorId, meta, options);
  (await cookies()).set(
    SESSION_COOKIE,
    token,
    options.publicDevice ? cookieOptions : { ...cookieOptions, expires: expiresAt },
  );
}

/**
 * This browser's device id for new-device alerts (Server Actions only). Reads
 * the device cookie, or issues one if it's missing or malformed. `issued` is
 * true when the browser had no usable id, i.e. it's new to us.
 *
 * On a public device nothing is read or written: the browser isn't the
 * editor's, so it must not be remembered (or recognised from someone else's
 * cookie). A throwaway id makes it count as a new device for the alert.
 */
export async function deviceIdForSignIn(
  { publicDevice = false }: { publicDevice?: boolean } = {},
): Promise<{ id: string; issued: boolean }> {
  if (publicDevice) return { id: generateToken(), issued: true };
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) {
    // Refresh the expiry so a device in regular use is never forgotten.
    jar.set(DEVICE_COOKIE, existing, { ...cookieOptions, maxAge: DEVICE_COOKIE_MAX_AGE });
    return { id: existing, issued: false };
  }
  const id = generateToken();
  jar.set(DEVICE_COOKIE, id, { ...cookieOptions, maxAge: DEVICE_COOKIE_MAX_AGE });
  return { id, issued: true };
}

/** Server Actions / Route Handlers only. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  // Not jar.delete(): browsers ignore a `__Host-` clear without `Secure`.
  jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
