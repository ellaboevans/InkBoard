import "server-only";
import { appendFile } from "node:fs/promises";
import { Resend } from "resend";
import { env } from "@/env";
import { OTP_TTL_SECONDS } from "./auth/otp-config";
import { EMAIL_LOGO_CID, EMAIL_LOGO_PNG_BASE64 } from "./email-logo";
import { STEP_UP_TTL_SECONDS } from "./auth/step-up-config";
import { PRIVACY_CONTACT_EMAIL } from "@/lib/site";
import { reportReasonLabel } from "@/lib/report";
import type { ReportNotice } from "./reports";
import {
  accountDeletedEmail,
  otpEmail,
  passkeyAddedEmail,
  passkeyRemovedEmail,
  type PasskeyNoticeDetails,
  type AccountDeletedDetails,
  recoveryCodesChangedEmail,
  recoveryCodeUsedEmail,
  reportEmail,
  contentHiddenEmail,
  featuredEmail,
  type FeaturedNoticeDetails,
  contentRestoredEmail,
  type TakedownNoticeDetails,
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
async function deliver(
  to: string,
  message: EmailMessage,
  testRecord: Record<string, unknown>,
  { replyTo }: { replyTo?: string } = {},
) {
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
    ...(replyTo ? { replyTo } : {}),
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

export async function sendPasskeyAddedEmail(
  to: string,
  details: Omit<PasskeyNoticeDetails, "appUrl"> & { afterRecovery: boolean },
): Promise<void> {
  const message = passkeyAddedEmail({ ...details, appUrl: env().APP_URL });
  await deliver(to, message, {
    kind: "passkey-added",
    device: details.device,
    passkeyName: details.passkeyName,
    afterRecovery: details.afterRecovery,
  });
}

export async function sendPasskeyRemovedEmail(to: string, details: Omit<PasskeyNoticeDetails, "appUrl">): Promise<void> {
  const message = passkeyRemovedEmail({ ...details, appUrl: env().APP_URL });
  await deliver(to, message, { kind: "passkey-removed", device: details.device, passkeyName: details.passkeyName });
}

export async function sendAccountDeletedEmail(to: string, details: Omit<AccountDeletedDetails, "appUrl">): Promise<void> {
  const message = accountDeletedEmail({ ...details, appUrl: env().APP_URL });
  await deliver(to, message, { kind: "account-deleted", device: details.device });
}

/**
 * A reader's report (Phase 32) to InkBoard's owner. The reader's address, if
 * they left one, is only the Reply-To: never stored, logged or in the E2E
 * outbox (which records only whether there was one).
 */
export async function sendReportEmail(notice: ReportNotice): Promise<void> {
  const { APP_URL } = env();
  const link = new URL(notice.target.path, APP_URL).href;
  const message = reportEmail({
    kind: notice.target.kind,
    title: notice.target.title,
    penName: notice.target.penName,
    link,
    reason: reportReasonLabel(notice.reason),
    details: notice.details,
    at: notice.at,
    earlier: notice.earlier,
    path: notice.target.path,
    appUrl: APP_URL,
  });
  await deliver(
    PRIVACY_CONTACT_EMAIL,
    message,
    {
      kind: "report",
      targetKind: notice.target.kind,
      title: notice.target.title,
      path: notice.target.path,
      reason: notice.reason,
      details: notice.details,
      earlier: notice.earlier,
      hasReplyTo: notice.replyTo !== null,
    },
    { replyTo: notice.replyTo ?? undefined },
  );
}

/**
 * The writer's notice that InkBoard's owner hid (or restored) a work of theirs
 * or their author page (Phase 32 round 2). Never the report's details.
 */
export async function sendTakedownEmail(
  to: string,
  change: "hidden" | "restored",
  details: Omit<TakedownNoticeDetails, "appUrl" | "contact">,
): Promise<void> {
  const full = { ...details, contact: PRIVACY_CONTACT_EMAIL, appUrl: env().APP_URL };
  const message = change === "hidden" ? contentHiddenEmail(full) : contentRestoredEmail(full);
  await deliver(to, message, { kind: change === "hidden" ? "content-hidden" : "content-restored", what: details.kind, title: details.title });
}

/** The writer's one email when their work is first featured (Phase 33). */
export async function sendFeaturedEmail(to: string, details: Omit<FeaturedNoticeDetails, "appUrl" | "link"> & { path: string }): Promise<void> {
  const { APP_URL } = env();
  const message = featuredEmail({ ...details, link: new URL(details.path, APP_URL).href, appUrl: APP_URL });
  await deliver(to, message, { kind: "featured", what: details.kind, title: details.title, path: details.path });
}
