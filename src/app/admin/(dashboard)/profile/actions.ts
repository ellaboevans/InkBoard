"use server";

import { refresh, updateTag } from "next/cache";
import { getRequestMeta, requireOnboardedEditor, requireOnboardedSession } from "@/server/auth/dal";
import { generateRecoveryCodes } from "@/server/auth/recovery-codes";
import { requestStepUpCode, verifyStepUpCode } from "@/server/auth/step-up";
import { pluralCount } from "@/lib/plural";
import { updateProfile, type ProfileField, type ProfileFields } from "@/server/auth/profile";
import { revokeOtherSessions, revokeSession } from "@/server/auth/sessions";
import { BOARD_TAG } from "@/server/cache-tags";

export type ProfileState = {
  error?: string;
  field?: ProfileField;
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
    tagline: formData.get("tagline"),
    // Absent until the editor picks one (profile-form.tsx): leave it as it is.
    avatar: formData.has("avatar") ? formData.get("avatar") : undefined,
    links: formData.getAll("links"),
    pinnedPoemId: formData.get("pinnedPoemId"),
  });
  if (!res.ok) return { error: res.error, field: res.field };

  // The pen name labels the editor's section on the board and every poem page.
  updateTag(BOARD_TAG);
  // The sidebar (shared layout) shows the pen name and avatar too.
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

export type RecoveryCodesResult =
  | { ok: true; codes: string[] }
  /** The session isn't fresh: confirm with an emailed code first. */
  | { ok: false; stepUp: true }
  | { ok: false; error: string };

/**
 * Make (or replace) the editor's recovery codes. The step-up rule is checked
 * in generateRecoveryCodes, inside its transaction: this action never
 * decides freshness itself.
 */
export async function createRecoveryCodesAction(): Promise<RecoveryCodesResult> {
  const { editor, sessionId } = await requireOnboardedSession();
  const { userAgent } = await getRequestMeta();
  const res = await generateRecoveryCodes({ editorId: editor.id, sessionId, userAgent });
  if (!res.ok) return { ok: false, stepUp: true };
  // The count on this page and the dashboard notices change.
  refresh();
  return { ok: true, codes: res.codes };
}

export type StepUpRequestResult = { ok: true; email: string; resendAt: number } | { ok: false; error: string };

/** Email this session a confirmation code. */
export async function requestStepUpAction(): Promise<StepUpRequestResult> {
  const { editor, sessionId } = await requireOnboardedSession();
  const res = await requestStepUpCode({ editorId: editor.id, sessionId });
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.error === "rate_limited"
          ? `Please wait ${pluralCount(res.retryAfter, "second")} before asking for another code.`
          : "Your session has ended. Sign in again.",
    };
  }
  return { ok: true, email: res.email, resendAt: Date.now() + res.resendIn * 1000 };
}

/**
 * Check an emailed confirmation code. On success this session counts as
 * freshly verified (step-up.ts), and the caller retries what needed it.
 */
export async function verifyStepUpCodeAction(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { editor, sessionId } = await requireOnboardedSession();
  const res = await verifyStepUpCode({ editorId: editor.id, sessionId, code });
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.error === "too_many_attempts"
          ? "Too many incorrect attempts. Ask for a new code."
          : res.error === "rate_limited"
            ? `Too many attempts. Try again in ${Math.ceil(res.retryAfter / 60)} min.`
            : res.attemptsLeft !== undefined
              ? `That code is incorrect. ${pluralCount(res.attemptsLeft, "attempt")} left.`
              : "That code is invalid or has expired. Ask for a new one.",
    };
  }
  refresh();
  return { ok: true };
}
