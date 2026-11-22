import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { chapterReleased } from "./chapter-release";
import { authorShown, novelShown, poemShown } from "./shown";
import { chapters, editors, novels, poems, shortLinks } from "@/db/schema";
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
 *
 * CHAPTERS (Phase 25, "Share a passage"): the same rules, one code per
 * chapter (short_links.chapter_id, unique), made only by the first passage
 * picture of a published chapter of a public novel (ensureChapterShortCode);
 * /s/<code> goes to the chapter page while that's still true, and visits are
 * counted the same way (once per network per chapter per day). A row points
 * at exactly one poem or one chapter (a check constraint).
 */

const ATTEMPTS = 8;

/** The poem's code, made now if it has none; null if the poem isn't a published public poem (any more). */
export async function ensureShortCode(poemId: string): Promise<string | null> {
  const db = getDb();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      await db.execute(sql`
        INSERT INTO short_links (poem_id, code)
        SELECT ${poems.id}, ${newShortCode()} FROM ${poems} JOIN editors e ON e.id = ${poems.editorId}
        WHERE ${poems.id} = ${poemId} AND ${poemShown()} AND ${poems.visibility} = 'public' AND ${authorShown("e")}
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

/** A chapter's code, made now if it has none; null unless it's a published chapter of a public novel (Phase 25). */
export async function ensureChapterShortCode(chapterId: string): Promise<string | null> {
  const db = getDb();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      await db.execute(sql`
        INSERT INTO short_links (chapter_id, code)
        SELECT c.id, ${newShortCode()} FROM chapters c JOIN novels n ON n.id = c.novel_id JOIN editors e ON e.id = n.editor_id
        WHERE c.id = ${chapterId} AND ${chapterReleased("c")} AND n.visibility = 'public' AND ${novelShown("n")} AND ${authorShown("e")}
        ON CONFLICT (chapter_id) DO NOTHING
      `);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
    const [row] = await db.select({ code: shortLinks.code }).from(shortLinks).where(eq(shortLinks.chapterId, chapterId)).limit(1);
    return row?.code ?? null;
  }
  throw new Error("couldn't draw a free short code");
}

/** Where a short link goes: a poem (Phase 21) or a chapter (Phase 25). */
export type ShortLinkTarget =
  | { poemId: string; authorSlug: string; poemSlug: string }
  | { chapterId: string; authorSlug: string; novelSlug: string; chapterSlug: string };

/**
 * Where /s/<code> goes: a published public poem by an author with a pen name,
 * a published chapter of a public novel by one, or null for anything else
 * (malformed, unknown, private, draft, unpublished, deleted, hidden: one answer, one
 * query whatever the case, so a private poem's or novel's code can't be told
 * from one that never existed). Capitals are accepted.
 */
export async function resolveShortCode(raw: string): Promise<ShortLinkTarget | null> {
  const code = parseShortCode(raw);
  if (!code) return null;
  const poemAuthor = alias(editors, "poem_author");
  const novelAuthor = alias(editors, "novel_author");
  const [row] = await getDb()
    .select({
      poemId: poems.id,
      poemAuthor: poemAuthor.slug,
      poemSlug: poems.slug,
      chapterId: chapters.id,
      chapterSlug: chapters.slug,
      novelSlug: novels.slug,
      novelAuthor: novelAuthor.slug,
    })
    .from(shortLinks)
    .leftJoin(poems, and(eq(poems.id, shortLinks.poemId), poemShown(), eq(poems.visibility, "public")))
    .leftJoin(poemAuthor, and(eq(poemAuthor.id, poems.editorId), authorShown(poemAuthor)))
    .leftJoin(chapters, and(eq(chapters.id, shortLinks.chapterId), chapterReleased()))
    .leftJoin(novels, and(eq(novels.id, chapters.novelId), eq(novels.visibility, "public"), novelShown()))
    .leftJoin(novelAuthor, and(eq(novelAuthor.id, novels.editorId), authorShown(novelAuthor)))
    .where(eq(shortLinks.code, code))
    .limit(1);
  if (!row) return null;
  if (row.poemId && row.poemAuthor && row.poemSlug) return { poemId: row.poemId, authorSlug: row.poemAuthor, poemSlug: row.poemSlug };
  if (row.chapterId && row.novelAuthor && row.novelSlug && row.chapterSlug) {
    return { chapterId: row.chapterId, authorSlug: row.novelAuthor, novelSlug: row.novelSlug, chapterSlug: row.chapterSlug };
  }
  return null;
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

/** The same for a chapter's short link (Phase 25): its own counter, named after the chapter. */
export async function countChapterShareVisit(chapterId: string, bucket: string): Promise<boolean> {
  const first = await rateLimit(shareVisitKey(chapterId, bucket), 1, SHARE_VISIT_WINDOW_SECONDS);
  if (!first.allowed) return false;
  await getDb()
    .update(shortLinks)
    .set({ visits: sql`${shortLinks.visits} + 1` })
    .where(eq(shortLinks.chapterId, chapterId));
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
  return new Map(rows.flatMap((r) => (r.poemId ? [[r.poemId, r.visits] as const] : [])));
}
