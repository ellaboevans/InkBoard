import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/sitemap-entries";
import { getBoardSections, getSitemapChapters } from "@/server/board-cache";

/**
 * Every reader page (see sitemapEntries): the same cached, BOARD_TAG data as
 * the board, so it follows publishes and unpublishes.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [sections, chapters] = await Promise.all([getBoardSections(), getSitemapChapters()]);
  return sitemapEntries(sections, chapters);
}
