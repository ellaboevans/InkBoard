"use server";

import { refresh, updateTag } from "next/cache";
import { photoProblemMessage } from "@/lib/photo-messages";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { BOARD_TAG } from "@/server/cache-tags";
import { removeCover, saveCover } from "@/server/novel-covers";

export type CoverActionResult = { ok: true } | { ok: false; error: string };

/**
 * Upload, crop and save a novel's cover in one step (docs/PLAN.md, Phase
 * 25). Re-authorised here; the editor id comes only from the DAL, and the
 * novel id from the client is only ever looked up among their own novels
 * (novel-covers.ts). On any failure nothing changed (the old cover stays).
 */
export async function saveCoverAction(novelId: string, formData: FormData): Promise<CoverActionResult> {
  const editor = await requireOnboardedEditor();
  const res = await saveCover(editor.id, novelId, { file: formData.get("cover"), crop: formData.get("crop") });
  if (!res.ok) return { ok: false, error: photoProblemMessage(res.problem, res.type, "cover") };
  // The board's book cards, the author page, the novel page, the list view and
  // the link cards are all cached under BOARD_TAG.
  updateTag(BOARD_TAG);
  refresh();
  return { ok: true };
}

/** Back to the drawn cover; the uploaded one's files are deleted. */
export async function removeCoverAction(novelId: string): Promise<CoverActionResult> {
  const editor = await requireOnboardedEditor();
  const removed = await removeCover(editor.id, novelId);
  if (removed) updateTag(BOARD_TAG);
  refresh();
  return { ok: true };
}
