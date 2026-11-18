import "server-only";
import { EXCERPT_CHARS, EXCERPT_LINES } from "@/lib/poem-text";
import { authorPicture, type AuthorPicture } from "@/lib/author-picture";
import { and, asc, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, collections, editors, novels, poems, shortLinks } from "@/db/schema";
import type {
  AuthorCollection,
  AuthorPage,
  BoardNovel,
  BoardSection,
  CollectionBadge,
  CollectionPage,
  NovelPage,
  ReaderChapter,
  ReaderChapterSummary,
  ReaderCollection,
  ReaderPoem,
} from "@/lib/board-types";
import { chapterDisplayTitle, readingMinutes } from "@/lib/novel-limits";
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
  const db = getDb();
  const onboarded = and(isNotNull(editors.penName), isNotNull(editors.slug));
  // Authors with something published (a poem, or a novel's chapter), in
  // catalogue order: A–Z by pen name. Sorted here in SQL, once, so a section
  // made only of novels lands in the same order as any other.
  const authors = await db
    .select({
      editorId: editors.id,
      penName: editors.penName,
      authorSlug: editors.slug,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
    })
    .from(editors)
    .where(
      and(
        onboarded,
        or(
          sql`EXISTS (SELECT 1 FROM ${poems} WHERE ${poems.editorId} = ${editors.id} AND ${poems.status} = 'published')`,
          sql`EXISTS (SELECT 1 FROM ${novels} JOIN ${chapters} ON ${chapters.novelId} = ${novels.id}
            WHERE ${novels.editorId} = ${editors.id} AND ${chapters.status} = 'published')`,
        ),
      ),
    )
    .orderBy(asc(sql`lower(${editors.penName})`), asc(editors.id));

  const rows = await db
    .select({
      editorId: poems.editorId,
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
    .where(and(eq(poems.status, "published"), onboarded))
    // Newest poems first within a section.
    .orderBy(desc(poems.publishedAt), asc(poems.title));

  const sections = new Map<string, BoardSection>();
  for (const a of authors) {
    sections.set(a.editorId, {
      editorId: a.editorId,
      penName: a.penName!,
      slug: a.authorSlug!,
      picture: authorPicture({ id: a.editorId, avatar: a.avatar, photoKey: a.photoKey }),
      novels: [],
      poems: [],
    });
  }
  for (const row of rows) {
    sections.get(row.editorId)?.poems.push({
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
  for (const { editorId, novel } of await loadNovelCards(onboarded)) sections.get(editorId)?.novels.push(novel);
  return [...sections.values()];
}

// ---- novels (Phase 23b) ---------------------------------------------------------------
//
// Readers see a novel only once it has a published chapter, and only its
// published chapters: every query below joins chapters with
// status = 'published', and counts, numbers and reading times are computed
// over those rows alone, so a draft never shows, not even as a gap in the
// numbering or a word in the total.
//
// Private novels (Phase 25, N1): readers see a private novel's title, cover,
// blurb and chapter list (numbers, titles, reading times), never its chapter
// text. The text is selected only with CASE WHEN the novel is public, so a
// private chapter's text isn't even loaded into the server process here; it
// comes only from unlock.ts (readUnlockedChapterBody), after the grant check.

/** How long the board's and author page's blurb may be: about three lines of the card. */
const CARD_BLURB_CHARS = 280;

/** Book cards for every novel matching `where` (on editors/novels) with a published chapter, newest chapter first. */
async function loadNovelCards(where: SQL | undefined): Promise<{ editorId: string; novel: BoardNovel }[]> {
  const rows = await getDb()
    .select({
      editorId: novels.editorId,
      id: novels.id,
      title: novels.title,
      slug: novels.slug,
      language: novels.language,
      status: novels.status,
      visibility: novels.visibility,
      coverKey: novels.coverKey,
      blurb: sql<string | null>`NULLIF(left(split_part(${novels.blurb}, E'\n', 1), ${CARD_BLURB_CHARS}), '')`,
      chapterCount: sql<number>`count(${chapters.id})::int`,
      wordCount: sql<number>`coalesce(sum(${chapters.wordCount}), 0)::int`,
      updatedAt: sql<Date | null>`max(${chapters.publishedAt})`.mapWith(chapters.publishedAt),
    })
    .from(novels)
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .innerJoin(chapters, and(eq(chapters.novelId, novels.id), eq(chapters.status, "published")))
    .where(where)
    .groupBy(novels.id)
    .orderBy(desc(sql`max(${chapters.publishedAt})`), asc(novels.title), asc(novels.id));
  return rows.map(({ editorId, updatedAt, ...n }) => ({
    editorId,
    novel: { ...n, readingMinutes: readingMinutes(n.wordCount), updatedAt: updatedAt?.toISOString() ?? null },
  }));
}

/** The novel by author + novel slug, with its published chapters (no text), or null if it has none. */
async function loadNovelWithChapters(authorSlug: string, novelSlug: string) {
  const db = getDb();
  const [n] = await db
    .select({
      id: novels.id,
      title: novels.title,
      slug: novels.slug,
      language: novels.language,
      status: novels.status,
      visibility: novels.visibility,
      coverKey: novels.coverKey,
      blurb: novels.blurb,
      sharedPassword: sql<boolean>`${editors.passwordMode} = 'shared'`,
      editorId: editors.id,
      penName: editors.penName,
      authorSlug: editors.slug,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
    })
    .from(novels)
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .where(and(eq(editors.slug, authorSlug), isNotNull(editors.penName), eq(novels.slug, novelSlug)))
    .limit(1);
  if (!n) return null;
  const rows = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      slug: chapters.slug,
      wordCount: chapters.wordCount,
      publishedAt: chapters.publishedAt,
    })
    .from(chapters)
    .where(and(eq(chapters.novelId, n.id), eq(chapters.status, "published")))
    .orderBy(asc(chapters.position));
  if (rows.length === 0) return null;
  const list = rows.map((c, i): ReaderChapterSummary & { id: string } => ({
    id: c.id,
    number: i + 1,
    title: c.title,
    displayTitle: chapterDisplayTitle(c.title, i + 1),
    slug: c.slug,
    wordCount: c.wordCount,
    readingMinutes: readingMinutes(c.wordCount),
    publishedAt: c.publishedAt?.toISOString() ?? null,
  }));
  return { novel: n, chapters: list };
}

/** A chapter summary for readers: the row id stays on the server. */
function withoutId({ number, title, displayTitle, slug, wordCount, readingMinutes, publishedAt }: ReaderChapterSummary): ReaderChapterSummary {
  return { number, title, displayTitle, slug, wordCount, readingMinutes, publishedAt };
}

/**
 * A novel's public page: its published chapters in reading order, numbered
 * 1..n without drafts, with words and reading time over those chapters. Null
 * for an unknown or not-yet-onboarded author, an unknown slug (another
 * author's novel included), or a novel with no published chapter.
 */
export async function loadNovelPage(authorSlug: string, novelSlug: string): Promise<NovelPage | null> {
  const found = await loadNovelWithChapters(authorSlug, novelSlug);
  if (!found) return null;
  const { novel: n, chapters: list } = found;
  const wordCount = list.reduce((sum, c) => sum + c.wordCount, 0);
  const updatedAt = list.reduce<string | null>((max, c) => (c.publishedAt && (!max || c.publishedAt > max) ? c.publishedAt : max), null);
  const firstParagraph = n.blurb?.split("\n")[0].slice(0, CARD_BLURB_CHARS) || null;
  return {
    id: n.id,
    title: n.title,
    slug: n.slug,
    language: n.language,
    status: n.status,
    visibility: n.visibility,
    coverKey: n.coverKey,
    sharedPassword: n.sharedPassword,
    blurb: firstParagraph,
    fullBlurb: n.blurb,
    chapterCount: list.length,
    wordCount,
    readingMinutes: readingMinutes(wordCount),
    updatedAt,
    penName: n.penName!,
    authorSlug: n.authorSlug!,
    editorId: n.editorId,
    picture: authorPicture({ id: n.editorId, avatar: n.avatar, photoKey: n.photoKey }),
    chapters: list.map(withoutId),
  };
}

/**
 * A published chapter with its text, its number among the published chapters
 * and its published neighbours. Null when the novel has nothing published or
 * the chapter is a draft, deleted or unknown: the same null, so a draft looks
 * exactly like a chapter that never existed.
 */
export async function loadReaderChapter(
  authorSlug: string,
  novelSlug: string,
  chapterSlug: string,
): Promise<ReaderChapter | null> {
  const found = await loadNovelWithChapters(authorSlug, novelSlug);
  if (!found) return null;
  const { novel: n, chapters: list } = found;
  const i = list.findIndex((c) => c.slug === chapterSlug);
  if (i < 0) return null;
  // N1: a private novel's text stays in the database (unlock.ts reads it after the grant check).
  const [row] = await getDb()
    .select({ body: sql<string | null>`CASE WHEN ${novels.visibility} = 'public' THEN ${chapters.body} END` })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapters.id, list[i].id), eq(chapters.novelId, n.id), eq(chapters.status, "published")))
    .limit(1);
  // Unpublished between the two queries: not found, like any draft.
  if (!row) return null;
  const near = (c: (typeof list)[number] | undefined) =>
    c ? { number: c.number, displayTitle: c.displayTitle, slug: c.slug } : null;
  return {
    ...withoutId(list[i]),
    body: row.body,
    of: list.length,
    novel: {
      id: n.id,
      title: n.title,
      slug: n.slug,
      language: n.language,
      status: n.status,
      visibility: n.visibility,
      sharedPassword: n.sharedPassword,
      coverKey: n.coverKey,
    },
    penName: n.penName!,
    authorSlug: n.authorSlug!,
    editorId: n.editorId,
    prev: near(list[i - 1]),
    next: near(list[i + 1]),
  };
}

