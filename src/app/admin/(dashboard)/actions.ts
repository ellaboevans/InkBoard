"use server";

import { refresh, updateTag } from "next/cache";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { setPinnedPoem } from "@/server/auth/profile";
import { dismissRecoveryPrompt } from "@/server/auth/recovery-codes";
import { BOARD_TAG } from "@/server/cache-tags";
import { hideChecklist, markAuthorPageShared } from "@/server/welcome-checklist";

/** Pin a poem to the editor's profile, or unpin with null. */
export async function setPinnedPoemAction(poemId: string | null): Promise<{ ok: boolean }> {
  const editor = await requireOnboardedEditor();
  const ok = await setPinnedPoem(editor.id, poemId);
  // The pinned poem leads the public author page.
  if (ok) updateTag(BOARD_TAG);
  refresh();
  return { ok };
}

/** "Not now" on the recovery-code setup prompt. Stored on the editor, so every device stops asking. */
export async function dismissRecoveryPromptAction(): Promise<void> {
  const editor = await requireOnboardedEditor();
  await dismissRecoveryPrompt(editor.id);
  refresh();
}

/** "Hide checklist" on the dashboard's welcome checklist (Phase 20): permanent, on every device. */
export async function hideChecklistAction(): Promise<void> {
  const editor = await requireOnboardedEditor();
  await hideChecklist(editor.id);
  refresh();
}

/**
 * The checklist's Share button was used (shared with the Web Share API, or the
 * link copied). Only the fact is stored; the server checks a poem is published.
 */
export async function markAuthorPageSharedAction(): Promise<void> {
  const editor = await requireOnboardedEditor();
  await markAuthorPageShared(editor.id);
  refresh();
}
