/**
 * Feed URLs and their autodiscovery links (docs/PLAN.md, Phase 12). Pages
 * spread `feedAlternates()` into `alternates`; Next renders each as
 * <link rel="alternate" type="application/atom+xml" …> in the head.
 * Absolute URLs, so they work when a page is shared or proxied.
 */
import { absoluteUrl, SITE_NAME } from "./site";

export const ATOM_TYPE = "application/atom+xml";
export const SITE_FEED_PATH = "/feed.xml";
export const authorFeedPath = (authorSlug: string) => `/a/${authorSlug}/feed.xml`;
/** A novel's own feed (Phase 24); `feed.xml` is never read as a chapter slug (reader-paths.ts, offline rules). */
export const novelFeedPath = (authorSlug: string, novelSlug: string) => `/a/${authorSlug}/n/${novelSlug}/feed.xml`;

/** The most specific feed first: the novel's, then the author's, then the whole board's. */
export function feedAlternates(author?: { slug: string; penName: string }, novel?: { slug: string; title: string }) {
  return {
    types: {
      [ATOM_TYPE]: [
        ...(author && novel
          ? [{ url: absoluteUrl(novelFeedPath(author.slug, novel.slug)), title: `${novel.title}, by ${author.penName}` }]
          : []),
        ...(author ? [{ url: absoluteUrl(authorFeedPath(author.slug)), title: `${author.penName} on ${SITE_NAME}` }] : []),
        { url: absoluteUrl(SITE_FEED_PATH), title: `${SITE_NAME}: new poems` },
      ],
    },
  };
}

/*
 * Each reader page's `alternates` (its canonical URL, then its feeds, most
 * specific first), built here so tests/lib/feed-links.test.ts pins every page
 * in one place. Pages spread nothing else into `alternates`: Next replaces a
 * parent's `alternates` rather than merging it.
 *
 * Where they end up: the board's metadata is prerendered, so its links are in
 * the <head> of the HTML. Every other page's metadata reads `params`, so under
 * Cache Components Next streams it: browsers get the tags at the end of the
 * <body> and React moves them into the <head> when it hydrates, while the user
 * agents in `htmlLimitedBots` (Next's bots plus the feed readers in
 * src/lib/html-limited-bots.ts) get them in the <head> before the page.
 */
type Author = { slug: string; penName: string };
type Novel = { slug: string; title: string };

export const boardAlternates = () => ({ canonical: "/", ...feedAlternates() });

export const authorPageAlternates = (a: Author) => ({ canonical: `/a/${a.slug}`, ...feedAlternates(a) });

export const collectionPageAlternates = (c: { authorSlug: string; penName: string; slug: string }) => ({
  canonical: `/a/${c.authorSlug}/c/${c.slug}`,
  ...feedAlternates({ slug: c.authorSlug, penName: c.penName }),
});

export const poemPageAlternates = (p: { authorSlug: string; penName: string; slug: string }) => ({
  canonical: `/p/${p.authorSlug}/${p.slug}`,
  ...feedAlternates({ slug: p.authorSlug, penName: p.penName }),
});

export const novelPageAlternates = (n: { authorSlug: string; penName: string } & Novel) => ({
  canonical: `/a/${n.authorSlug}/n/${n.slug}`,
  ...feedAlternates({ slug: n.authorSlug, penName: n.penName }, { slug: n.slug, title: n.title }),
});

export const chapterPageAlternates = (c: { authorSlug: string; penName: string; slug: string; novel: Novel }) => ({
  canonical: `/a/${c.authorSlug}/n/${c.novel.slug}/${c.slug}`,
  ...feedAlternates({ slug: c.authorSlug, penName: c.penName }, c.novel),
});

/** The "ongoing serials" page (Phase 29): the site feed, which announces every new novel. */
export const serialsPageAlternates = () => ({ canonical: "/novels", ...feedAlternates() });
