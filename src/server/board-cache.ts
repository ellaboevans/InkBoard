import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { AuthorPage, BoardSection, ReaderPoem } from "@/lib/board-types";
import { loadAuthorPage, loadBoardSections, loadReaderPoem } from "./board";
import { BOARD_TAG } from "./cache-tags";

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
