"use server";

import { refresh, updateTag } from "next/cache";
import { requireOnboardedEditor, requireOnboardedSession } from "@/server/auth/dal";
import { updateProfile, type ProfileFields } from "@/server/auth/profile";
import { revokeOtherSessions, revokeSession } from "@/server/auth/sessions";
import { BOARD_TAG } from "@/server/cache-tags";

export type ProfileState = {
  error?: string;
  field?: "penName" | "bio";
  savedAt?: number;
  profile?: ProfileFields;
};

export async function saveProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  // Re-authorise inside the action; never trust the page that rendered it.
  const editor = await requireOnboardedEditor();
  const res = await updateProfile(editor.id, {
    penName: formData.get("penName"),
    bio: formData.get("bio"),
  });
  if (!res.ok) return { error: res.error, field: res.field };

  // The pen name labels the editor's section on the board and every poem page.
  updateTag(BOARD_TAG);
  // The admin header (shared layout) shows the pen name too.
  refresh();
  return { savedAt: Date.now(), profile: res.profile };
}

export type RevokeResult = { ok: true; count: number } | { ok: false; error: string };

/** Sign out one other device. The current device uses the normal Sign out button. */
export async function revokeSessionAction(sessionId: string): Promise<RevokeResult> {
  const { editor, sessionId: current } = await requireOnboardedSession();
  if (sessionId === current) {
    return { ok: false, error: "Use Sign out to end the session on this device." };
  }
  const removed = await revokeSession(editor.id, sessionId);
  refresh();
  // Already gone (expired, or revoked from another tab) is fine: the list just refreshes.
  return { ok: true, count: removed ? 1 : 0 };
}

export async function revokeOtherSessionsAction(): Promise<RevokeResult> {
  const { editor, sessionId } = await requireOnboardedSession();
  const count = await revokeOtherSessions(editor.id, sessionId);
  refresh();
  return { ok: true, count };
}
