import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { buildAtomFeed, type FeedEntry } from "@/lib/atom-feed";
import { authorFeedPath, SITE_FEED_PATH } from "@/lib/feed-links";
import { absoluteUrl, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/*
 * Atom feeds of published poems (docs/PLAN.md, Phase 12). Uncached and
 * framework-free like board.ts, so they're tested directly; the cached
 * wrappers (BOARD_TAG) live in board-cache.ts.
 *
 * Same rules as the board: published poems by onboarded editors only, the
 * body cut in SQL with CASE WHEN visibility = 'public' (N1), and never the
 * editor's email.
 */

/** Newest poems per feed. Readers keep older entries they've already seen. */
export const FEED_LIMIT = 50;

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

async function dbNow(): Promise<Date> {
  const res = (await getDb().execute(sql`SELECT now() AS now`)) as unknown as { rows: { now: Date | string }[] };
  return new Date(res.rows[0].now);
}

/** The whole board's newest poems, as Atom XML. */
export async function loadSiteFeed(): Promise<string> {
  const entries = await loadEntries();
  return buildAtomFeed({
    selfUrl: absoluteUrl(SITE_FEED_PATH),
    pageUrl: absoluteUrl("/"),
    title: SITE_NAME,
    subtitle: `New poems on ${SITE_NAME}. ${SITE_TAGLINE}`,
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
  const entries = await loadEntries(author.id);
  const pageUrl = absoluteUrl(`/a/${author.slug}`);
  return buildAtomFeed({
    selfUrl: absoluteUrl(authorFeedPath(author.slug!)),
    pageUrl,
    title: `${author.penName} on ${SITE_NAME}`,
    subtitle: `New poems by ${author.penName} on ${SITE_NAME}.`,
    author: { name: author.penName!, url: pageUrl },
    iconUrl: absoluteUrl("/icon.svg"),
    emptyUpdated: author.updatedAt,
    entries,
  });
}
