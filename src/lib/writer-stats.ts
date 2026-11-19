/**
 * Stats for writers (docs/PLAN.md, Phase 27): only numbers InkBoard already
 * keeps, shown to the writer alone on /admin/stats. Pure: the types, the
 * follower threshold and the ordering, shared by src/server/writer-stats.ts
 * and the page, and tested in tests/lib/writer-stats.test.ts.
 */

/**
 * Below this many following devices the screen says "fewer than 3" instead of
 * the number. A writer who knows 1 or 2 people turned notifications on could
 * otherwise tell, from the count moving, when a particular person's phone
 * followed or left. The exact small number never leaves the server.
 */
export const FOLLOWER_THRESHOLD = 3;

export type FollowerCount = { kind: "count"; devices: number } | { kind: "few" };

export function followerCount(devices: number): FollowerCount {
  return devices >= FOLLOWER_THRESHOLD ? { kind: "count", devices } : { kind: "few" };
}

export type SharedLink = {
  kind: "poem" | "chapter";
  /** The poem's title, or the novel's title for a chapter. */
  title: string;
  /** For a chapter: "Chapter 3 · The Landing" (numbered among published chapters), else null. */
  detail: string | null;
  /** On the board or in its novel right now (published, and public for a poem). */
  live: boolean;
  visits: number;
};

export type NovelStats = {
  id: string;
  title: string;
  isPrivate: boolean;
  /** Released chapters: what readers see (a scheduled one counts once its time comes). */
  publishedChapters: number;
  /** Published with a release time still ahead (Phase 28): readers see nothing of them yet. */
  scheduledChapters: number;
  draftChapters: number;
  /** Words in released chapters only: what readers see. */
  words: number;
  /** readingMinutes(words), the novel page's "about n min". */
  readingMinutes: number;
  /** Visits through all of this novel's chapters' short links. */
  visits: number;
};

export type WriterStats = {
  links: SharedLink[];
  novels: NovelStats[];
  followers: FollowerCount;
};

/** Most visited first; ties by title so the order is stable. */
export function byVisits<T extends { visits: number; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.visits - a.visits || a.title.localeCompare(b.title));
}
