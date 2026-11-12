"use server";

import { refresh } from "next/cache";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { setPinnedPoem } from "@/server/auth/profile";

/** Pin a poem to the editor's profile, or unpin with null. */
export async function setPinnedPoemAction(poemId: string | null): Promise<{ ok: boolean }> {
  const editor = await requireOnboardedEditor();
  const ok = await setPinnedPoem(editor.id, poemId);
  refresh();
  return { ok };
}
