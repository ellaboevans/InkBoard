import "server-only";
import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { chapterReleased } from "./chapter-release";
import { chapters, editors, novels, poems } from "@/db/schema";
import { buildAtomFeed, type FeedEntry } from "@/lib/atom-feed";
import { authorFeedPath, novelFeedPath, SITE_FEED_PATH } from "@/lib/feed-links";
import { chapterDisplayTitle } from "@/lib/novel-limits";
import { chapterPath, novelPath } from "@/lib/novel-seo";
import { absoluteUrl, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/*
 * Atom feeds of published poems (docs/PLAN.md, Phase 12). Uncached and
 * framework-free like board.ts, so they're tested directly; the cached
 * wrappers (BOARD_TAG) live in board-cache.ts.
 *
 * Same rules as the board: published poems by onboarded editors only, the
 * body cut in SQL with CASE WHEN visibility = 'public' (N1), and never the
 * editor's email.
 *
 * Novels (Phase 24): the author feed also has an entry per published
 * chapter ("The Ferry: Chapter 4 · The Radio"), the site feed only each
 * novel's first chapter ("New novel by …"), so a long serial doesn't flood
 * it, and each novel has its own feed (/a/[author]/n/[novel]/feed.xml).
 * Published chapters only, numbered among published chapters like the
 * pages; the text through proseToHtml. A private novel's chapters (Phase 25)
 * are title-only entries: the body is cut in SQL with CASE WHEN the novel is
 * public (N1), and the builder writes PRIVATE_CHAPTER_TEXT instead.
 */

/** Newest entries per feed. Readers keep older entries they've already seen. */
export const FEED_LIMIT = 50;
/**
 * Chapter entries per feed: each carries the whole chapter (up to 60,000
 * characters), so fewer than poems keep a feed a sensible size.
 */
export const FEED_CHAPTER_LIMIT = 20;

async function loadEntries(editorId?: string): Promise<FeedEntry[]> {
  const rows = await getDb()
    .select({
      id: poems.id,
      title: poems.title,
      slug: poems.slug,
      penName: editors.penName,
      authorSlug: editors.slug,
      visibility: poems.visibility,
      language: poems.language,
      body: sql<string | null>`CASE WHEN ${poems.visibility} = 'public' THEN ${poems.body} END`,
      publishedAt: poems.publishedAt,
      updatedAt: poems.updatedAt,
    })
    .from(poems)
    .innerJoin(editors, eq(editors.id, poems.editorId))
    .where(
      and(
        eq(poems.status, "published"),
        isNotNull(poems.publishedAt),
        isNotNull(editors.penName),
        isNotNull(editors.slug),
        editorId ? eq(editors.id, editorId) : undefined,
      ),
    )
    .orderBy(desc(poems.publishedAt), desc(poems.id))
    .limit(FEED_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: absoluteUrl(`/p/${r.authorSlug}/${r.slug}`),
    penName: r.penName!,
    authorUrl: absoluteUrl(`/a/${r.authorSlug}`),
    visibility: r.visibility,
    language: r.language,
    body: r.body,
    published: r.publishedAt!,
    // A poem is never "updated" before it was published.
    updated: r.updatedAt > r.publishedAt! ? r.updatedAt : r.publishedAt!,
  }));
}

/**
 * Published chapters as feed entries, newest first. `scope` narrows them
 * (an author, a novel); `firstOnly` keeps each novel's chapter 1 only, dated
 * when the novel first had a published chapter.
 */
async function loadChapterEntries({ scope, firstOnly = false }: { scope?: SQL; firstOnly?: boolean }): Promise<FeedEntry[]> {
  const db = getDb();
  const numbered = db.$with("numbered").as(
    db
      .select({
        id: chapters.id,
        title: sql<string>`${chapters.title}`.as("chapter_title"),
        slug: sql<string>`${chapters.slug}`.as("chapter_slug"),
        // N1: a private novel's text never leaves the database here.
        body: sql<string | null>`CASE WHEN ${novels.visibility} = 'public' THEN ${chapters.body} END`.as("chapter_body"),
        visibility: novels.visibility,
        publishedAt: chapters.publishedAt,
        updatedAt: chapters.updatedAt,
        novelTitle: sql<string>`${novels.title}`.as("novel_title"),
        novelSlug: sql<string>`${novels.slug}`.as("novel_slug"),
        language: novels.language,
        penName: editors.penName,
        authorSlug: sql<string>`${editors.slug}`.as("author_slug"),
        // Reader numbering: released chapters only, in the novel's order.
        number: sql<number>`(row_number() OVER (PARTITION BY ${chapters.novelId} ORDER BY ${chapters.position}))::int`.as("number"),
        novelSince: sql<Date>`min(${chapters.publishedAt}) OVER (PARTITION BY ${chapters.novelId})`.as("novel_since"),
      })
      .from(chapters)
      .innerJoin(novels, eq(novels.id, chapters.novelId))
      .innerJoin(editors, eq(editors.id, novels.editorId))
      .where(
        and(
          chapterReleased(),
          isNotNull(chapters.publishedAt),
          isNotNull(editors.penName),
          isNotNull(editors.slug),
          scope,
        ),
      ),
  );
  const rows = await db
    .with(numbered)
    .select()
    .from(numbered)
    .where(firstOnly ? eq(numbered.number, 1) : undefined)
    .orderBy(desc(firstOnly ? numbered.novelSince : numbered.publishedAt), desc(numbered.id))
    .limit(FEED_CHAPTER_LIMIT);
  return rows.map((r) => {
    const published = new Date(firstOnly ? r.novelSince : r.publishedAt!);
    const updated = new Date(r.updatedAt);
    const name = chapterDisplayTitle(r.title, r.number);
    const own = name !== `Chapter ${r.number}`;
    return {
      id: r.id,
      format: "prose" as const,
      title: firstOnly
        ? `New novel by ${r.penName}: ${r.novelTitle}`
        : `${r.novelTitle}: Chapter ${r.number}${own ? ` · ${name}` : ""}`,
      url: absoluteUrl(chapterPath(r.authorSlug, r.novelSlug, r.slug)),
      penName: r.penName!,
      authorUrl: absoluteUrl(`/a/${r.authorSlug}`),
      visibility: r.visibility,
      language: r.language,
      body: r.body,
      published,
      updated: updated > published ? updated : published,
    };
  });
}

