"use server";

import { redirect } from "next/navigation";
import { deviceIdForSignIn, getRequestMeta, startSession } from "@/server/auth/dal";
import { requestOtp, verifyLinkToken, verifyOtp } from "@/server/auth/otp";
import type { Editor } from "@/db/schema";
import { notifyIfNewSignIn } from "@/server/auth/sign-in-alerts";
import { verifyRecoveryCode } from "@/server/auth/recovery-codes";
import { finishPasskeySignIn, startPasskeySignIn } from "@/server/auth/passkeys";
import { relyingParty } from "@/server/auth/webauthn-config";
import { setCeremonyToken, takeCeremonyToken } from "@/server/auth/webauthn-cookie";
import { PASSKEY_SIGN_IN_FAILED } from "@/lib/passkey-messages";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import type { SessionOptions } from "@/server/auth/sessions";
import { pluralCount } from "@/lib/plural";

export type SignInState =
  | { step: "email"; email?: string; publicDevice?: boolean; error?: string }
  | {
      step: "code";
      email: string;
      /** "This isn't my device", carried from the email step into the code step's checkbox. */
      publicDevice: boolean;
      /** Epoch ms after which "resend" is allowed. */
      resendAt: number;
      error?: string;
      notice?: string;
    };

/** The "This isn't my device" checkbox (a Radix checkbox posts "on" when ticked). */
const isPublicDevice = (formData: FormData) => formData.get("publicDevice") === "on";

const waitMessage = (s: number) =>
  `Please wait ${pluralCount(s, "second")} before requesting another code.`;

/**
 * Single state machine for the sign-in card, driven by the `intent` field:
 * `request` (send a code), `resend`, `verify`, `change-email`.
 */
export async function signInAction(
  prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const intent = formData.get("intent");
  const { ip, userAgent } = await getRequestMeta();

  const publicDevice = isPublicDevice(formData);

  if (intent === "change-email") {
    return { step: "email", email: prev.email, publicDevice: prev.publicDevice };
  }

  if (intent === "request" || intent === "resend") {
    const email = formData.get("email");
    const res = await requestOtp({ email, ip });
    if (!res.ok) {
      if (res.error === "invalid_email") {
        return {
          step: "email",
          email: String(email ?? ""),
          publicDevice,
          error: "Enter a valid email address.",
        };
      }
      const retryAt = Date.now() + res.retryAfter * 1000;
      return prev.step === "code"
        ? { ...prev, resendAt: retryAt, error: waitMessage(res.retryAfter) }
        : {
            step: "email",
            email: String(email ?? ""),
            publicDevice,
            error: waitMessage(res.retryAfter),
          };
    }
    return {
      step: "code",
      email: res.email,
      // A resend comes from the code step's second form, which has no checkbox.
      publicDevice: intent === "resend" && prev.step === "code" ? prev.publicDevice : publicDevice,
      resendAt: Date.now() + res.resendIn * 1000,
      notice: intent === "resend" ? "A new code is on its way." : undefined,
    };
  }

  if (intent === "verify" && prev.step === "code") {
    const res = await verifyOtp({
      email: prev.email,
      code: formData.get("code"),
      ip,
    });
    if (!res.ok) {
      const error =
        res.error === "too_many_attempts"
          ? "Too many incorrect attempts. Request a new code."
          : res.error === "rate_limited"
            ? `Too many attempts. Try again in ${Math.ceil(res.retryAfter / 60)} min.`
            : res.attemptsLeft !== undefined
              ? `That code is incorrect. ${pluralCount(res.attemptsLeft, "attempt")} left.`
              : "That code is invalid or has expired.";
      return { ...prev, publicDevice, error, notice: undefined };
    }
    await completeSignIn(res.editor, ip, userAgent, { publicDevice, method: "email" });
  }

  return { step: "email" };
}

export type LinkSignInState = { error?: string };

/**
 * Sign in with the link from the email (/sign-in/link). The token comes from
 * the URL fragment, read in the browser only when the person presses
 * "Continue", so mail scanners that pre-open links can't use it up.
 */
