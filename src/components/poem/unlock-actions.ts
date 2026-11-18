"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getRequestMeta } from "@/server/auth/dal";
import {
  attemptNovelUnlock,
  attemptUnlock,
  decodeGrants,
  encodeGrants,
  UNLOCK_TTL_SECONDS,
  type UnlockResult,
} from "@/server/unlock";
import { UNLOCK_COOKIE } from "@/server/unlock-cookie";
import { pluralCount } from "@/lib/plural";

export type UnlockState = { error?: string };

export async function unlockPoemAction(
  authorSlug: string,
  poemSlug: string,
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const jar = await cookies();
  const { ip } = await getRequestMeta();
  const res = await attemptUnlock({
    authorSlug,
    poemSlug,
    password: formData.get("password"),
    ip,
    grants: decodeGrants(jar.get(UNLOCK_COOKIE)?.value),
  });
  return finish(res, "This poem is no longer available.");
}

/** A private novel (Phase 25): one password opens every chapter. */
export async function unlockNovelAction(
  authorSlug: string,
  novelSlug: string,
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const jar = await cookies();
  const { ip } = await getRequestMeta();
  const res = await attemptNovelUnlock({
    authorSlug,
    novelSlug,
    password: formData.get("password"),
    ip,
    grants: decodeGrants(jar.get(UNLOCK_COOKIE)?.value),
  });
  return finish(res, "This novel is no longer available.");
}

async function finish(res: UnlockResult, gone: string): Promise<UnlockState> {
  if (!res.ok) {
    if (res.error === "rate_limited") {
      const minutes = Math.max(1, Math.ceil(res.retryAfter / 60));
      return { error: `Too many attempts. Try again in ${pluralCount(minutes, "minute")}.` };
    }
    if (res.error === "not_found") return { error: gone };
    return { error: "That password isn't right." };
  }

  (await cookies()).set(UNLOCK_COOKIE, encodeGrants(res.grants), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: UNLOCK_TTL_SECONDS,
  });
  refresh(); // re-render the page, now with the text
  return {};
}
