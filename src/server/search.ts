import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { chapterReleased } from "./chapter-release";
import { authorShown, novelShown, poemShown } from "./shown";
import { toNfc } from "@/lib/letters";
import type { SearchResults } from "@/lib/search-types";

/*
 * Board search (R10): author pen names (section labels), poem titles and
 * (Phase 24) novel titles. Poem bodies are never searched or returned (N1),
 * not even for public poems, so a private poem can't be found by its text;
 * nor are chapter text, chapter titles ("Chapter 3" would match everything)
 * or blurbs. A novel is found only once it has a published chapter, like
 * its page (drizzle/0025_novel_search.sql for its indexes).
 *
 * Matching (see drizzle/0003_search.sql for the indexes):
 *   - every word as a prefix, all words required ("ros gar" -> "Rose Garden")
 *   - or close enough by trigram word similarity, for typos ("dickenson")
 *   - accent- and case-insensitive ("jose" -> "José")
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
const LIMIT = 8;
const MAX_WORDS = 6;
const TYPO_THRESHOLD = "0.5";
/** Typo matching on very short queries is mostly noise. */
const FUZZY_MIN_LENGTH = 4;

/**
 * Split into plain words; nothing else reaches to_tsquery. Combining marks
 * (\p{M}) belong to their word: Ewe tones on ɛ/ɔ have no precomposed form,
 * so without them "ɔ̃" would split in two. NFC first, like stored text.
 */
export function searchWords(raw: string): string[] {
  return (toNfc(raw.slice(0, SEARCH_MAX_LENGTH)).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []).slice(0, MAX_WORDS);
}

/**
 * Prefix/word matches first; only if a group (authors or poems) has none,
 * fall back to typo-tolerant matching for that group. Fuzzy-always would
 * flood short queries with noise ("ros" ~ "versos").
 */
export async function searchBoard(raw: unknown): Promise<SearchResults> {
  const q = typeof raw === "string" ? raw.trim().slice(0, SEARCH_MAX_LENGTH) : "";
  const words = searchWords(q);
  if (q.length < SEARCH_MIN_LENGTH || words.length === 0) return { authors: [], novels: [], poems: [] };

  // e.g. "ros:* & gar:*". Words are \p{L}\p{N} only, so this can't inject
  // tsquery operators; search_normalize() lower-cases and strips accents.
  const prefixQuery = words.map((w) => `${w}:*`).join(" & ");
  const text = words.join(" ");
  const fuzzyAllowed = text.length >= FUZZY_MIN_LENGTH;

  return getDb().transaction(async (tx) => {
    // Scoped to this transaction; lets the `<%` operator use the GIN index.
    await tx.execute(sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${TYPO_THRESHOLD}, true)`);
    const q = sql`(SELECT to_tsquery('simple', search_normalize(${prefixQuery})) AS tsq,
                          search_normalize(${text}) AS norm)`;
    const authorName = sql`search_normalize(coalesce(e.pen_name, ''))`;
    const poemTitle = sql`search_normalize(p.title)`;
    const novelTitle = sql`search_normalize(n.title)`;
    // Fuzzy still requires *every* word, each either as a prefix or close
    // by trigram, so "rose feathers" doesn't match on "feathers" alone.
    const everyWordRoughly = (field: SQL) =>
      sql.join(
        words.map(
          (w) => sql`(to_tsvector('simple', ${field}) @@ to_tsquery('simple', search_normalize(${`${w}:*`}))
                      OR search_normalize(${w}) <% ${field})`,
        ),
        sql` AND `,
      );

    const findAuthors = async (fuzzy: boolean) =>
      ((await tx.execute(sql`
        SELECT e.id AS "editorId", e.pen_name AS "penName", e.slug,
               (SELECT count(*)::int FROM poems p
                WHERE p.editor_id = e.id AND ${poemShown("p")}) AS "poemCount"
        FROM editors e, ${q} q
        WHERE ${authorShown("e")} AND e.slug IS NOT NULL
          -- On the board: a shown poem or a shown novel's released chapter.
          AND (EXISTS (SELECT 1 FROM poems p WHERE p.editor_id = e.id AND ${poemShown("p")})
               OR EXISTS (SELECT 1 FROM novels n JOIN chapters c ON c.novel_id = n.id
                          WHERE n.editor_id = e.id AND ${novelShown("n")} AND ${chapterReleased("c")}))
          AND ${fuzzy ? everyWordRoughly(authorName) : sql`to_tsvector('simple', ${authorName}) @@ q.tsq`}
        ORDER BY ${fuzzy ? sql`word_similarity(q.norm, ${authorName})` : sql`ts_rank(to_tsvector('simple', ${authorName}), q.tsq)`} DESC,
                 lower(e.pen_name)
        LIMIT ${LIMIT}
      `)) as unknown as { rows: SearchResults["authors"] }).rows;

    const findPoems = async (fuzzy: boolean) =>
      ((await tx.execute(sql`
        SELECT p.id, p.title, p.slug, p.visibility,
               e.id AS "editorId", e.pen_name AS "penName", e.slug AS "authorSlug"
        FROM poems p JOIN editors e ON e.id = p.editor_id, ${q} q
        WHERE ${poemShown("p")} AND ${authorShown("e")} AND e.slug IS NOT NULL
          AND ${fuzzy ? everyWordRoughly(poemTitle) : sql`to_tsvector('simple', ${poemTitle}) @@ q.tsq`}
        ORDER BY ${fuzzy ? sql`word_similarity(q.norm, ${poemTitle})` : sql`ts_rank(to_tsvector('simple', ${poemTitle}), q.tsq)`} DESC,
                 p.published_at DESC
        LIMIT ${LIMIT}
      `)) as unknown as { rows: SearchResults["poems"] }).rows;

    // Titles only (never chapter text or blurbs), and only novels readers can open.
    const findNovels = async (fuzzy: boolean) =>
      ((await tx.execute(sql`
        SELECT n.id, n.title, n.slug,
               e.id AS "editorId", e.pen_name AS "penName", e.slug AS "authorSlug"
        FROM novels n JOIN editors e ON e.id = n.editor_id, ${q} q
        WHERE ${authorShown("e")} AND e.slug IS NOT NULL AND ${novelShown("n")}
          AND EXISTS (SELECT 1 FROM chapters c WHERE c.novel_id = n.id AND ${chapterReleased("c")})
          AND ${fuzzy ? everyWordRoughly(novelTitle) : sql`to_tsvector('simple', ${novelTitle}) @@ q.tsq`}
        ORDER BY ${fuzzy ? sql`word_similarity(q.norm, ${novelTitle})` : sql`ts_rank(to_tsvector('simple', ${novelTitle}), q.tsq)`} DESC,
                 n.updated_at DESC
        LIMIT ${LIMIT}
      `)) as unknown as { rows: SearchResults["novels"] }).rows;

    let authors = await findAuthors(false);
    if (authors.length === 0 && fuzzyAllowed) authors = await findAuthors(true);
    let poems = await findPoems(false);
    if (poems.length === 0 && fuzzyAllowed) poems = await findPoems(true);
    let novels = await findNovels(false);
    if (novels.length === 0 && fuzzyAllowed) novels = await findNovels(true);
    return { authors, novels, poems };
  });
}