/** Poems and chapters together, newest first, at most FEED_LIMIT. */
function merge(...lists: FeedEntry[][]): FeedEntry[] {
  return lists
    .flat()
    .sort((a, b) => b.published.getTime() - a.published.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, FEED_LIMIT);
}

async function dbNow(): Promise<Date> {
  const res = (await getDb().execute(sql`SELECT now() AS now`)) as unknown as { rows: { now: Date | string }[] };
  return new Date(res.rows[0].now);
}

/** The whole board's newest poems and new novels (their first chapter only), as Atom XML. */
export async function loadSiteFeed(): Promise<string> {
  const entries = merge(await loadEntries(), await loadChapterEntries({ firstOnly: true }));
  return buildAtomFeed({
    selfUrl: absoluteUrl(SITE_FEED_PATH),
    pageUrl: absoluteUrl("/"),
    title: SITE_NAME,
    subtitle: `New poems and novels on ${SITE_NAME}. ${SITE_TAGLINE}`,
    iconUrl: absoluteUrl("/icon.svg"),
    emptyUpdated: entries.length ? entries[0].updated : await dbNow(),
    entries,
  });
}

/** One author's newest poems, as Atom XML; null for unknown or not-yet-onboarded authors. */
export async function loadAuthorFeed(authorSlug: string): Promise<string | null> {
  const [author] = await getDb()
    .select({ id: editors.id, penName: editors.penName, slug: editors.slug, updatedAt: editors.updatedAt })
    .from(editors)
    .where(and(eq(editors.slug, authorSlug), isNotNull(editors.penName)))
    .limit(1);
  if (!author) return null;
  const entries = merge(await loadEntries(author.id), await loadChapterEntries({ scope: eq(editors.id, author.id) }));
  const pageUrl = absoluteUrl(`/a/${author.slug}`);
  return buildAtomFeed({
    selfUrl: absoluteUrl(authorFeedPath(author.slug!)),
    pageUrl,
    title: `${author.penName} on ${SITE_NAME}`,
    subtitle: `New poems and chapters by ${author.penName} on ${SITE_NAME}.`,
    author: { name: author.penName!, url: pageUrl },
    iconUrl: absoluteUrl("/icon.svg"),
    emptyUpdated: author.updatedAt,
    entries,
  });
}

/**
 * One novel's published chapters, newest first, as Atom XML (Phase 24).
 * Null when readers can't see the novel (unknown, another author's slug,
 * or nothing published), like its page.
 */
export async function loadNovelFeed(authorSlug: string, novelSlug: string): Promise<string | null> {
  const [novel] = await getDb()
    .select({ id: novels.id, title: novels.title, slug: novels.slug, penName: editors.penName, authorSlug: editors.slug })
    .from(novels)
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .where(and(eq(editors.slug, authorSlug), isNotNull(editors.penName), eq(novels.slug, novelSlug)))
    .limit(1);
  if (!novel) return null;
  const entries = await loadChapterEntries({ scope: eq(novels.id, novel.id) });
  if (entries.length === 0) return null;
  const pageUrl = absoluteUrl(novelPath(novel.authorSlug!, novel.slug));
  return buildAtomFeed({
    selfUrl: absoluteUrl(novelFeedPath(novel.authorSlug!, novel.slug)),
    pageUrl,
    title: `${novel.title}, by ${novel.penName}`,
    subtitle: `New chapters of ${novel.title}, a novel by ${novel.penName} on ${SITE_NAME}.`,
    author: { name: novel.penName!, url: absoluteUrl(`/a/${novel.authorSlug}`) },
    iconUrl: absoluteUrl("/icon.svg"),
    emptyUpdated: entries[0].updated,
    entries,
  });
}
