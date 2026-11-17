"use server";

import { refresh, updateTag } from "next/cache";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { BOARD_TAG } from "@/server/cache-tags";
import { photoProblemMessage } from "@/lib/photo-messages";
import { removePhoto, savePhoto } from "@/server/profile-photos";

export type PhotoActionResult = { ok: true } | { ok: false; error: string };

/**
 * Upload, crop and save a profile photo in one step (docs/PLAN.md, Phase 22).
 * Re-authorised here; the editor id comes only from the DAL. On any failure
 * nothing changed (savePhoto keeps the old photo).
 */
export async function savePhotoAction(formData: FormData): Promise<PhotoActionResult> {
  const editor = await requireOnboardedEditor();
  const res = await savePhoto(editor.id, { file: formData.get("photo"), crop: formData.get("crop") });
  if (!res.ok) return { ok: false, error: photoProblemMessage(res.problem, res.type) };
  // The board, author page, poem pages, feeds, link cards and share images
  // (whose ETags include the photo) are all cached under BOARD_TAG.
  updateTag(BOARD_TAG);
  // The sidebar (shared layout) shows it too.
  refresh();
  return { ok: true };
}

export async function removePhotoAction(): Promise<PhotoActionResult> {
  const editor = await requireOnboardedEditor();
  const removed = await removePhoto(editor.id);
  if (removed) updateTag(BOARD_TAG);
  refresh();
  return { ok: true };
}
