import "server-only";
import { EXCERPT_CHARS, EXCERPT_LINES } from "@/lib/poem-text";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { collections, editors, poems } from "@/db/schema";
import type {
  AuthorCollection,
  AuthorPage,
  BoardSection,
  CollectionBadge,
  CollectionPage,
  ReaderCollection,
  ReaderPoem,
} from "@/lib/board-types";
import type { ReaderPath } from "@/lib/reader-paths";

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

/** A card's text: the first lines of a public poem, never a private one's (N1). */
const cardColumns = {
  excerpt: sql<string | null>`CASE WHEN ${isPublic} THEN
    left(array_to_string((${lines})[1:${sql.raw(String(EXCERPT_LINES))}], E'\\n'), ${EXCERPT_CHARS})
  END`,
  hasMore: sql<boolean>`CASE WHEN ${isPublic} THEN
    cardinality(${lines}) > ${EXCERPT_LINES} OR length(${poems.body}) > ${EXCERPT_CHARS}
  ELSE false END`,
};

/**
 * The card's collection badge (Phase 14). Window functions over the query's
 * own rows: callers must select *published* poems only (they all do), so
 * "2/4" counts published poems and drafts never leave gaps. Needs
 * LEFT JOIN collections.
 */
const badgeColumns = {
  collectionTitle: collections.title,
  collectionSlug: collections.slug,
  collectionPart: sql<number | null>`CASE WHEN ${poems.collectionId} IS NOT NULL THEN
    (row_number() OVER (PARTITION BY ${poems.collectionId} ORDER BY ${poems.collectionPosition}))::int END`,
  collectionParts: sql<number | null>`CASE WHEN ${poems.collectionId} IS NOT NULL THEN
    (count(*) OVER (PARTITION BY ${poems.collectionId}))::int END`,
};

function badge(r: {
  collectionTitle: string | null;
  collectionSlug: string | null;
  collectionPart: number | null;
  collectionParts: number | null;
}): CollectionBadge | null {
  return r.collectionTitle && r.collectionSlug && r.collectionPart && r.collectionParts
    ? { title: r.collectionTitle, slug: r.collectionSlug, part: r.collectionPart, parts: r.collectionParts }
    : null;
}

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
      ...cardColumns,
      ...badgeColumns,
    })
    .from(poems)
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .leftJoin(collections, eq(collections.id, poems.collectionId))
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
      collection: badge(row),
    });
  }
  return sections;
}

/**
 * Does this reader page have anything to show? The proxy (src/proxy.ts) asks
 * before a full page load, so a missing page answers with a real 404 instead
 * of a streamed "not found" under a 200 (docs/PLAN.md, Phase 19). One small
 * indexed query, with exactly the null cases of loadAuthorPage,
 * loadReaderPoem and loadCollectionPage (a test compares them).
 */
export async function readerPathExists(path: ReaderPath): Promise<boolean> {
  const db = getDb();
  const author = and(eq(editors.slug, path.author), isNotNull(editors.penName));
  if (path.kind === "author") {
    const rows = await db.select({ one: sql`1` }).from(editors).where(author).limit(1);
    return rows.length > 0;
  }
  if (path.kind === "poem") {
    const rows = await db
      .select({ one: sql`1` })
      .from(poems)
      .innerJoin(editors, eq(editors.id, poems.editorId))
      .where(and(author, eq(poems.slug, path.poem), eq(poems.status, "published")))
      .limit(1);
    return rows.length > 0;
  }
  const rows = await db
    .select({ one: sql`1` })
    .from(collections)
    .innerJoin(editors, eq(editors.id, collections.editorId))
    .innerJoin(
      poems,
      and(eq(poems.collectionId, collections.id), eq(poems.editorId, collections.editorId), eq(poems.status, "published")),
    )
    .where(and(author, eq(collections.slug, path.collection)))
    .limit(1);
  return rows.length > 0;
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
      id: poems.id,
      collectionId: poems.collectionId,
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
  const { id, collectionId, ...poem } = row;
  return {
    ...poem,
    penName: row.penName!,
    authorSlug: row.authorSlug!,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    collection: collectionId ? await loadReaderCollection(collectionId, id) : null,
  };
}

