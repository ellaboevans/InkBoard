"use server";

import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { refresh } from "next/cache";
import { getRequestMeta, requireOnboardedSession } from "@/server/auth/dal";
import {
  dismissPasskeyOffer,
  finishPasskeyRegistration,
  finishPasskeyStepUp,
  removePasskey,
  renamePasskey,
  startPasskeyRegistration,
  startPasskeyStepUp,
} from "@/server/auth/passkeys";
import { relyingParty } from "@/server/auth/webauthn-config";
import { setCeremonyToken, takeCeremonyToken } from "@/server/auth/webauthn-cookie";

/*
 * Passkey actions for the profile and the dashboard's offer. Each one
 * re-authorises through the DAL; the editor and session ids never come from
 * the client. The step-up rules live in passkeys.ts (passkeyGate).
 */

export type PasskeyActionFailure =
  | { ok: false; reason: "step_up" }
  | { ok: false; reason: "public_device" }
  | { ok: false; reason: "error"; message: string };

export async function startPasskeyRegistrationAction(): Promise<
  { ok: true; options: PublicKeyCredentialCreationOptionsJSON } | PasskeyActionFailure
> {
  const { editor, sessionId } = await requireOnboardedSession();
  const res = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: relyingParty() });
  if (res.ok) {
    await setCeremonyToken("registration", res.token);
    return { ok: true, options: res.options };
  }
  if (res.error === "step_up_required") return { ok: false, reason: "step_up" };
  if (res.error === "public_device") return { ok: false, reason: "public_device" };
  return {
    ok: false,
    reason: "error",
    message:
      res.error === "too_many"
        ? "You have as many passkeys as InkBoard allows. Remove one first."
        : res.error === "rate_limited"
          ? "Too many attempts. Try again in a while."
          : "Your session has ended. Sign in again.",
  };
}

export async function finishPasskeyRegistrationAction(
  response: unknown,
): Promise<{ ok: true; name: string } | PasskeyActionFailure> {
  const { editor, sessionId } = await requireOnboardedSession();
  const { userAgent } = await getRequestMeta();
  const res = await finishPasskeyRegistration({
    editorId: editor.id,
    sessionId,
    token: await takeCeremonyToken("registration"),
    response,
    rp: relyingParty(),
    userAgent,
  });
  if (res.ok) {
    refresh();
    return { ok: true, name: res.passkey.name };
  }
  if (res.error === "step_up_required") return { ok: false, reason: "step_up" };
  if (res.error === "public_device") return { ok: false, reason: "public_device" };
  return {
    ok: false,
    reason: "error",
    message:
      res.error === "too_many"
        ? "You have as many passkeys as InkBoard allows. Remove one first."
        : "That passkey couldn't be added. Please try again.",
  };
}

export async function renamePasskeyAction(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { editor } = await requireOnboardedSession();
  const res = await renamePasskey(editor.id, id, name);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

export async function removePasskeyAction(id: string): Promise<{ ok: true } | PasskeyActionFailure> {
  const { editor, sessionId } = await requireOnboardedSession();
  const { userAgent } = await getRequestMeta();
  const res = await removePasskey({ editorId: editor.id, sessionId, id, userAgent });
  if (res.ok) {
    refresh();
    return { ok: true };
  }
  if (res.error === "step_up_required") return { ok: false, reason: "step_up" };
  // Already gone (another tab) or the session ended: the list refreshes either way.
  refresh();
  return { ok: false, reason: "error", message: "That passkey no longer exists." };
}

/** Confirm it's you with one of your passkeys (profile step-up). */
export async function startPasskeyStepUpAction(): Promise<
  { ok: true; options: PublicKeyCredentialRequestOptionsJSON } | { ok: false; error: string }
> {
  const { editor, sessionId } = await requireOnboardedSession();
  const res = await startPasskeyStepUp({ editorId: editor.id, sessionId, rp: relyingParty() });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error === "no_passkeys" ? "You don't have a passkey yet." : "Too many attempts. Try again in a while.",
    };
  }
  await setCeremonyToken("step-up", res.token);
  return { ok: true, options: res.options };
}

export async function finishPasskeyStepUpAction(response: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { editor, sessionId } = await requireOnboardedSession();
  const res = await finishPasskeyStepUp({
    editorId: editor.id,
    sessionId,
    token: await takeCeremonyToken("step-up"),
    response,
    rp: relyingParty(),
  });
  if (!res.ok) return { ok: false, error: "That passkey didn't confirm it's you. Try again, or use an email code." };
  refresh();
  return { ok: true };
}

/** "Not now" on the dashboard's add-a-passkey offer (this session only). */
export async function dismissPasskeyOfferAction(): Promise<void> {
  const { editor, sessionId } = await requireOnboardedSession();
  await dismissPasskeyOffer(editor.id, sessionId);
  refresh();
}
