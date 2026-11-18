import { truncate } from "@/components/brand/og-type";
import type { NovelPage, ReaderChapter } from "./board-types";
import { pluralCount } from "./plural";
import { stripProse } from "./prose";
import { absoluteUrl, SITE_NAME } from "./site";

/*
 * Search and sharing for novels (docs/PLAN.md, Phase 23b): addresses, meta
 * descriptions and the schema.org JSON-LD of the novel and chapter pages.
 * Pure: built from the reader loaders' results, which hold published
 * chapters only, so drafts can't reach any of it. Chapter text appears only
 * in a chapter page's own meta description (its first lines, as plain text
 * through stripProse), never in JSON-LD or a link card.
 */

export const novelPath = (authorSlug: string, novelSlug: string) => `/a/${authorSlug}/n/${novelSlug}`;
export const chapterPath = (authorSlug: string, novelSlug: string, chapterSlug: string) =>
  `${novelPath(authorSlug, novelSlug)}/${chapterSlug}`;

/** Meta descriptions stay under search engines' ~160 characters. */
const DESCRIPTION_MAX = 160;

/** The novel's blurb on one line, or a generic line when it has none. */
export function novelDescription(n: Pick<NovelPage, "fullBlurb" | "penName" | "chapterCount">): string {
  const blurb = n.fullBlurb?.replace(/\s+/g, " ").trim();
  if (blurb) return truncate(blurb, DESCRIPTION_MAX);
  return `A novel by ${n.penName} on ${SITE_NAME}, ${pluralCount(n.chapterCount, "chapter")} so far.`;
}

/**
 * The chapter's first lines as plain text (no emphasis markers, no scene
 * breaks). A private novel's chapter has no text here (its body is null, N1):
 * the generic line instead, never anything from behind the password.
 */
export function chapterDescription(c: Pick<ReaderChapter, "body" | "number" | "novel" | "penName">): string {
  const text = c.body === null || c.novel.visibility === "private" ? "" : stripProse(c.body).replace(/\s+/g, " ").trim();
  if (text) return truncate(text, DESCRIPTION_MAX);
  return `Chapter ${c.number} of ${c.novel.title}, a novel by ${c.penName}.`;
}

/** "PT19M": schema.org's timeRequired. */
const duration = (minutes: number) => `PT${Math.max(1, minutes)}M`;

const person = (penName: string, authorSlug: string) => ({
  "@type": "Person",
  name: penName,
  url: absoluteUrl(`/a/${authorSlug}`),
});

/** schema.org Book with its published chapters as `hasPart`. Titles, numbers and dates only. */
export function novelJsonLd(n: NovelPage) {
  const url = absoluteUrl(novelPath(n.authorSlug, n.slug));
  return {
    "@context": "https://schema.org",
    "@type": "Book",
    name: n.title,
    url,
    author: person(n.penName, n.authorSlug),
    ...(n.fullBlurb && { description: n.fullBlurb }),
    ...(n.language && { inLanguage: n.language }),
    bookFormat: "https://schema.org/EBook",
    isAccessibleForFree: true,
    creativeWorkStatus: n.status === "complete" ? "Complete" : "Ongoing",
    ...(n.updatedAt && { dateModified: n.updatedAt }),
    timeRequired: duration(n.readingMinutes),
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    hasPart: n.chapters.map((c) => ({
      "@type": "Chapter",
      name: c.displayTitle,
      position: c.number,
      url: absoluteUrl(chapterPath(n.authorSlug, n.slug, c.slug)),
      ...(c.publishedAt && { datePublished: c.publishedAt }),
    })),
  };
}

/** schema.org Chapter, `isPartOf` its Book. No text. */
export function chapterJsonLd(c: ReaderChapter) {
  const author = person(c.penName, c.authorSlug);
  return {
    "@context": "https://schema.org",
    "@type": "Chapter",
    name: c.displayTitle,
    position: c.number,
    url: absoluteUrl(chapterPath(c.authorSlug, c.novel.slug, c.slug)),
    author,
    ...(c.novel.language && { inLanguage: c.novel.language }),
    ...(c.publishedAt && { datePublished: c.publishedAt }),
    timeRequired: duration(c.readingMinutes),
    isAccessibleForFree: true,
    isPartOf: {
      "@type": "Book",
      name: c.novel.title,
      url: absoluteUrl(novelPath(c.authorSlug, c.novel.slug)),
      author,
      ...(c.novel.language && { inLanguage: c.novel.language }),
    },
  };
}
