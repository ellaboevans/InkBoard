import "server-only";
import { EXCERPT_CHARS, EXCERPT_LINES } from "@/lib/poem-text";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import type { AuthorPage, BoardSection, ReaderPoem } from "@/lib/board-types";

/*
 * Public, reader-facing queries (R1, R8, R9). Uncached and framework-free so
 * they can be tested directly; the cached wrappers live in board-cache.ts.
 *
 * N1: a private poem's body never leaves the database here. Excerpts and
 * bodies are computed with `CASE WHEN visibility = 'public'` in SQL, so the
 * text is not even loaded into the server process for private poems.
 */

// The same rule the editor's live preview uses (cardExcerpt): keep them in sync.
export { EXCERPT_CHARS, EXCERPT_LINES };

const lines = sql`string_to_array(${poems.body}, E'\\n')`;
const isPublic = sql`${poems.visibility} = 'public'`;

export async function loadBoardSections(): Promise<BoardSection[]> {
  const rows = await getDb()
    .select({
      editorId: editors.id,
      penName: editors.penName,
      authorSlug: editors.slug,
      id: poems.id,
      title: poems.title,
      slug: poems.slug,
      visibility: poems.visibility,
      language: poems.language,
      excerpt: sql<string | null>`CASE WHEN ${isPublic} THEN
        left(array_to_string((${lines})[1:${sql.raw(String(EXCERPT_LINES))}], E'\\n'), ${EXCERPT_CHARS})
      END`,
      hasMore: sql<boolean>`CASE WHEN ${isPublic} THEN
        cardinality(${lines}) > ${EXCERPT_LINES} OR length(${poems.body}) > ${EXCERPT_CHARS}
      ELSE false END`,
    })
    .from(poems)
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .where(
      and(
        eq(poems.status, "published"),
        isNotNull(editors.penName),
        isNotNull(editors.slug),
      ),
    )
    // Catalogue order: authors A–Z, newest poems first within a section.
    .orderBy(
      asc(sql`lower(${editors.penName})`),
      asc(editors.id),
      desc(poems.publishedAt),
      asc(poems.title),
    );

  const sections: BoardSection[] = [];
  for (const row of rows) {
    let section = sections.at(-1);
    if (!section || section.editorId !== row.editorId) {
      section = {
        editorId: row.editorId,
        penName: row.penName!,
        slug: row.authorSlug!,
        poems: [],
      };
      sections.push(section);
    }
    section.poems.push({
      id: row.id,
      title: row.title,
      slug: row.slug,
      visibility: row.visibility,
      language: row.language,
      excerpt: row.excerpt,
      hasMore: row.hasMore,
    });
  }
  return sections;
}

/** A published poem by author + poem slug, or null. */
export async function loadReaderPoem(
  authorSlug: string,
  poemSlug: string,
): Promise<ReaderPoem | null> {
  const [row] = await getDb()
    .select({
      title: poems.title,
      slug: poems.slug,
      penName: editors.penName,
      authorSlug: editors.slug,
      visibility: poems.visibility,
      language: poems.language,
      body: sql<string | null>`CASE WHEN ${isPublic} THEN ${poems.body} END`,
      sharedPassword: sql<boolean>`${editors.passwordMode} = 'shared'`,
      publishedAt: poems.publishedAt,
    })
    .from(poems)
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .where(
      and(
        eq(editors.slug, authorSlug),
        eq(poems.slug, poemSlug),
        eq(poems.status, "published"),
        isNotNull(editors.penName),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    penName: row.penName!,
    authorSlug: row.authorSlug!,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

/**
 * An author's public page: profile fields plus their published poems, with
 * the pinned poem first. Private poems come back as title-only cards: like
 * the board, bodies are cut in SQL with CASE WHEN visibility = 'public' (N1).
 */
export async function loadAuthorPage(authorSlug: string): Promise<AuthorPage | null> {
  const db = getDb();
  const [author] = await db
    .select({
      editorId: editors.id,
      penName: editors.penName,
      slug: editors.slug,
      avatar: editors.avatar,
      tagline: editors.tagline,
      bio: editors.bio,
      links: editors.links,
      pinnedPoemId: editors.pinnedPoemId,
    })
    .from(editors)
    .where(and(eq(editors.slug, authorSlug), isNotNull(editors.penName)))
    .limit(1);
  if (!author) return null;

  const rows = await db
    .select({
      id: poems.id,
      title: poems.title,
      slug: poems.slug,
      visibility: poems.visibility,
      language: poems.language,
      excerpt: sql<string | null>`CASE WHEN ${isPublic} THEN
        left(array_to_string((${lines})[1:${sql.raw(String(EXCERPT_LINES))}], E'\\n'), ${EXCERPT_CHARS})
      END`,
      hasMore: sql<boolean>`CASE WHEN ${isPublic} THEN
        cardinality(${lines}) > ${EXCERPT_LINES} OR length(${poems.body}) > ${EXCERPT_CHARS}
      ELSE false END`,
      publishedAt: poems.publishedAt,
    })
    .from(poems)
    .where(and(eq(poems.editorId, author.editorId), eq(poems.status, "published")))
    .orderBy(desc(poems.publishedAt), asc(poems.title));

  const list = rows.map((r) => ({
    ...r,
    pinned: r.id === author.pinnedPoemId,
    publishedAt: r.publishedAt?.toISOString() ?? null,
  }));
  list.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return {
    penName: author.penName!,
    slug: author.slug!,
    editorId: author.editorId,
    avatar: author.avatar,
    tagline: author.tagline,
    bio: author.bio,
    links: Array.isArray(author.links) ? author.links : [],
    poems: list,
  };
}
