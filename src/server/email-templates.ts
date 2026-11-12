/**
 * Transactional email content: pure functions (subject, text, HTML, headers)
 * so they can be unit-tested without sending anything.
 *
 * Sign-in code emails are laid out so mail clients' one-time-code detection
 * (Gmail's "Copy code", Apple Mail's AutoFill from Mail, Outlook) can find the
 * code reliably. Those features are heuristic and not under a sender's
 * control, so we give them the clearest possible signals:
 *  - "code" and the code itself in the subject and in the first line,
 *  - the code alone on its own line, bold, as one unbroken run of digits
 *    (spacing is visual only, never spaces between the digits),
 *  - a plain-text part with the same structure,
 *  - no other 4–8 digit numbers in the message (no years, order numbers or
 *    phone numbers) that a detector could pick up instead.
 * The other prerequisite, sender authentication (SPF, DKIM, DMARC on the
 * sending domain), is a deployment step: see docs/DEPLOY.md.
 */

export type EmailMessage = {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

/** Machine-generated mail: tell auto-responders (incl. Exchange/Outlook) not to reply. */
const AUTOMATED_HEADERS = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
};

const INK = "#2b2622";
const MUTED = "#6b625a";
const PAPER = "#fbf8f2";
const CARD = "#fffdf9";
const BORDER = "#e7dfd3";
const ACCENT = "#8a2b2b";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Shared HTML frame: table layout and inline styles, which every mail client renders. */
function frame({ preheader, body, appUrl }: { preheader: string; body: string; appUrl: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${CARD};border:1px solid ${BORDER};border-radius:16px">
<tr><td style="padding:32px 32px 8px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:${INK}">PoemHub</td></tr>
${body}
<tr><td style="padding:24px 32px 32px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${MUTED}">
This is an automated message from <a href="${escapeHtml(appUrl)}" style="color:${MUTED}">PoemHub</a>. Please don't reply.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const sans = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/** The sign-in code email. `code` is the 6-digit OTP. */
export function otpEmail({ code, appUrl, ttlMinutes }: { code: string; appUrl: string; ttlMinutes: number }): EmailMessage {
  const subject = `${code} is your PoemHub sign-in code`;
  const text = [
    "Your PoemHub sign-in code is:",
    "",
    code,
    "",
    `It expires in ${ttlMinutes} minutes and can only be used once.`,
    "If you didn't try to sign in, you can ignore this email. Nobody can sign in without this code.",
    "",
    "PoemHub",
    appUrl,
  ].join("\n");
  const html = frame({
    appUrl,
    preheader: `Your PoemHub sign-in code is ${code}. It expires in ${ttlMinutes} minutes.`,
    body: `
<tr><td style="padding:8px 32px 0;font-family:${sans};font-size:16px;line-height:24px;color:${INK}">Your PoemHub sign-in code is:</td></tr>
<tr><td style="padding:16px 32px">
<p style="margin:0;padding:16px 0;text-align:center;background:${PAPER};border:1px solid ${BORDER};border-radius:12px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:8px;color:${INK}"><strong>${escapeHtml(code)}</strong></p>
</td></tr>
<tr><td style="padding:0 32px;font-family:${sans};font-size:14px;line-height:22px;color:${MUTED}">
It expires in ${ttlMinutes} minutes and can only be used once.<br>
If you didn't try to sign in, you can ignore this email. Nobody can sign in without this code.
</td></tr>`,
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

export type SignInAlertDetails = {
  penName: string | null;
  /** Human device label, e.g. "Chrome on macOS" (see describeUserAgent). */
  device: string;
  ip: string;
  at: Date;
  appUrl: string;
};

/** e.g. "Thu, 12 Nov 2026 at 21:49 UTC" (spelled-out date, no bare 4-digit year next to a code). */
export function formatAlertTime(at: Date): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(at);
  return `${date} at ${time} UTC`;
}

/**
 * "Someone signed in from a new network" security notice. It deliberately
 * never says "code": with a date in the body, a client's code detector could
 * otherwise offer to "copy" the year as if it were a sign-in code.
 */
export function signInAlertEmail(d: SignInAlertDetails): EmailMessage {
  const profileUrl = new URL("/admin/profile", d.appUrl).href;
  const when = formatAlertTime(d.at);
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const subject = "New sign-in to your PoemHub account";
  const text = [
    greeting,
    "",
    "Your PoemHub account was just signed in to from a network we haven't seen you use before.",
    "",
    `Device: ${d.device}`,
    `IP address: ${d.ip}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do.",
    "",
    "If it wasn't you:",
    `1. Open your profile and sign that device out under "Signed-in devices": ${profileUrl}`,
    "2. Secure your email account. Signing in to PoemHub needs access to your inbox, so whoever signed in can read your email.",
    "",
    "PoemHub",
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;width:110px;font-family:${sans};font-size:14px;color:${MUTED};vertical-align:top">${label}</td><td style="padding:6px 0;font-family:${sans};font-size:14px;color:${INK}">${escapeHtml(value)}</td></tr>`;
  const html = frame({
    appUrl: d.appUrl,
    preheader: `New sign-in from ${d.device}. If this wasn't you, sign that device out.`,
    body: `
<tr><td style="padding:8px 32px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:32px;color:${INK}">New sign-in to your account</td></tr>
<tr><td style="padding:12px 32px 0;font-family:${sans};font-size:15px;line-height:23px;color:${INK}">
${escapeHtml(greeting)}<br>Your PoemHub account was just signed in to from a network we haven't seen you use before.
</td></tr>
<tr><td style="padding:16px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};border:1px solid ${BORDER};border-radius:12px;padding:10px 16px">
${row("Device", d.device)}
${row("IP address", d.ip)}
${row("When", when)}
</table>
</td></tr>
<tr><td style="padding:0 32px;font-family:${sans};font-size:14px;line-height:22px;color:${INK}">
<strong>If this was you</strong>, there's nothing to do.<br><br>
<strong>If it wasn't you</strong>, sign that device out under "Signed-in devices" on your profile, then secure your email account: signing in to PoemHub needs access to your inbox.
</td></tr>
<tr><td style="padding:20px 32px 0">
<a href="${escapeHtml(profileUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${ACCENT};color:#ffffff;font-family:${sans};font-size:14px;font-weight:600;text-decoration:none">Review signed-in devices</a>
</td></tr>`,
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}
