import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { AuthorPage, BoardSection, CollectionPage, NovelPage, ReaderChapter, ReaderPoem, SerialsPage } from "@/lib/board-types";
import {
  loadAuthorPage,
  loadBoardSections,
  loadCollectionPage,
  loadNovelPage,
  loadReaderChapter,
  loadReaderPoem,
  loadSerialsPage,
  loadSitemapChapters,
  type SitemapChapter,
} from "./board";
import { BOARD_TAG } from "./cache-tags";
import { releaseAwareCacheLife } from "./release-cache";
import { loadAuthorFeed, loadNovelFeed, loadSiteFeed } from "./feeds";

/*
 * Cached reader data (N8). Everything readers see is tagged BOARD_TAG, and
 * every admin mutation calls updateTag(BOARD_TAG), so edits show up on the
 * next request. Data written outside the app (e.g. `pnpm db:seed`) appears
 * when the cache revalidates (hourly), or after restarting the server.
 *
 * Anything that can show chapters lives only until the next scheduled release
 * (releaseAwareCacheLife, Phase 28), so a scheduled chapter appears at its
 * time with nothing running then. Poem-only data keeps cacheLife("hours").
 */

export async function getBoardSections(): Promise<BoardSection[]> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadBoardSections();
}

export async function getReaderPoem(
  authorSlug: string,
  poemSlug: string,
): Promise<ReaderPoem | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  return loadReaderPoem(authorSlug, poemSlug);
}

export async function getAuthorPage(authorSlug: string): Promise<AuthorPage | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadAuthorPage(authorSlug);
}

/** Atom XML for /feed.xml. Same tag as the board, so publishes show at once. */
export async function getSiteFeed(): Promise<string> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadSiteFeed();
}

/** Atom XML for /a/[author]/feed.xml, or null for an unknown author. */
export async function getAuthorFeed(authorSlug: string): Promise<string | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadAuthorFeed(authorSlug);
}

/** A collection's public page (Phase 14); null when readers have nothing to see there. */
export async function getCollectionPage(authorSlug: string, collectionSlug: string): Promise<CollectionPage | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  return loadCollectionPage(authorSlug, collectionSlug);
}

/** A novel's public page (Phase 23b); null when it has no published chapter. */
export async function getNovelPage(authorSlug: string, novelSlug: string): Promise<NovelPage | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadNovelPage(authorSlug, novelSlug);
}

/** A published chapter with its text (Phase 23b); null for drafts and anything missing. */
export async function getReaderChapter(authorSlug: string, novelSlug: string, chapterSlug: string): Promise<ReaderChapter | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadReaderChapter(authorSlug, novelSlug, chapterSlug);
}

/** Published chapters for the sitemap (Phase 23b); same tag, so publishes and unpublishes show. */
export async function getSitemapChapters(): Promise<SitemapChapter[]> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadSitemapChapters();
}

/** Atom XML for /a/[author]/n/[novel]/feed.xml (Phase 24), or null when readers can't see the novel. */
export async function getNovelFeed(authorSlug: string, novelSlug: string): Promise<string | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadNovelFeed(authorSlug, novelSlug);
}

/** The "ongoing serials" page, /novels (Phase 29): released chapters only, so it lives until the next release. */
export async function getSerialsPage(): Promise<SerialsPage> {
  "use cache";
  cacheTag(BOARD_TAG);
  await releaseAwareCacheLife();
  return loadSerialsPage();
}
