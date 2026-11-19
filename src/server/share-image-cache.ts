import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { releaseAwareCacheLife } from "./release-cache";
import type { ShareDesign } from "@/lib/share-image/designs";
import type { ShareFormat } from "@/lib/share-image/layout";
import { loadShareChapter, loadSharePoem, type ShareChapter, type SharePoem } from "./board";
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
 * - getShareImage: the whole poem's PNG, one entry per poem, format, design and
 *   short code: at most 2 × 3 = 6 per poem (only those someone opens), about
 *   100–200 KB each, re-drawn once per change, not once per share.
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
  design: ShareDesign,
  shortCode: string,
): Promise<{ png: Uint8Array; etag: string } | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  const poem = await getSharePoem(authorSlug, poemSlug);
  if (!poem) return null;
  cacheTag(poemTag(poem.id));
  // The route made the code before calling (this function can't write); it's part of the key.
  const { png, etag } = await renderShareImage({ ...poem, shortCode }, { format, design });
  return { png, etag };
}

/**
 * "Share a passage" (Phase 25): the chapter the route checks first, a
 * published chapter of a public novel or null (a private novel's chapter is
 * null, so its text never reaches this cache, N1). Passage pictures
 * themselves are never cached here, like picked lines.
 */
export async function getShareChapter(authorSlug: string, novelSlug: string, chapterSlug: string): Promise<ShareChapter | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadShareChapter(authorSlug, novelSlug, chapterSlug);
}
