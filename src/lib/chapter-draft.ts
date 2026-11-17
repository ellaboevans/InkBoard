/**
 * The chapter editor's autosave on the device (docs/PLAN.md, Phase 23a):
 * while the writer types, the title and text are kept in the browser's
 * localStorage under one key per chapter, so a dropped connection or a closed
 * tab doesn't lose a page of work. Removed on a successful save (or when the
 * writer discards it). Never sent anywhere; the Privacy page lists the key.
 *
 * Pure and client-safe: the hook in the editor does the storage calls.
 */

export const CHAPTER_DRAFT_PREFIX = "inkboard-chapter-draft:";

export const chapterDraftKey = (chapterId: string) => `${CHAPTER_DRAFT_PREFIX}${chapterId}`;

export type ChapterDraft = { title: string; body: string; /** When it was written, ms since 1970. */ at: number };

/** What's stored: a small versioned JSON object. */
export function serializeDraft(draft: ChapterDraft): string {
  return JSON.stringify({ v: 1, title: draft.title, body: draft.body, at: draft.at });
}

/** The stored draft, or null for anything missing, malformed or from another version. */
export function parseDraft(raw: string | null | undefined): ChapterDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (d.v !== 1 || typeof d.title !== "string" || typeof d.body !== "string" || typeof d.at !== "number") return null;
    if (!Number.isFinite(d.at)) return null;
    return { title: d.title, body: d.body, at: d.at };
  } catch {
    return null;
  }
}

/** Line endings and outer whitespace aside, the same text (so a draft equal to the saved chapter isn't offered). */
const comparable = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();

export function sameContent(a: { title: string; body: string }, b: { title: string; body: string }): boolean {
  return comparable(a.title) === comparable(b.title) && comparable(a.body) === comparable(b.body);
}

/**
 * Whether to offer restoring `draft` over the saved chapter: it exists, it
 * was written after the chapter was last saved (so a save from another
 * device wins), and it says something different.
 */
export function shouldOfferDraft(
  draft: ChapterDraft | null,
  saved: { title: string; body: string; updatedAt: number },
): draft is ChapterDraft {
  return !!draft && draft.at > saved.updatedAt && !sameContent(draft, saved);
}
