"use server";

import { refresh, updateTag } from "next/cache";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { setPinnedPoem } from "@/server/auth/profile";
import { BOARD_TAG } from "@/server/cache-tags";

/** Pin a poem to the editor's profile, or unpin with null. */
export async function setPinnedPoemAction(poemId: string | null): Promise<{ ok: boolean }> {
  const editor = await requireOnboardedEditor();
  const ok = await setPinnedPoem(editor.id, poemId);
  // The pinned poem leads the public author page.
  if (ok) updateTag(BOARD_TAG);
  refresh();
  return { ok };
}
