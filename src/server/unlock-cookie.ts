import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { decodeGrants, readUnlockedBody } from "./unlock";

export const UNLOCK_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-poemhub_unlock" : "poemhub_unlock";

/** Body of a private poem if this browser has unlocked it, else null. */
export async function getUnlockedBody(authorSlug: string, poemSlug: string) {
  // Grant expiry is checked against the clock, so this must only run at
  // request time (prerendering with prefetched cookies would otherwise hit
  // Date.now()).
  await connection();
  const grants = decodeGrants((await cookies()).get(UNLOCK_COOKIE)?.value);
  if (grants.length === 0) return null;
  return readUnlockedBody(authorSlug, poemSlug, grants);
}