/**
 * Every published chapter readers can open, for the sitemap (Phase 23b):
 * author, novel and chapter slugs in reading order, plus when each was first
 * published. Drafts and novels with nothing published never appear; no text.
 */
export type SitemapChapter = {
  authorSlug: string;
  novelSlug: string;
  chapterSlug: string;
  publishedAt: string | null;
  /** A private novel's chapter pages are listed too (their page is public; the text is locked), with a lower priority. */
  visibility: "public" | "private";
};

export async function loadSitemapChapters(): Promise<SitemapChapter[]> {
  const rows = await getDb()
    .select({
      authorSlug: editors.slug,
      novelSlug: novels.slug,
      chapterSlug: chapters.slug,
      publishedAt: chapters.publishedAt,
      visibility: novels.visibility,
    })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .where(and(eq(chapters.status, "published"), isNotNull(editors.penName), isNotNull(editors.slug)))
    .orderBy(asc(editors.slug), asc(novels.slug), asc(chapters.position));
  return rows.map((r) => ({
    authorSlug: r.authorSlug!,
    novelSlug: r.novelSlug,
    chapterSlug: r.chapterSlug,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    visibility: r.visibility,
  }));
}

/**
 * Does this reader page have anything to show? The proxy (src/proxy.ts) asks
 * before a full page load, so a missing page answers with a real 404 instead
 * of a streamed "not found" under a 200 (docs/PLAN.md, Phase 19). One small
 * indexed query, with exactly the null cases of loadAuthorPage,
 * loadReaderPoem, loadCollectionPage, loadNovelPage and loadReaderChapter
 * (a test compares them).
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
  if (path.kind === "novel" || path.kind === "chapter") {
    // A novel exists for readers once it has a published chapter; a chapter only while it's published.
    const rows = await db
      .select({ one: sql`1` })
      .from(novels)
      .innerJoin(editors, eq(editors.id, novels.editorId))
      .innerJoin(
        chapters,
        and(
          eq(chapters.novelId, novels.id),
          eq(chapters.status, "published"),
          path.kind === "chapter" ? eq(chapters.slug, path.chapter) : undefined,
        ),
      )
      .where(and(author, eq(novels.slug, path.novel)))
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
      editorId: editors.id,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
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
  const { id, collectionId, editorId, avatar, photoKey, ...poem } = row;
  return {
    ...poem,
    picture: authorPicture({ id: editorId, avatar, photoKey }),
    penName: row.penName!,
    authorSlug: row.authorSlug!,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    collection: collectionId ? await loadReaderCollection(collectionId, id) : null,
  };
}

/**
 * What the share image needs (docs/PLAN.md, Phase 21): a published **public**
 * poem by an author with a pen name, or null. A private, draft, deleted or
 * unknown poem (or another author's slug) is the same null, so the route gives
 * them one 404. The WHERE clause already excludes private poems; the body
 * still goes through CASE WHEN like every reader query (N1), so a private
 * poem's text is never selected even if the filter were changed.
 */
