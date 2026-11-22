import "server-only";
import { and, eq, exists, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chapterReleased } from "./chapter-release";
import { authorShown, novelShown, poemShown } from "./shown";
import { chapters, editors, novels, poems } from "@/db/schema";
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
 *             "n:<novelId>:<novel.password_version>" -> every chapter of that novel
 *   shared:   "a:<editorId>:<shared_password_version>" -> all their private
 *             poems and novels
 * Grants are kept in one HMAC-signed cookie. Because the version is part of
 * the scope, changing a password or switching modes bumps it and every
 * existing grant silently stops matching.
 *
 * Private novels (Phase 25): one password for the whole book. Readers see a
 * private novel's title, blurb and chapter list from the cached loaders;
 * chapter text comes only from readUnlockedChapterBody, after the grant check.
 * Rate-limit keys are shaped like the poems': unlock:n:<id>:ip:<bucket>,
 * unlock:ip:<bucket> (shared with poems) and unlock:n:<id>:all; in shared
 * mode the author's a:<editorId> bucket, so guesses across their poems and
 * novels count together.
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
  /** The poem's or the novel's id. */
  id: string;
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
        poemShown(),
        eq(poems.visibility, "private"),
        authorShown(),
      ),
    )
    .limit(1);
  if (!row) return null;
  return toLock("p", { id: row.poemId, ...row, hash: row.poemHash, version: row.poemVersion });
}

function toLock(
  kind: "p" | "n",
  row: {
    id: string;
    editorId: string;
    mode: "per_poem" | "shared";
    hash: string | null;
    version: number;
    sharedHash: string | null;
    sharedVersion: number;
  },
): Lock {
  return row.mode === "shared"
    ? {
        id: row.id,
        editorId: row.editorId,
        mode: "shared",
        scope: `a:${row.editorId}:${row.sharedVersion}`,
        target: `a:${row.editorId}`,
        hash: row.sharedHash,
      }
    : {
        id: row.id,
        editorId: row.editorId,
        mode: "per_poem",
        scope: `${kind}:${row.id}:${row.version}`,
        target: `${kind}:${row.id}`,
        hash: row.hash,
      };
}

/**
 * A private novel readers can see (onboarded author, at least one published
 * chapter): its lock details; null if not found, not visible or public.
 */
async function loadNovelLock(authorSlug: string, novelSlug: string): Promise<Lock | null> {
  const [row] = await getDb()
    .select({
      id: novels.id,
      editorId: editors.id,
      mode: editors.passwordMode,
      hash: novels.passwordHash,
      version: novels.passwordVersion,
      sharedHash: editors.sharedPasswordHash,
      sharedVersion: editors.sharedPasswordVersion,
    })
    .from(novels)
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .where(
      and(
        eq(editors.slug, authorSlug),
        eq(novels.slug, novelSlug),
        eq(novels.visibility, "private"),
        novelShown(),
        authorShown(),
        exists(
          getDb()
            .select({ one: sql`1` })
            .from(chapters)
            .where(and(eq(chapters.novelId, novels.id), chapterReleased())),
        ),
      ),
    )
    .limit(1);
  return row ? toLock("n", row) : null;
}

export type UnlockResult =
  | { ok: true; grants: Grant[] }
  | { ok: false; error: "wrong_password" | "not_found" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

type Attempt = { password: unknown; ip: string | null; grants: Grant[] };

export async function attemptUnlock(input: Attempt & { authorSlug: string; poemSlug: string }): Promise<UnlockResult> {
  return attempt(await loadLock(input.authorSlug, input.poemSlug), input);
}

/** Unlock a private novel: one password opens every published chapter. */
export async function attemptNovelUnlock(input: Attempt & { authorSlug: string; novelSlug: string }): Promise<UnlockResult> {
  return attempt(await loadNovelLock(input.authorSlug, input.novelSlug), input);
}

async function attempt(lock: Lock | null, input: Attempt): Promise<UnlockResult> {
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
    .where(eq(poems.id, lock.id))
    .limit(1);
  return row?.body ?? null;
}

/**
 * A published chapter's text of a private novel, only if `grants` holds a
 * live grant for the novel's current scope (n:<novelId>:<version>, or the
 * author's shared grant). Uncached like readUnlockedBody. Null for a public
 * novel too: its text comes from the cached loader.
 */
export async function readUnlockedChapterBody(
  authorSlug: string,
  novelSlug: string,
  chapterSlug: string,
  grants: Grant[],
): Promise<string | null> {
  const lock = await loadNovelLock(authorSlug, novelSlug);
  if (!lock) return null;
  const now = Date.now();
  if (!grants.some((g) => g.s === lock.scope && g.e > now)) return null;
  const [row] = await getDb()
    .select({ body: chapters.body })
    .from(chapters)
    .where(and(eq(chapters.novelId, lock.id), eq(chapters.slug, chapterSlug), chapterReleased()))
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
