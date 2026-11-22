import type { BoardSection } from "@/lib/board-types";
import { novelPath } from "@/lib/novel-seo";

/*
 * Featured (docs/PLAN.md, Phase 33), the readers' side: what the board's
 * Featured panel and the list view's Featured section show, taken from the
 * board's own (cached) sections. A work carries `featuredAt` only while
 * readers can see it and it's public (board.ts), so a hidden, private or
 * unpublished one simply isn't here. Pure, so it's tested directly.
 */

/** At most this many featured at once, poems and novels together (the owner's cap). */
export const FEATURED_MAX = 6;

export type FeaturedEntry = {
  key: string;
  kind: "poem" | "novel";
  title: string;
  penName: string;
  /** A poem's /p/… (opens the overlay from the board) or a novel's page. */
  href: string;
  /** The work's language, for `lang` on its title. */
  language: string | null;
  featuredAt: string;
};

/** Newest featured first, at most FEATURED_MAX. */
export function featuredFromSections(sections: BoardSection[]): FeaturedEntry[] {
  const out: FeaturedEntry[] = [];
  for (const s of sections) {
    for (const p of s.poems) {
      if (p.featuredAt) {
        out.push({ key: `poem:${p.id}`, kind: "poem", title: p.title, penName: s.penName, href: `/p/${s.slug}/${p.slug}`, language: p.language, featuredAt: p.featuredAt });
      }
    }
    for (const n of s.novels) {
      if (n.featuredAt) {
        out.push({ key: `novel:${n.id}`, kind: "novel", title: n.title, penName: s.penName, href: novelPath(s.slug, n.slug), language: n.language, featuredAt: n.featuredAt });
      }
    }
  }
  return out.sort((a, b) => (a.featuredAt < b.featuredAt ? 1 : a.featuredAt > b.featuredAt ? -1 : a.key.localeCompare(b.key))).slice(0, FEATURED_MAX);
}