export type SharePoem = {
  id: string;
  title: string;
  slug: string;
  body: string;
  language: string | null;
  penName: string;
  authorSlug: string;
  editorId: string;
  avatar: string | null;
  /** The author's photo or avatar (Phase 22): drawn in the byline, part of the ETag. */
  picture: AuthorPicture;
  /** Its short link's code (/s/<code>, Phase 21 round 3), or null until its first picture makes one. */
  shortCode: string | null;
};

export async function loadSharePoem(authorSlug: string, poemSlug: string): Promise<SharePoem | null> {
  const [row] = await getDb()
    .select({
      id: poems.id,
      title: poems.title,
      slug: poems.slug,
      body: sql<string | null>`CASE WHEN ${isPublic} THEN ${poems.body} END`,
      language: poems.language,
      penName: editors.penName,
      authorSlug: editors.slug,
      editorId: editors.id,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
      shortCode: shortLinks.code,
    })
    .from(poems)
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .leftJoin(shortLinks, eq(shortLinks.poemId, poems.id))
    .where(
      and(
        eq(editors.slug, authorSlug),
        eq(poems.slug, poemSlug),
        eq(poems.status, "published"),
        eq(poems.visibility, "public"),
        isNotNull(editors.penName),
      ),
    )
    .limit(1);
  if (!row || row.body === null || row.penName === null || row.authorSlug === null) return null;
  const { photoKey, ...rest } = row;
  return {
    ...rest,
    body: row.body,
    penName: row.penName,
    authorSlug: row.authorSlug,
    picture: authorPicture({ id: row.editorId, avatar: row.avatar, photoKey }),
  };
}

