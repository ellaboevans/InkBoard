"use server";

import { refresh, updateTag } from "next/cache";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { BOARD_TAG } from "@/server/cache-tags";
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
