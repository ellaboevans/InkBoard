"use server";

import { refresh, updateTag } from "next/cache";
import { after } from "next/server";
import { BOARD_TAG } from "@/server/cache-tags";
import { announceChapter } from "@/server/push";
import { announceReleasedChapters } from "@/server/release-announcements";
import { redirect, RedirectType } from "next/navigation";
import { requireOnboardedEditor } from "@/server/auth/dal";
import {
  createChapter,
  createNovel,
  deleteChapter,
  deleteNovel,
  moveChapter,
  reorderChapters,
  saveChapter,
  updateNovel,
  type ChapterErrors,
  type NovelErrors,
} from "@/server/novels";

/*
 * Novels in the dashboard (docs/PLAN.md, Phase 23a). Every action
 * re-authorises through the DAL and passes only the editor id from the
 * session to novels.ts, which scopes every query by it; ids from the client
 * are only ever looked up within the editor's own novels and chapters.
 *
 * Readers see novels (Phase 23b): the board's book cards, the author page,
 * the novel page and the chapter pages, all cached under BOARD_TAG. So every
 * successful change that could reach them refreshes it, as poems' actions do:
 * novel details, chapter saves (publish, unpublish, edits), moves, reorders
 * and deletes. Only creating is left out: a new novel has no chapter and a
 * new chapter is an empty draft, so readers can't see either. A failed or
 * foreign write refreshes nothing.
 */

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

const GONE = "This novel no longer exists or isn't yours.";
const CHAPTER_GONE = "This chapter no longer exists or isn't yours.";

// ---- novels ------------------------------------------------------------------

export type NovelFormState = { errors?: NovelErrors; savedAt?: number };

const novelInput = (formData: FormData) => ({
  title: str(formData, "title") ?? "",
  blurb: str(formData, "blurb"),
  language: str(formData, "language"),
  status: str(formData, "status"),
  // The details form only (Phase 25); absent from "New novel" = public. The
  // password is hashed in novels.ts and never comes back to the client.
  visibility: str(formData, "visibility"),
  password: str(formData, "password"),
});

export async function createNovelAction(_prev: NovelFormState, formData: FormData): Promise<NovelFormState> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const res = await createNovel(editor.id, novelInput(formData));
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: "Couldn't create the novel." } };
  refresh(); // the list
  redirect(`/admin/novels/${res.novel.id}?created=1`);
}

export async function updateNovelAction(novelId: string, _prev: NovelFormState, formData: FormData): Promise<NovelFormState> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const res = await updateNovel(editor.id, novelId, novelInput(formData));
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: GONE } };
  updateTag(BOARD_TAG);
  refresh();
  return { savedAt: Date.now() };
}

export async function deleteNovelAction(novelId: string): Promise<void> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const deleted = await deleteNovel(editor.id, novelId);
  if (deleted) updateTag(BOARD_TAG);
  refresh();
  // Replace: Back must not return to a novel that's gone.
  redirect(deleted ? "/admin/novels?deleted=1" : "/admin/novels", RedirectType.replace);
}

// ---- chapters ------------------------------------------------------------------

/** "New chapter": an empty draft at the end, opened in the editor (Back returns to the novel). */
export async function createChapterAction(novelId: string): Promise<{ ok: false; error: string } | void> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const res = await createChapter(editor.id, novelId, { title: "", body: "" });
  if (!res.ok) return { ok: false, error: "errors" in res ? (res.errors.form ?? "Couldn't add a chapter.") : GONE };
  refresh();
  redirect(`/admin/novels/${novelId}/chapters/${res.chapter.id}?created=1`);
}

/**
 * Scheduled chapters of this writer's released since (Phase 28): their "new
 * chapter" notification, after the response. The daily cleanup is the
 * guarantee; this sends sooner whenever the writer works on their novels,
 * with no work on any reader page.
 */
function announceReleasedLater(editorId: string) {
  after(() =>
    announceReleasedChapters(editorId).catch((e: unknown) => {
      console.error("[push] release announcements failed", e);
    }),
  );
}

/**
 * A chapter's one "new chapter" notification (Phase 24), claimed by the
 * publishing transaction: sent after the response, to followers only.
 */
