import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { ShareFormat } from "@/lib/share-image/layout";
import { loadSharePoem, type SharePoem } from "./board";
import { BOARD_TAG, poemTag } from "./cache-tags";
import { renderShareImage } from "./share-image";

/*
 * What Next's cache keeps for "Share as image" (docs/PLAN.md, Phase 21).
 * Tagged BOARD_TAG, which every change readers could see already updates
 * (poem save, publish, unpublish, visibility, delete; profile: pen name,
 * avatar; account deletion), plus the poem's own tag. A poem that isn't a
 * published public one caches null, and the same tags clear that once it is.
 *
 * - getSharePoem: the public poem the route checks first (a private, draft or
 *   unknown poem is null, so its text never reaches this cache, N1).
 * - getShareImage: the whole poem's PNG, one entry per poem and format: one
 *   render per poem, format and change, not one per share.
 * - Picked lines are NOT cached here: a reader can pick any of thousands of
 *   combinations, and caching them would let anyone fill the cache. The route
 *   renders them on demand, behind a rate limit (round 2).
 *
 * Only Next's cache keeps the PNG: the route tells browsers to revalidate
 * every time and shared caches (the CDN) not to store it, so an old image of
 * a poem that is now edited, private or deleted is never served.
 */
export async function getSharePoem(authorSlug: string, poemSlug: string): Promise<SharePoem | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  const poem = await loadSharePoem(authorSlug, poemSlug);
  if (poem) cacheTag(poemTag(poem.id));
  return poem;
}

export async function getShareImage(
  authorSlug: string,
  poemSlug: string,
  format: ShareFormat,
): Promise<{ png: Uint8Array; etag: string } | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  const poem = await getSharePoem(authorSlug, poemSlug);
  if (!poem) return null;
  cacheTag(poemTag(poem.id));
  const { png, etag } = await renderShareImage(poem, { format });
  return { png, etag };
}