/**
 * A chapter for "Share a passage" (Phase 25): a published chapter of a public
 * novel by an onboarded author, with its text, its number among the published
 * chapters and its short code; null for everything else, private novels
 * included (an owner's decision: no passage pictures of a private novel,
 * unlocked or not), so the route answers them all with the one 404 before it
 * looks at the passage. The text is still selected through CASE WHEN (N1).
 */
export type ShareChapter = {
  id: string;
  slug: string;
  title: string;
  /** Among the published chapters, as readers number them. */
  number: number;
  body: string;
  novel: { id: string; title: string; slug: string; language: string | null };
  penName: string;
  authorSlug: string;
  editorId: string;
  picture: AuthorPicture;
  /** Its short link's code, or null until its first passage picture makes one. */
  shortCode: string | null;
};

export async function loadShareChapter(authorSlug: string, novelSlug: string, chapterSlug: string): Promise<ShareChapter | null> {
  const [row] = await getDb()
    .select({
      id: chapters.id,
      slug: chapters.slug,
      title: chapters.title,
      body: sql<string | null>`CASE WHEN ${novels.visibility} = 'public' THEN ${chapters.body} END`,
      // Raw names: inside a subquery drizzle would render bare column names.
      number: sql<number>`(SELECT count(*)::int FROM chapters o
        WHERE o.novel_id = "chapters"."novel_id" AND o.status = 'published' AND o.position <= "chapters"."position")`,
      novelId: novels.id,
      novelTitle: novels.title,
      novelSlug: novels.slug,
      language: novels.language,
      penName: editors.penName,
      authorSlug: editors.slug,
      editorId: editors.id,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
      shortCode: shortLinks.code,
    })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .leftJoin(shortLinks, eq(shortLinks.chapterId, chapters.id))
    .where(
      and(
        eq(editors.slug, authorSlug),
        eq(novels.slug, novelSlug),
        eq(chapters.slug, chapterSlug),
        eq(chapters.status, "published"),
        eq(novels.visibility, "public"),
        isNotNull(editors.penName),
      ),
    )
    .limit(1);
  if (!row || row.body === null || row.penName === null || row.authorSlug === null) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    number: row.number,
    body: row.body,
    novel: { id: row.novelId, title: row.novelTitle, slug: row.novelSlug, language: row.language },
    penName: row.penName,
    authorSlug: row.authorSlug,
    editorId: row.editorId,
    picture: authorPicture({ id: row.editorId, avatar: row.avatar, photoKey: row.photoKey }),
    shortCode: row.shortCode,
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
      photoKey: editors.photoKey,
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
    picture: authorPicture({ id: author.editorId, avatar: author.avatar, photoKey: author.photoKey }),
    tagline: author.tagline,
    bio: author.bio,
    links: Array.isArray(author.links) ? author.links : [],
    poems: list,
    collections: await loadAuthorCollections(author.editorId),
    novels: (await loadNovelCards(eq(novels.editorId, author.editorId))).map((r) => r.novel),
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
