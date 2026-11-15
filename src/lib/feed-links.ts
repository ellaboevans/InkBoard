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

/** The author's feed first (most specific), then the whole board's. */
export function feedAlternates(author?: { slug: string; penName: string }) {
  return {
    types: {
      [ATOM_TYPE]: [
        ...(author ? [{ url: absoluteUrl(authorFeedPath(author.slug)), title: `${author.penName} on ${SITE_NAME}` }] : []),
        { url: absoluteUrl(SITE_FEED_PATH), title: `${SITE_NAME}: new poems` },
      ],
    },
  };
}
