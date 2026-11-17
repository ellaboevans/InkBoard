import "server-only";
import { countsAsVisit } from "@/lib/share-image/visits";
import { poemPath } from "@/lib/share-image/share-text";
import type { ShortLinkTarget } from "./short-links";

/*
 * GET /s/<code> (docs/PLAN.md, Phase 21 round 3), decided here and answered by
 * the proxy (src/proxy.ts), so a missing link gets the same real 404 page as
 * a missing poem.
 *
 * - A published public poem: 302 to /p/<author>/<poem>, `no-store`. Not a 301
 *   or 308: browsers keep permanent redirects indefinitely, so once the poem
 *   went private (or was deleted) a reader's browser would still send them to
 *   it without asking. A 302 that nothing may store is asked again every time.
 * - Anything else (malformed, unknown, private, draft, unpublished, deleted):
 *   "missing", which the proxy turns into /missing/poem, the same uncached 404
 *   as any missing poem page. resolveShortCode makes one query whatever the
 *   case, so a private poem's code looks exactly like one that never existed.
 * - Whether to count it (src/lib/share-image/visits.ts): the proxy then counts
 *   it after the response (event.waitUntil), so the redirect never waits on
 *   the count or fails because of it.
 */

export type ShortLinkOutcome =
  | { kind: "redirect"; location: string; poemId: string; count: boolean }
  | { kind: "missing" };

export async function handleShortLink(
  request: { method: string; headers: Headers },
  rawCode: string,
  resolve: (code: string) => Promise<ShortLinkTarget | null>,
): Promise<ShortLinkOutcome> {
  const target = await resolve(rawCode);
  if (!target) return { kind: "missing" };
  return {
    kind: "redirect",
    location: poemPath(target.authorSlug, target.poemSlug),
    poemId: target.poemId,
    count: countsAsVisit(request),
  };
}

/** The redirect's caching: never stored by a browser or a CDN (see the header). */
export const SHORT_LINK_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";
