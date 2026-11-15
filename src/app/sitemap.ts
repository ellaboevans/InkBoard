import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { getBoardSections } from "@/server/board-cache";

/**
 * The board, every author page, collection page (Phase 14) and every published poem (private poems too:
 * their page is public, only the text is locked). Same cached, BOARD_TAG data
 * as the board, so it follows publishes and unpublishes.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sections = await getBoardSections();
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    ...sections.flatMap((s) => [
      { url: absoluteUrl(`/a/${s.slug}`), changeFrequency: "weekly" as const, priority: 0.7 },
      // Collections with at least one published poem (the board has published poems only).
      ...[...new Set(s.poems.flatMap((p) => (p.collection ? [p.collection.slug] : [])))].map((slug) => ({
        url: absoluteUrl(`/a/${s.slug}/c/${slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
      ...s.poems.map((p) => ({
        url: absoluteUrl(`/p/${s.slug}/${p.slug}`),
        changeFrequency: "monthly" as const,
        priority: p.visibility === "public" ? 0.8 : 0.4,
      })),
    ]),
  ];
}
