import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, poems, shortLinks } from "@/db/schema";
import { newShortCode, parseShortCode } from "@/lib/share-image/short-code";
import { SHARE_VISIT_WINDOW_SECONDS, shareVisitKey } from "@/lib/share-image/visits";
import { isUniqueViolation } from "@/lib/slug";
import { rateLimit } from "./rate-limit";

/*
 * Short links for shared images (docs/PLAN.md, Phase 21 round 3).
 * Framework-free: the proxy (/s/<code>) and the image route call these.
 *
 * WHEN A CODE IS MADE: the first time a picture of a public poem is drawn
 * (ensureShortCode, from the image route, before the picture: the drawing
 * itself happens inside "use cache", which can't write). Why then, and not on
 * save or publish: only poems someone actually shares get a code (no backfill
 * of every existing poem, no change to the poem save transaction and its
 * locks), and a code is never made for a private poem or a draft: the insert
 * itself only takes a published public poem. Race-free: one row per poem
 * (unique poem_id; concurrent first pictures insert ON CONFLICT DO NOTHING and
 * then all read the one that won); a random code that's taken, or retired
 * (drizzle/0022 refuses it with unique_violation), is redrawn.
 *
 * A code never changes and is never reused: deleting the poem (or the
 * account) moves it to retired_short_codes. Making a poem private keeps its
 * code; the redirect simply stops (resolveShortCode is public poems only).
 */

const ATTEMPTS = 8;

/** The poem's code, made now if it has none; null if the poem isn't a published public poem (any more). */
export async function ensureShortCode(poemId: string): Promise<string | null> {
  const db = getDb();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      await db.execute(sql`
        INSERT INTO short_links (poem_id, code)
        SELECT ${poems.id}, ${newShortCode()} FROM ${poems}
        WHERE ${poems.id} = ${poemId} AND ${poems.status} = 'published' AND ${poems.visibility} = 'public'
        ON CONFLICT (poem_id) DO NOTHING
      `);
    } catch (err) {
      if (isUniqueViolation(err)) continue; // that code is someone else's, or retired: draw again
      throw err;
    }
    const [row] = await db.select({ code: shortLinks.code }).from(shortLinks).where(eq(shortLinks.poemId, poemId)).limit(1);
    return row?.code ?? null;
  }
  throw new Error("couldn't draw a free short code");
}

export type ShortLinkTarget = { poemId: string; authorSlug: string; poemSlug: string };

/**
 * Where /s/<code> goes: a published public poem by an author with a pen name,
 * or null for anything else (malformed, unknown, private, draft, unpublished,
 * deleted: one answer, one query whatever the case, so a private poem's code
 * can't be told from one that never existed). Capitals are accepted.
 */
export async function resolveShortCode(raw: string): Promise<ShortLinkTarget | null> {
  const code = parseShortCode(raw);
  if (!code) return null;
  const [row] = await getDb()
    .select({ poemId: poems.id, authorSlug: editors.slug, poemSlug: poems.slug })
    .from(shortLinks)
    .innerJoin(poems, eq(poems.id, shortLinks.poemId))
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .where(
      and(
        eq(shortLinks.code, code),
        eq(poems.status, "published"),
        eq(poems.visibility, "public"),
        isNotNull(editors.penName),
      ),
    )
    .limit(1);
  return row && row.authorSlug ? { poemId: row.poemId, authorSlug: row.authorSlug, poemSlug: row.poemSlug } : null;
}

/**
 * Counts one visit through a poem's short link, unless this network already
 * did in the last day (a rate_limits counter named after the poem and the
 * IP bucket: nothing else about the visitor is kept). Returns whether it counted.
 */
export async function countShareVisit(poemId: string, bucket: string): Promise<boolean> {
  const first = await rateLimit(shareVisitKey(poemId, bucket), 1, SHARE_VISIT_WINDOW_SECONDS);
  if (!first.allowed) return false;
  await getDb()
    .update(shortLinks)
    .set({ visits: sql`${shortLinks.visits} + 1` })
    .where(eq(shortLinks.poemId, poemId));
  return true;
}

/**
 * Visits through each of this editor's short links, for their dashboard only
 * (scoped by the DAL editor id: another editor's poems never appear). Poems
 * without a short link (never shared as a picture) aren't in the map.
 */
export async function shareVisitsForEditor(editorId: string): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ poemId: shortLinks.poemId, visits: shortLinks.visits })
    .from(shortLinks)
    .innerJoin(poems, eq(poems.id, shortLinks.poemId))
    .where(eq(poems.editorId, editorId));
  return new Map(rows.map((r) => [r.poemId, r.visits]));
}
