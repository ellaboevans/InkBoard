"use server";

import { refresh, updateTag } from "next/cache";
import { BOARD_TAG } from "@/server/cache-tags";
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
});

export async function createNovelAction(_prev: NovelFormState, formData: FormData): Promise<NovelFormState> {
  const editor = await requireOnboardedEditor();
  const res = await createNovel(editor.id, novelInput(formData));
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: "Couldn't create the novel." } };
  refresh(); // the list
  redirect(`/admin/novels/${res.novel.id}?created=1`);
}

export async function updateNovelAction(novelId: string, _prev: NovelFormState, formData: FormData): Promise<NovelFormState> {
  const editor = await requireOnboardedEditor();
  const res = await updateNovel(editor.id, novelId, novelInput(formData));
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: GONE } };
  updateTag(BOARD_TAG);
  refresh();
  return { savedAt: Date.now() };
}

export async function deleteNovelAction(novelId: string): Promise<void> {
  const editor = await requireOnboardedEditor();
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
  const res = await createChapter(editor.id, novelId, { title: "", body: "" });
  if (!res.ok) return { ok: false, error: "errors" in res ? (res.errors.form ?? "Couldn't add a chapter.") : GONE };
  refresh();
  redirect(`/admin/novels/${novelId}/chapters/${res.chapter.id}?created=1`);
}

export type ChapterFormState = {
  errors?: ChapterErrors;
  /** Set on every successful save (resets the form's dirty state and clears the device draft). */
  savedAt?: number;
  status?: "draft" | "published";
  /** The save published the chapter for the first time ever. */
  publishedNow?: boolean;
};

export async function saveChapterAction(chapterId: string, _prev: ChapterFormState, formData: FormData): Promise<ChapterFormState> {
  const editor = await requireOnboardedEditor();
  const res = await saveChapter(editor.id, chapterId, {
    title: str(formData, "title") ?? "",
    body: str(formData, "body") ?? "",
    // Which submit button was pressed: "Save draft", "Publish chapter", "Unpublish"…
    status: str(formData, "status"),
  });
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: CHAPTER_GONE } };
  updateTag(BOARD_TAG); // publish, unpublish, or an edit readers may see
  refresh(); // the novel page's list, History, the status badge
  return { savedAt: Date.now(), status: res.chapter.status, publishedNow: res.publishedNow };
}

export async function deleteChapterAction(novelId: string, chapterId: string): Promise<void> {
  const editor = await requireOnboardedEditor();
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
  const res = await reorderChapters(editor.id, novelId, chapterIds);
  if (res.ok) updateTag(BOARD_TAG);
  refresh(); // on failure, shows the current order
  if (!res.ok) {
    return { ok: false, error: "stale" in res ? "The chapters changed in the meantime. Here is their current order." : GONE };
  }
  return { ok: true };
}
