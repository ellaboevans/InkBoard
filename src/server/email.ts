import "server-only";
import { appendFile } from "node:fs/promises";
import { Resend } from "resend";
import { env } from "@/env";
import { OTP_TTL_SECONDS } from "./auth/otp-config";
import { otpEmail, signInAlertEmail, type EmailMessage, type SignInAlertDetails } from "./email-templates";

let resend: Resend | undefined;

/**
 * Send one transactional email. Without RESEND_API_KEY (development only) it is
 * logged instead, and recorded in E2E_OTP_OUTBOX for end-to-end tests.
 */
async function deliver(to: string, message: EmailMessage, devRecord: Record<string, unknown>, devLog: string) {
  const { RESEND_API_KEY, EMAIL_FROM, NODE_ENV } = env();

  if (!RESEND_API_KEY) {
    if (NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not configured");
    }
    // End-to-end tests read emails from this file (never active in production).
    if (process.env.E2E_OTP_OUTBOX) {
      await appendFile(process.env.E2E_OTP_OUTBOX, JSON.stringify({ to, ...devRecord }) + "\n");
    }
    console.info(`\n[dev email] ${devLog}\n`);
    return;
  }

  resend ??= new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: message.headers,
  });
  if (error) {
    throw new Error(`Failed to send "${message.subject}" email: ${error.message}`);
  }
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const message = otpEmail({ code, appUrl: env().APP_URL, ttlMinutes: OTP_TTL_SECONDS / 60 });
  await deliver(to, message, { code }, `Sign-in code for ${to}: ${code}`);
}

export async function sendSignInAlertEmail(to: string, details: Omit<SignInAlertDetails, "appUrl">): Promise<void> {
  const message = signInAlertEmail({ ...details, appUrl: env().APP_URL });
  await deliver(
    to,
    message,
    { kind: "sign-in-alert", device: details.device, ip: details.ip },
    `New sign-in alert for ${to}: ${details.device} from ${details.ip}`,
  );
}