function announceLater(chapterId: string, announce: boolean) {
  if (!announce) return;
  after(() =>
    announceChapter(chapterId).catch((e: unknown) => {
      console.error("[push] announcing a chapter failed", e);
    }),
  );
}

export type ChapterFormState = {
  errors?: ChapterErrors;
  /** Set on every successful save (resets the form's dirty state and clears the device draft). */
  savedAt?: number;
  status?: "draft" | "published";
  /** Phase 28: when it goes live (ISO), while that is still ahead; null when not scheduled. */
  scheduledAt?: string | null;
  /** What this save did with the schedule, for the toast. */
  scheduleChange?: "scheduled" | "rescheduled" | "cancelled";
  /** The save published the chapter for the first time ever. */
  publishedNow?: boolean;
};

export async function saveChapterAction(chapterId: string, prev: ChapterFormState, formData: FormData): Promise<ChapterFormState> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  // Which submit button was pressed: "Save draft", "Publish chapter", "Unpublish", "Publish now"
  // (status "now"), or the schedule dialog's "Schedule" (status "schedule", with releaseAt).
  const pressed = str(formData, "status");
  const res = await saveChapter(editor.id, chapterId, {
    title: str(formData, "title") ?? "",
    body: str(formData, "body") ?? "",
    ...(pressed === "schedule"
      ? { releaseAt: str(formData, "releaseAt") ?? "" }
      : pressed === "now"
        ? { status: "published", releaseNow: true }
        : { status: pressed }),
  });
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: CHAPTER_GONE } };
  // Publish, unpublish, an edit readers may see, or a schedule: readers see nothing of it yet, but
  // cached reader data made before it lives an hour, too long for a release sooner than that
  // (src/server/release-cache.ts), so it must be dropped now.
  updateTag(BOARD_TAG);
  announceLater(chapterId, res.announce);
  refresh(); // the novel page's list, History, the status badge
  const scheduledAt = res.chapter.scheduled && res.chapter.releaseAt ? res.chapter.releaseAt.toISOString() : null;
  const wasScheduled = Boolean(prev.scheduledAt);
  return {
    savedAt: Date.now(),
    status: res.chapter.status,
    scheduledAt,
    scheduleChange: pressed === "schedule" ? (wasScheduled ? "rescheduled" : "scheduled") : wasScheduled && res.chapter.status === "draft" ? "cancelled" : undefined,
    publishedNow: res.publishedNow,
  };
}

export async function deleteChapterAction(novelId: string, chapterId: string): Promise<void> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const deleted = await deleteChapter(editor.id, chapterId);
  if (deleted) updateTag(BOARD_TAG);
  refresh();
  // Replace: Back must not reopen the deleted chapter's editor.
  redirect(`/admin/novels/${novelId}${deleted ? "?chapter-deleted=1" : ""}`, RedirectType.replace);
}

export type MoveChapterActionResult = { ok: true; position: number; total: number } | { ok: false; error: string };

export async function moveChapterAction(
  novelId: string,
  chapterId: string,
  direction: "up" | "down" | "first" | "last",
): Promise<MoveChapterActionResult> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const res = await moveChapter(editor.id, novelId, chapterId, direction);
  if (!res.ok) return { ok: false, error: "This chapter or novel no longer exists or isn't yours." };
  updateTag(BOARD_TAG); // readers number published chapters in this order
  refresh();
  return res;
}

export type ReorderActionResult = { ok: true } | { ok: false; error: string };

/** Save a dragged order. The server checks it's still the same set of chapters. */
export async function reorderChaptersAction(novelId: string, chapterIds: string[]): Promise<ReorderActionResult> {
  const editor = await requireOnboardedEditor();
  announceReleasedLater(editor.id);
  const res = await reorderChapters(editor.id, novelId, chapterIds);
  if (res.ok) updateTag(BOARD_TAG);
  refresh(); // on failure, shows the current order
  if (!res.ok) {
    return { ok: false, error: "stale" in res ? "The chapters changed in the meantime. Here is their current order." : GONE };
  }
  return { ok: true };
}
