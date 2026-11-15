import "server-only";
import { appendFile } from "node:fs/promises";
import { Resend } from "resend";
import { env } from "@/env";
import { OTP_TTL_SECONDS } from "./auth/otp-config";
import { EMAIL_LOGO_CID, EMAIL_LOGO_PNG_BASE64 } from "./email-logo";
import { STEP_UP_TTL_SECONDS } from "./auth/step-up-config";
import {
  otpEmail,
  recoveryCodesChangedEmail,
  recoveryCodeUsedEmail,
  signInAlertEmail,
  signInLinkUrl,
  stepUpEmail,
  welcomeEmail,
  type EmailMessage,
  type RecoveryCodesChangedDetails,
  type RecoveryCodeUsedDetails,
  type SignInAlertDetails,
  type WelcomeDetails,
} from "./email-templates";

let resend: Resend | undefined;

/**
 * Send one transactional email through Resend, locally and in production.
 * Codes are never printed. The one exception is the automated E2E server (no
 * key, E2E_OTP_OUTBOX set, never production), which records emails in that
 * file for Playwright instead of sending them.
 */
async function deliver(to: string, message: EmailMessage, testRecord: Record<string, unknown>) {
  const { RESEND_API_KEY, EMAIL_FROM, NODE_ENV } = env();

  if (!RESEND_API_KEY) {
    if (NODE_ENV !== "production" && process.env.E2E_OTP_OUTBOX) {
      await appendFile(process.env.E2E_OTP_OUTBOX, JSON.stringify({ to, ...testRecord }) + "\n");
      return;
    }
    // env() refuses to start without a key, so this is only reachable if that check is bypassed.
    throw new Error("RESEND_API_KEY is not configured");
  }

  resend ??= new Resend(RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: message.headers,
    // The header logo, inline so it shows wherever APP_URL points (see email-logo.ts).
    attachments: [
      { filename: "inkboard.png", content: EMAIL_LOGO_PNG_BASE64, contentType: "image/png", contentId: EMAIL_LOGO_CID },
    ],
  });
  if (error) {
    throw new Error(`Failed to send "${message.subject}" email: ${error.message}`);
  }
  // Outside production, confirm real sends in the terminal (never the code itself).
  if (NODE_ENV !== "production") {
    console.info(`[email] Sent ${String(testRecord.kind ?? "sign-in code")} email to ${to} via Resend (id ${data?.id ?? "?"})`);
  }
}

export async function sendOtpEmail(to: string, code: string, linkToken: string): Promise<void> {
  const { APP_URL } = env();
  const link = signInLinkUrl(APP_URL, linkToken);
  const message = otpEmail({ code, link, appUrl: APP_URL, ttlMinutes: OTP_TTL_SECONDS / 60 });
  await deliver(to, message, { code, link });
}

export async function sendSignInAlertEmail(to: string, details: Omit<SignInAlertDetails, "appUrl">): Promise<void> {
  const message = signInAlertEmail({ ...details, appUrl: env().APP_URL });
  await deliver(
    to,
    message,
    { kind: "sign-in-alert", device: details.device, ip: details.ip, reason: details.reason },
  );
}

export async function sendWelcomeEmail(to: string, details: Omit<WelcomeDetails, "appUrl">): Promise<void> {
  const message = welcomeEmail({ ...details, appUrl: env().APP_URL });
  await deliver(to, message, { kind: "welcome", penName: details.penName, slug: details.slug });
}

export async function sendRecoveryCodeUsedEmail(to: string, details: Omit<RecoveryCodeUsedDetails, "appUrl">): Promise<void> {
  const message = recoveryCodeUsedEmail({ ...details, appUrl: env().APP_URL });
  await deliver(to, message, { kind: "recovery-used", device: details.device, remaining: details.remaining });
}

export async function sendRecoveryCodesChangedEmail(to: string, details: Omit<RecoveryCodesChangedDetails, "appUrl">): Promise<void> {
  const message = recoveryCodesChangedEmail({ ...details, appUrl: env().APP_URL });
  await deliver(to, message, { kind: "recovery-codes-changed", device: details.device, firstSet: details.firstSet });
}

/** The confirmation code for a step-up (src/server/auth/step-up.ts). */
export async function sendStepUpEmail(to: string, code: string): Promise<void> {
  const message = stepUpEmail({ code, appUrl: env().APP_URL, ttlMinutes: STEP_UP_TTL_SECONDS / 60 });
  await deliver(to, message, { kind: "step-up", code });
}
