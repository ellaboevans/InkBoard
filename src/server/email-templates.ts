/**
 * Transactional email content: pure functions (subject, text, HTML, headers)
 * so they can be unit-tested without sending anything.
 *
 * Sign-in code emails are laid out so mail clients' one-time-code detection
 * (Gmail's "Copy code", Apple Mail's AutoFill from Mail, Outlook) can find the
 * code reliably. Those features are heuristic and not under a sender's
 * control, so we give them the clearest possible signals:
 *  - "code" and the code itself in the preview text and the first line (the
 *    subject is the fixed "Your InkBoard One Time Password", by choice),
 *  - the code alone on its own line, bold, as one unbroken run of digits
 *    (spacing is visual only, never spaces between the digits),
 *  - a plain-text part with the same structure,
 *  - no other 4–8 digit numbers in the message (no years, order numbers or
 *    phone numbers) that a detector could pick up instead. The sign-in link's
 *    token is letters only for the same reason (generateLetterToken).
 * The other prerequisite, sender authentication (SPF, DKIM, DMARC on the
 * sending domain), is a deployment step: see docs/DEPLOY.md.
 *
 * Layout: tables and inline styles only (what every client renders), one
 * 520px card on the paper background, the logo as a small PNG from our own
 * domain (SVG is stripped by Gmail and Outlook) with a text wordmark beside
 * it, so the email still reads correctly with images blocked.
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

/* The site's "paper & ink" palette (src/lib/site.ts BRAND), plus two lines. */
const C = {
  paper: "#f5efe6",
  card: "#fdfaf4",
  ink: "#261d17",
  muted: "#61564d",
  faint: "#8a7f74",
  line: "#e6ddcf",
  well: "#f5efe6",
  primary: "#852e2c",
  onPrimary: "#fdfaf3",
};
const SERIF = "Newsreader,Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The sign-in link. The token is in the fragment, so it never reaches server logs or link scanners. */
export function signInLinkUrl(appUrl: string, token: string): string {
  return `${new URL("/sign-in/link", appUrl).href}#${token}`;
}

/** Shared HTML frame: logo header, the card body, and a quiet footer. */
function frame({
  preheader,
  body,
  appUrl,
  footer,
}: {
  preheader: string;
  body: string;
  appUrl: string;
  footer: string;
}) {
  const home = escapeHtml(new URL("/", appUrl).href);
  const logo = escapeHtml(new URL("/email/logo.png", appUrl).href);
  const host = escapeHtml(new URL(appUrl).host);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>InkBoard</title>
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper}">
<tr><td align="center" style="padding:40px 16px 48px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 8px 20px">
<a href="${home}" style="text-decoration:none;color:${C.ink}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle"><img src="${logo}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>
<td style="vertical-align:middle;padding-left:12px;font-family:${SERIF};font-size:22px;line-height:28px;color:${C.ink}">InkBoard</td>
</tr></table>
</a>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${body}
</table>
</td></tr>
<tr><td style="padding:24px 8px 0;font-family:${SANS};font-size:12px;line-height:19px;color:${C.faint}">
${footer}<br>
Sent by <a href="${home}" style="color:${C.faint};text-decoration:underline">${host}</a>. This is an automated message; replies aren't read.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const heading = (text: string) =>
  `<tr><td style="padding:40px 40px 0;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:400;color:${C.ink}">${text}</td></tr>`;
const para = (html: string, { top = 12, size = 16, color = C.ink } = {}) =>
  `<tr><td style="padding:${top}px 40px 0;font-family:${SANS};font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${color}">${html}</td></tr>`;
const button = (href: string, label: string) => `<tr><td style="padding:16px 40px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${C.primary}">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.onPrimary};text-decoration:none;border-radius:10px">${label}</a>
</td></tr></table>
</td></tr>`;
const divider = (top = 32) =>
  `<tr><td style="padding:${top}px 40px 0"><div style="border-top:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</div></td></tr>`;
const bottomSpace = `<tr><td style="padding:0 0 40px;font-size:0;line-height:0">&nbsp;</td></tr>`;

