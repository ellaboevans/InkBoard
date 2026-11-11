import "server-only";
import { appendFile } from "node:fs/promises";
import { Resend } from "resend";
import { env } from "@/env";

let resend: Resend | undefined;

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, APP_URL, NODE_ENV } = env();

  if (!RESEND_API_KEY) {
    if (NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not configured");
    }
    // End-to-end tests read codes from this file (never active in production).
    if (process.env.E2E_OTP_OUTBOX) {
      await appendFile(
        process.env.E2E_OTP_OUTBOX,
        JSON.stringify({ to, code }) + "\n",
      );
    }
    console.info(`\n[dev email] Sign-in code for ${to}: ${code}\n`);
    return;
  }

  resend ??= new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `${code} is your PoemHub sign-in code`,
    text: [
      `Your PoemHub sign-in code is: ${code}`,
      "",
      "It expires in 10 minutes and can only be used once.",
      "If you didn't request it, you can ignore this email.",
      "",
      APP_URL,
    ].join("\n"),
    html: `
      <div style="font-family:Georgia,serif;max-width:420px;margin:auto;padding:24px;color:#2b2622">
        <h1 style="font-size:20px;font-weight:normal">Your PoemHub sign-in code</h1>
        <p style="font-size:32px;letter-spacing:8px;font-family:ui-monospace,monospace;margin:24px 0">${code}</p>
        <p style="font-size:14px;color:#6b625a">It expires in 10 minutes and can only be used once.
        If you didn't request it, you can safely ignore this email.</p>
      </div>`,
  });
  if (error) {
    throw new Error(`Failed to send sign-in email: ${error.message}`);
  }
}
