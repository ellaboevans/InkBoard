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
