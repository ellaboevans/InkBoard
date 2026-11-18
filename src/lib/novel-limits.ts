import { TITLE_MAX } from "./poem-limits";

/**
 * Novels (docs/PLAN.md, Phase 23; docs/research/novels.md §2): the numbers
 * the server validator (src/server/novels.ts) and, later, the editor UI share.
 */

/** Novel and chapter titles: as for poems. */
export const NOVEL_TITLE_MAX = TITLE_MAX;
export const CHAPTER_TITLE_MAX = TITLE_MAX;

/** About 10,000 English words: room for long chapters, not a whole book in one. */
export const CHAPTER_BODY_MAX = 60_000;

/** Chapters per novel (drafts included). */
export const CHAPTERS_MAX = 200;

/** A back-cover blurb is ~150–250 words. */
export const BLURB_MAX = 2_000;

/** Novels per editor (bounds the author page and the board). */
export const NOVELS_MAX = 50;

/** Versions kept per chapter, the current one included (10 × 60 K worst case). */
export const CHAPTER_REVISIONS_KEPT = 10;

/** What readers (and the editor's lists) call a chapter: its title, or "Chapter n" when it has none. */
export function chapterDisplayTitle(title: string, n: number): string {
  return title.trim() || `Chapter ${n}`;
}

/** Reading speed for the reading times readers and writers see (words per minute). */
export const WORDS_PER_MINUTE = 230;

/** Minutes to read `words` words: at least 1 for any text, 0 for none. */
export function readingMinutes(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0;
}

/** A short reading time: "16 min", "1 h", "3 h 40 min". */
export function shortDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
