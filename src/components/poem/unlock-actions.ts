"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getRequestMeta } from "@/server/auth/dal";
import {
  attemptUnlock,
  decodeGrants,
  encodeGrants,
  UNLOCK_TTL_SECONDS,
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

  if (!res.ok) {
    if (res.error === "rate_limited") {
      const minutes = Math.max(1, Math.ceil(res.retryAfter / 60));
      return { error: `Too many attempts. Try again in ${pluralCount(minutes, "minute")}.` };
    }
    if (res.error === "not_found") return { error: "This poem is no longer available." };
    return { error: "That password isn't right." };
  }

  jar.set(UNLOCK_COOKIE, encodeGrants(res.grants), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: UNLOCK_TTL_SECONDS,
  });
  refresh(); // re-render the page, now with the poem
  return {};
}