/** The sign-in email: the 6-digit code first (for detectors), then a one-click link. */
export function otpEmail({
  code,
  link,
  appUrl,
  ttlMinutes,
}: {
  code: string;
  link: string;
  appUrl: string;
  ttlMinutes: number;
}): EmailMessage {
  const subject = "Your InkBoard One Time Password";
  const text = [
    "Your InkBoard sign-in code is:",
    "",
    code,
    "",
    "Enter it on the sign-in page, or open this link to sign in:",
    link,
    "",
    `The code and link expire in ${ttlMinutes} minutes and work once. The link signs in whichever device opens it.`,
    "",
    "Didn't try to sign in? Ignore this email. Nobody can get in without it.",
    "",
    "InkBoard",
    new URL("/", appUrl).href,
  ].join("\n");

  const html = frame({
    appUrl,
    preheader: `Your InkBoard sign-in code is ${code}. It expires in ${ttlMinutes} minutes.`,
    footer: "You're receiving this because someone asked to sign in to InkBoard with this address.",
    body: `
${heading("Your sign-in code")}
${para("Your InkBoard sign-in code is:", { top: 14, color: C.muted })}
<tr><td style="padding:16px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="padding:22px 12px;background:${C.well};border-radius:14px">
<p style="margin:0;font-family:${MONO};font-size:38px;line-height:44px;font-weight:700;letter-spacing:10px;color:${C.ink}"><strong>${escapeHtml(code)}</strong></p>
</td></tr></table>
</td></tr>
${para(`Enter it on the sign-in page. It expires in ${ttlMinutes} minutes.`, { top: 14, size: 14, color: C.muted })}
${divider()}
${para("<strong>Or skip the typing.</strong> This button signs you in on the device you open it on.", { top: 24, size: 15 })}
${button(link, "Sign in to InkBoard")}
${para(`Didn't try to sign in? You can ignore this email. Nobody can get in without it.`, { top: 28, size: 13, color: C.faint })}
${bottomSpace}`,
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
  const subject = "New sign-in to your InkBoard account";
  const text = [
    greeting,
    "",
    "Your InkBoard account was just signed in to from a network we haven't seen you use before.",
    "",
    `Device: ${d.device}`,
    `IP address: ${d.ip}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do.",
    "",
    "If it wasn't you:",
    `1. Open your profile and sign that device out under "Signed-in devices": ${profileUrl}`,
    "2. Secure your email account. Signing in to InkBoard needs access to your inbox, so whoever signed in can read your email.",
    "",
    "InkBoard",
  ].join("\n");

  const row = (label: string, value: string, last = false) =>
    `<tr><td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${C.line};`}width:112px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};vertical-align:top">${label}</td><td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${C.line};`}font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${C.ink}">${escapeHtml(value)}</td></tr>`;
  const step = (n: number, html: string) =>
    `<tr><td style="padding:8px 0 0;width:32px;vertical-align:top"><div style="width:22px;height:22px;border-radius:11px;background:${C.well};font-family:${SANS};font-size:12px;line-height:22px;font-weight:700;text-align:center;color:${C.primary}">${n}</div></td><td style="padding:8px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.ink}">${html}</td></tr>`;

  const html = frame({
    appUrl: d.appUrl,
    preheader: `New sign-in from ${d.device}. If this wasn't you, sign that device out.`,
    footer: "We send this whenever your account is signed in to from a new network.",
    body: `
<tr><td style="padding:40px 40px 0"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${C.well};font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:${C.primary}">Security notice</span></td></tr>
<tr><td style="padding:14px 40px 0;font-family:${SERIF};font-size:30px;line-height:36px;color:${C.ink}">New sign-in to your account</td></tr>
${para(`${escapeHtml(greeting)} your InkBoard account was just signed in to from a network we haven't seen you use before.`, { top: 14 })}
<tr><td style="padding:20px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};border-bottom:1px solid ${C.line}">
${row("Device", d.device)}
${row("IP address", d.ip)}
${row("When", when, true)}
</table>
</td></tr>
${para("<strong>Was this you?</strong> Then there's nothing to do.", { top: 24, size: 15 })}
${para("<strong>Wasn't you?</strong>", { top: 16, size: 15 })}
<tr><td style="padding:0 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${step(1, `Sign that device out under <em>Signed-in devices</em> on your profile.`)}
${step(2, "Secure your email account. Signing in to InkBoard needs access to your inbox, so whoever did this can read your email.")}
</table>
</td></tr>
${button(profileUrl, "Review signed-in devices")}
${bottomSpace}`,
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}
