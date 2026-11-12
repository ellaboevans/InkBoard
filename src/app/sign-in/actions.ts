"use server";

import { redirect } from "next/navigation";
import { getRequestMeta, startSession } from "@/server/auth/dal";
import { requestOtp, verifyOtp } from "@/server/auth/otp";
import { notifyIfNewSignIn } from "@/server/auth/sign-in-alerts";

export type SignInState =
  | { step: "email"; email?: string; error?: string }
  | {
      step: "code";
      email: string;
      /** Epoch ms after which "resend" is allowed. */
      resendAt: number;
      error?: string;
      notice?: string;
    };

const waitMessage = (s: number) =>
  `Please wait ${s} second${s === 1 ? "" : "s"} before requesting another code.`;

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

  if (intent === "change-email") {
    return { step: "email", email: prev.email };
  }

  if (intent === "request" || intent === "resend") {
    const email = formData.get("email");
    const res = await requestOtp({ email, ip });
    if (!res.ok) {
      if (res.error === "invalid_email") {
        return {
          step: "email",
          email: String(email ?? ""),
          error: "Enter a valid email address.",
        };
      }
      const retryAt = Date.now() + res.retryAfter * 1000;
      return prev.step === "code"
        ? { ...prev, resendAt: retryAt, error: waitMessage(res.retryAfter) }
        : {
            step: "email",
            email: String(email ?? ""),
            error: waitMessage(res.retryAfter),
          };
    }
    return {
      step: "code",
      email: res.email,
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
              ? `That code is incorrect. ${res.attemptsLeft} attempt${res.attemptsLeft === 1 ? "" : "s"} left.`
              : "That code is invalid or has expired.";
      return { ...prev, error, notice: undefined };
    }
    await startSession(res.editor.id);
    // Security notice if this network is new for the editor. Best effort:
    // the sign-in already succeeded, so a failure here must not undo it.
    try {
      await notifyIfNewSignIn({
        editorId: res.editor.id,
        email: res.editor.email,
        penName: res.editor.penName,
        ip,
        userAgent,
      });
    } catch (err) {
      console.error("Couldn't check for a new sign-in location", err);
    }
    redirect(res.editor.penName ? "/admin?signed-in=1" : "/admin/onboarding");
  }

  return { step: "email" };
}
