import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { AuthorPage, BoardSection, ReaderPoem } from "@/lib/board-types";
import { loadAuthorPage, loadBoardSections, loadReaderPoem } from "./board";
import { BOARD_TAG } from "./cache-tags";
import { loadAuthorFeed, loadSiteFeed } from "./feeds";

/*
 * Cached reader data (N8). Everything readers see is tagged BOARD_TAG, and
 * every admin mutation calls updateTag(BOARD_TAG), so edits show up on the
 * next request. Data written outside the app (e.g. `pnpm db:seed`) appears
 * when the cache revalidates (hourly), or after restarting the server.
 */

export async function getBoardSections(): Promise<BoardSection[]> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
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
  cacheLife("hours");
  return loadAuthorPage(authorSlug);
}

/** Atom XML for /feed.xml. Same tag as the board, so publishes show at once. */
export async function getSiteFeed(): Promise<string> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  return loadSiteFeed();
}

/** Atom XML for /a/[author]/feed.xml, or null for an unknown author. */
export async function getAuthorFeed(authorSlug: string): Promise<string | null> {
  "use cache";
  cacheTag(BOARD_TAG);
  cacheLife("hours");
  return loadAuthorFeed(authorSlug);
}