export async function linkSignInAction(_prev: LinkSignInState, formData: FormData): Promise<LinkSignInState> {
  const { ip, userAgent } = await getRequestMeta();
  const res = await verifyLinkToken({ token: formData.get("token"), ip });
  if (!res.ok) {
    return {
      error:
        res.error === "rate_limited"
          ? `Too many attempts. Try again in ${Math.ceil(res.retryAfter / 60)} min.`
          : "This sign-in link has expired or was already used. Request a new one.",
    };
  }
  await completeSignIn(res.editor, ip, userAgent, { publicDevice: isPublicDevice(formData), method: "email" });
  return {};
}

export type RecoverySignInState = { error?: string };

/** The one answer for an unknown email, an editor without codes, and a wrong or used code. */
const RECOVERY_FAILED =
  "That email address and recovery code don't match, or the code was already used. Check both and try again.";

/**
 * Sign in with an email address and a recovery code (/sign-in/recovery).
 * Every failure gets the same message (no enumeration). The editor gets the
 * usual new-device/network notice plus a "recovery code used" email.
 */
export async function recoverySignInAction(
  _prev: RecoverySignInState,
  formData: FormData,
): Promise<RecoverySignInState> {
  const { ip, userAgent } = await getRequestMeta();
  const res = await verifyRecoveryCode({
    email: formData.get("email"),
    code: formData.get("code"),
    ip,
    userAgent,
  });
  if (!res.ok) {
    return {
      error:
        res.error === "rate_limited"
          ? `Too many attempts. Try again in ${Math.ceil(res.retryAfter / 60)} min.`
          : RECOVERY_FAILED,
    };
  }
  await completeSignIn(res.editor, ip, userAgent, { publicDevice: isPublicDevice(formData), method: "recovery" });
  return {};
}

/**
 * Options for a passkey sign-in (the button, or autofill on the email field).
 * Null when this client is over its limit: the passkey options just don't
 * appear. The challenge is tied to this browser by a short-lived cookie.
 */
export async function startPasskeySignInAction(): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const { ip } = await getRequestMeta();
  const res = await startPasskeySignIn({ rp: relyingParty(), ip });
  if (!res.ok) return null;
  await setCeremonyToken("authentication", res.token);
  return res.options;
}

export type PasskeySignInState = { error?: string };

/**
 * Finish a passkey sign-in. Every failure gets one calm message; success
 * starts the session through the DAL (method "passkey", which counts as a
 * recent verification) and runs the new-device/network notice.
 */
export async function finishPasskeySignInAction(response: unknown, publicDevice: boolean): Promise<PasskeySignInState> {
  const { ip, userAgent } = await getRequestMeta();
  const res = await finishPasskeySignIn({
    token: await takeCeremonyToken("authentication"),
    response,
    rp: relyingParty(),
    ip,
  });
  if (!res.ok) {
    return {
      error:
        res.error === "rate_limited"
          ? `Too many attempts. Try again in ${Math.ceil(res.retryAfter / 60)} min.`
          : PASSKEY_SIGN_IN_FAILED,
    };
  }
  await completeSignIn(res.editor, ip, userAgent, { publicDevice: publicDevice === true, method: "passkey" });
  return {};
}

/** Start the session, send the new-device/network notice if needed, and go to the dashboard. */
async function completeSignIn(
  editor: Editor,
  ip: string | null,
  userAgent: string | null,
  options: Required<SessionOptions>,
): Promise<never> {
  await startSession(editor.id, options);
  // Security notice if this network is new for the editor. Best effort:
  // the sign-in already succeeded, so a failure here must not undo it.
  try {
    await notifyIfNewSignIn({
      editorId: editor.id,
      email: editor.email,
      penName: editor.penName,
      ip,
      userAgent,
      deviceId: (await deviceIdForSignIn({ publicDevice: options.publicDevice })).id,
    });
  } catch (err) {
    console.error("Couldn't check for a new sign-in location", err);
  }
  redirect(editor.penName ? "/admin?signed-in=1" : "/admin/onboarding");
}
