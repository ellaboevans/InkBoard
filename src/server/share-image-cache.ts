import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { loadSharePoem } from "./board";
import { BOARD_TAG, poemTag } from "./cache-tags";
import { renderShareImage } from "./share-image";

/*
 * The share image's PNG, cached on the server (docs/PLAN.md, Phase 21): one
 * render per poem per change, not one per share. Tagged BOARD_TAG, which
 * every change readers could see already updates (poem save, publish,
 * unpublish, visibility, delete; profile: pen name, avatar; account
 * deletion), plus the poem's own tag. A poem that isn't a published public
 * one caches null, and the same tags clear that once it is.
 *
 * Only Next's cache keeps the PNG: the route tells browsers to revalidate
 * every time and shared caches (the CDN) not to store it, so an old image of
 * a poem that is now edited, private or deleted is never served.
 */
export async function getShareImage(
  authorSlug: string,
  poemSlug: string,
): Promise<{ png: Uint8Array; etag: string } | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  const poem = await loadSharePoem(authorSlug, poemSlug);
  if (!poem) return null;
  cacheTag(poemTag(poem.id));
  return renderShareImage(poem);
}
