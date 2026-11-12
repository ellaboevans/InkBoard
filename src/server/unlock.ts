import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { hmac, safeEqual } from "./crypto";
import { verifyPassword } from "./passwords";
import { ipBucket } from "./auth/ip";
import { rateLimit } from "./rate-limit";

/*
 * Reader unlocks for private poems (R3, R8, N1, N3, N6). Framework-free; the
 * cookie plumbing lives in src/app/p/[author]/[poem]/actions.ts.
 *
 * A successful unlock grants a *scope*, which depends on the author's mode:
 *   per_poem: "p:<poemId>:<poem.password_version>"   -> that poem only
 *   shared:   "a:<editorId>:<shared_password_version>" -> all their private poems
 * Grants are kept in one HMAC-signed cookie. Because the version is part of
 * the scope, changing a password or switching modes bumps it and every
 * existing grant silently stops matching.
 */

export const UNLOCK_TTL_SECONDS = 12 * 60 * 60;
const MAX_GRANTS = 40;

// Wrong-guess limits per client IP. In shared mode the per-target bucket is
// the author, so guesses spread across their poems still count together.
const GUESSES_PER_TARGET = 10; // per 15 minutes
const GUESSES_PER_IP = 60; // per hour, across all poems
const GUESSES_PER_TARGET_ALL_IPS = 300; // per hour, all clients combined

export type Grant = { s: string; e: number };

type Lock = {
  poemId: string;
  editorId: string;
  mode: "per_poem" | "shared";
  /** Current scope a grant must match. */
  scope: string;
  /** Rate-limit bucket. */
  target: string;
  hash: string | null;
};

/** Private, published poem's lock details; null if not found or public. */
async function loadLock(authorSlug: string, poemSlug: string): Promise<Lock | null> {
  const [row] = await getDb()
    .select({
      poemId: poems.id,
      editorId: editors.id,
      mode: editors.passwordMode,
      poemHash: poems.passwordHash,
      poemVersion: poems.passwordVersion,
      sharedHash: editors.sharedPasswordHash,
      sharedVersion: editors.sharedPasswordVersion,
    })
    .from(poems)
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .where(
      and(
        eq(editors.slug, authorSlug),
        eq(poems.slug, poemSlug),
        eq(poems.status, "published"),
        eq(poems.visibility, "private"),
        isNotNull(editors.penName),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row.mode === "shared"
    ? {
        poemId: row.poemId,
        editorId: row.editorId,
        mode: "shared",
        scope: `a:${row.editorId}:${row.sharedVersion}`,
        target: `a:${row.editorId}`,
        hash: row.sharedHash,
      }
    : {
        poemId: row.poemId,
        editorId: row.editorId,
        mode: "per_poem",
        scope: `p:${row.poemId}:${row.poemVersion}`,
        target: `p:${row.poemId}`,
        hash: row.poemHash,
      };
}

export type UnlockResult =
  | { ok: true; grants: Grant[] }
  | { ok: false; error: "wrong_password" | "not_found" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

export async function attemptUnlock(input: {
  authorSlug: string;
  poemSlug: string;
  password: unknown;
  ip: string | null;
  grants: Grant[];
}): Promise<UnlockResult> {
  const lock = await loadLock(input.authorSlug, input.poemSlug);
  if (!lock) return { ok: false, error: "not_found" };

  const ip = ipBucket(input.ip);
  const limits = await Promise.all([
    rateLimit(`unlock:${lock.target}:ip:${ip}`, GUESSES_PER_TARGET, 15 * 60),
    rateLimit(`unlock:ip:${ip}`, GUESSES_PER_IP, 60 * 60),
    // Across *all* clients: rotating IPs (a botnet, many IPv6 /64s) can't
    // brute-force one poem's (or one author's) password indefinitely. Under
    // such an attack real readers wait too; that's the intended trade-off.
    rateLimit(`unlock:${lock.target}:all`, GUESSES_PER_TARGET_ALL_IPS, 60 * 60),
  ]);
  const blocked = limits.find((l) => !l.allowed);
  if (blocked) return { ok: false, error: "rate_limited", retryAfter: blocked.retryAfter };

  const password = typeof input.password === "string" ? input.password : "";
  if (!(await verifyPassword(password, lock.hash))) {
    return { ok: false, error: "wrong_password" };
  }

  const now = Date.now();
  const grants = [
    { s: lock.scope, e: now + UNLOCK_TTL_SECONDS * 1000 },
    ...input.grants.filter((g) => g.s !== lock.scope && g.e > now),
  ].slice(0, MAX_GRANTS);
  return { ok: true, grants };
}

/**
 * Body of a private poem, only if `grants` holds a live grant for its
 * current scope. Uncached on purpose: it's per-reader and must notice
 * password changes immediately.
 */
export async function readUnlockedBody(
  authorSlug: string,
  poemSlug: string,
  grants: Grant[],
): Promise<string | null> {
  const lock = await loadLock(authorSlug, poemSlug);
  if (!lock) return null;
  const now = Date.now();
  if (!grants.some((g) => g.s === lock.scope && g.e > now)) return null;
  const [row] = await getDb()
    .select({ body: poems.body })
    .from(poems)
    .where(eq(poems.id, lock.poemId))
    .limit(1);
  return row?.body ?? null;
}

// ---- cookie encoding ---------------------------------------------------------

const sign = (payload: string) => hmac("unlock-cookie", payload);

export function encodeGrants(grants: Grant[]): string {
  const payload = Buffer.from(JSON.stringify(grants)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Tampered, malformed or empty cookies decode to no grants. */
export function decodeGrants(value: string | undefined): Grant[] {
  if (!value || value.length > 8192) return [];
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return [];
  const payload = value.slice(0, dot);
  if (!safeEqual(value.slice(dot + 1), sign(payload))) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is Grant => typeof g?.s === "string" && typeof g?.e === "number",
    );
  } catch {
    return [];
  }
}
