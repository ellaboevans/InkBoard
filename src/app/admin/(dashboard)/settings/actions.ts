"use server";

import { refresh, updateTag } from "next/cache";
import { endSession, getRequestMeta, requireOnboardedEditor, requireOnboardedSession } from "@/server/auth/dal";
import { deleteAccount } from "@/server/account-deletion";
import { BOARD_TAG, poemTag } from "@/server/cache-tags";
import { setSharedPassword, switchToPerPoemPasswords } from "@/server/password-settings";

export type PasswordSettingsState = {
  error?: string;
  savedAt?: number;
  mode?: "per_poem" | "shared";
};

export async function savePasswordSettingsAction(
  _prev: PasswordSettingsState,
  formData: FormData,
): Promise<PasswordSettingsState> {
  const editor = await requireOnboardedEditor();
  const mode = formData.get("mode");

  const res =
    mode === "shared"
      ? await setSharedPassword(editor.id, formData.get("password"))
      : mode === "per_poem"
        ? await switchToPerPoemPasswords(editor.id)
        : ({ ok: false, error: "Choose how your private poems are protected" } as const);
  if (!res.ok) return { error: res.error };

  // Readers see a different lock hint, and existing unlocks are revoked.
  updateTag(BOARD_TAG);
  refresh();
  return { savedAt: Date.now(), mode: mode === "shared" ? "shared" : "per_poem" };
}

export type DeleteAccountActionResult =
  | { ok: true }
  | { ok: false; reason: "step_up" }
  | { ok: false; reason: "error"; message: string };

/**
 * Delete the signed-in editor's account (Phase 17). Re-authorises through the
 * DAL; the step-up and pen-name checks happen in deleteAccount, inside its
 * transaction. Then readers stop seeing the author at once (every reader page
 * is cached under BOARD_TAG; per-poem tags too), and the cookie is cleared.
 * The client follows with a full page load to the board.
 */
export async function deleteAccountAction(confirmation: string): Promise<DeleteAccountActionResult> {
  const { editor, sessionId } = await requireOnboardedSession();
  const { userAgent } = await getRequestMeta();
  const res = await deleteAccount({ editorId: editor.id, sessionId, confirmation, userAgent });
  if (!res.ok) {
    if (res.error === "step_up_required") return { ok: false, reason: "step_up" };
    return {
      ok: false,
      reason: "error",
      message:
        res.error === "wrong_confirmation"
          ? "That isn't your pen name as it's written. Type it exactly, including capitals."
          : "Your session has ended. Sign in again.",
    };
  }
  updateTag(BOARD_TAG);
  for (const id of res.poemIds) updateTag(poemTag(id));
  await endSession();
  return { ok: true };
}