/**
 * The published poem's place in its collection: part n of the *published*
 * poems (drafts never leave gaps) and its published neighbours. Titles,
 * slugs and visibility only: no text, so private neighbours stay title-only (N1).
 */
async function loadReaderCollection(collectionId: string, poemId: string): Promise<ReaderCollection | null> {
  const db = getDb();
  const [c] = await db
    .select({ title: collections.title, slug: collections.slug })
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1);
  if (!c) return null;
  const list = await db
    .select({ id: poems.id, title: poems.title, slug: poems.slug, visibility: poems.visibility, language: poems.language })
    .from(poems)
    .where(and(eq(poems.collectionId, collectionId), eq(poems.status, "published")))
    .orderBy(asc(poems.collectionPosition));
  const i = list.findIndex((p) => p.id === poemId);
  if (i < 0) return null;
  const neighbour = (p: (typeof list)[number] | undefined) =>
    p ? { title: p.title, slug: p.slug, visibility: p.visibility, language: p.language } : null;
  return { ...c, part: i + 1, parts: list.length, prev: neighbour(list[i - 1]), next: neighbour(list[i + 1]) };
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
      ...cardColumns,
      ...badgeColumns,
      publishedAt: poems.publishedAt,
    })
    .from(poems)
    .leftJoin(collections, eq(collections.id, poems.collectionId))
    .where(and(eq(poems.editorId, author.editorId), eq(poems.status, "published")))
    .orderBy(desc(poems.publishedAt), asc(poems.title));

  const list = rows.map(({ collectionTitle, collectionSlug, collectionPart, collectionParts, ...r }) => ({
    ...r,
    collection: badge({ collectionTitle, collectionSlug, collectionPart, collectionParts }),
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
    collections: await loadAuthorCollections(author.editorId),
  };
}

/** An author's collections that readers can see: at least one published poem, A–Z. */
async function loadAuthorCollections(editorId: string): Promise<AuthorCollection[]> {
  return getDb()
    .select({
      title: collections.title,
      slug: collections.slug,
      intro: collections.intro,
      poemCount: sql<number>`count(${poems.id})::int`,
    })
    .from(collections)
    .innerJoin(poems, and(eq(poems.collectionId, collections.id), eq(poems.status, "published")))
    .where(eq(collections.editorId, editorId))
    .groupBy(collections.id)
    .orderBy(asc(sql`lower(${collections.title})`), asc(collections.id));
}

/**
 * A collection's public page: its published poems in reading order, numbered
 * 1..n over published poems only (drafts never appear or leave gaps). Private
 * poems are title-only cards (N1); never the email. Null for an unknown or
 * not-yet-onboarded author, an unknown slug, or no published poems.
 */
export async function loadCollectionPage(authorSlug: string, collectionSlug: string): Promise<CollectionPage | null> {
  const db = getDb();
  const [c] = await db
    .select({
      id: collections.id,
      title: collections.title,
      slug: collections.slug,
      intro: collections.intro,
      updatedAt: collections.updatedAt,
      editorId: editors.id,
      penName: editors.penName,
      authorSlug: editors.slug,
    })
    .from(collections)
    .innerJoin(editors, eq(editors.id, collections.editorId))
    .where(and(eq(editors.slug, authorSlug), isNotNull(editors.penName), eq(collections.slug, collectionSlug)))
    .limit(1);
  if (!c) return null;

  const rows = await db
    .select({
      id: poems.id,
      title: poems.title,
      slug: poems.slug,
      visibility: poems.visibility,
      language: poems.language,
      publishedAt: poems.publishedAt,
      ...cardColumns,
    })
    .from(poems)
    .where(and(eq(poems.collectionId, c.id), eq(poems.editorId, c.editorId), eq(poems.status, "published")))
    .orderBy(asc(poems.collectionPosition));
  if (rows.length === 0) return null;

  return {
    title: c.title,
    slug: c.slug,
    intro: c.intro,
    penName: c.penName!,
    authorSlug: c.authorSlug!,
    editorId: c.editorId,
    updatedAt: c.updatedAt.toISOString(),
    poems: rows.map((r, i) => ({
      ...r,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      part: i + 1,
      collection: { title: c.title, slug: c.slug, part: i + 1, parts: rows.length },
    })),
  };
}
