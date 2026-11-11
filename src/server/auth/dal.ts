import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/env";
import { SESSION_COOKIE } from "./cookie";
import { clientIpFromForwardedFor } from "./ip";
import {
  createSession,
  revokeSessionToken,
  validateSessionToken,
  type SessionEditor,
} from "./sessions";

/**
 * Data Access Layer: the single place that turns a request into an editor.
 * Every Server Component, Server Action and Route Handler that needs auth
 * must go through here. `proxy.ts` only does an optimistic cookie check.
 */
export const getCurrentEditor = cache(
  async (): Promise<SessionEditor | null> => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return validateSessionToken(token);
  },
);

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

/** Server Actions / Route Handlers only (cookies are read-only in RSC). */
export async function startSession(editorId: string): Promise<void> {
  const meta = await getRequestMeta();
  const { token, expiresAt } = await createSession(editorId, meta);
  (await cookies()).set(SESSION_COOKIE, token, {
    ...cookieOptions,
    expires: expiresAt,
  });
}

/** Server Actions / Route Handlers only. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  // Not jar.delete(): browsers ignore a `__Host-` clear without `Secure`.
  jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
