import type { MetadataRoute } from "next";
import type { BoardSection } from "./board-types";
import { chapterPath, novelPath } from "./novel-seo";
import { absoluteUrl } from "./site";

/**
 * The sitemap's entries (src/app/sitemap.ts), pure so a test can check them:
 * the board, About and Privacy (Phase 19), every author page, collection page
 * (Phase 14), every published poem (private poems too: their page is public,
 * only the text is locked), and (Phase 23b) every novel page and published
 * chapter (a private novel's too, Phase 25, for the same reason). Built from the cached reader loaders, which never hold a draft or
 * a novel with nothing published.
 */
export function sitemapEntries(
  sections: BoardSection[],
  chapters: {
    authorSlug: string;
    novelSlug: string;
    chapterSlug: string;
    publishedAt: string | null;
    visibility?: "public" | "private";
  }[],
): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/novels"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    ...sections.flatMap((s) => [
      { url: absoluteUrl(`/a/${s.slug}`), changeFrequency: "weekly" as const, priority: 0.7 },
      // Collections with at least one published poem (the board has published poems only).
      ...[...new Set(s.poems.flatMap((p) => (p.collection ? [p.collection.slug] : [])))].map((slug) => ({
        url: absoluteUrl(`/a/${s.slug}/c/${slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
      // Novels with at least one published chapter (the board has no others).
      ...s.novels.map((n) => ({
        url: absoluteUrl(novelPath(s.slug, n.slug)),
        changeFrequency: "weekly" as const,
        priority: 0.8,
        ...(n.updatedAt && { lastModified: n.updatedAt }),
      })),
      ...s.poems.map((p) => ({
        url: absoluteUrl(`/p/${s.slug}/${p.slug}`),
        changeFrequency: "monthly" as const,
        priority: p.visibility === "public" ? 0.8 : 0.4,
      })),
    ]),
    ...chapters.map((c) => ({
      url: absoluteUrl(chapterPath(c.authorSlug, c.novelSlug, c.chapterSlug)),
      changeFrequency: "monthly" as const,
      // A private novel's chapter page is public, its text locked (like private poems).
      priority: c.visibility === "private" ? 0.4 : 0.7,
    })),
  ];
}
