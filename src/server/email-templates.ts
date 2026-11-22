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
 * 520px card on the paper background, the logo as a small inline PNG
 * attachment (cid:, see email-logo.ts; SVG and data: URIs are stripped by
 * Gmail and Outlook) with a text wordmark beside it, so the email still reads
 * correctly with images blocked.
 */

import { EMAIL_LOGO_CID } from "./email-logo";
import { pluralCount } from "@/lib/plural";

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
  automated = true,
  wordmark = { size: 22, lineHeight: 28 },
}: {
  preheader: string;
  body: string;
  appUrl: string;
  footer: string;
  /** False for a personal note (the welcome), which doesn't say replies go unread. */
  automated?: boolean;
  /** "InkBoard" beside the logo. */
  wordmark?: { size: number; lineHeight: number };
}) {
  const home = escapeHtml(new URL("/", appUrl).href);
  const logo = `cid:${EMAIL_LOGO_CID}`;
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
<td style="vertical-align:middle;padding-left:12px;font-family:${SERIF};font-size:${wordmark.size}px;line-height:${wordmark.lineHeight}px;color:${C.ink}">InkBoard</td>
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
Sent by <a href="${home}" style="color:${C.faint};text-decoration:underline">${host}</a>.${automated ? " This is an automated message; replies aren't read." : ""}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const heading = (text: string, { size = 30, lineHeight = 36 } = {}) =>
  `<tr><td style="padding:40px 40px 0;font-family:${SERIF};font-size:${size}px;line-height:${lineHeight}px;font-weight:400;color:${C.ink}">${text}</td></tr>`;
const para = (html: string, { top = 12, size = 16, color = C.ink, lineHeight = Math.round(size * 1.55) } = {}) =>
  `<tr><td style="padding:${top}px 40px 0;font-family:${SANS};font-size:${size}px;line-height:${lineHeight}px;color:${color}">${html}</td></tr>`;
const button = (href: string, label: string, { size = 15 } = {}) => `<tr><td style="padding:16px 40px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${C.primary}">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:${size}px;line-height:20px;font-weight:600;color:${C.onPrimary};text-decoration:none;border-radius:10px">${label}</a>
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
    `The code and link expire in ${pluralCount(ttlMinutes, "minute")} and work once. The link signs in whichever device opens it.`,
    "",
    "Didn't try to sign in? Ignore this email. Nobody can get in without it.",
    "",
    "InkBoard",
    new URL("/", appUrl).href,
  ].join("\n");

  const html = frame({
    appUrl,
    preheader: `Your InkBoard sign-in code is ${code}. It expires in ${pluralCount(ttlMinutes, "minute")}.`,
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
${para(`Enter it on the sign-in page. It expires in ${pluralCount(ttlMinutes, "minute")}.`, { top: 14, size: 14, color: C.muted })}
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
  /** What was new: the browser, the network, or both. */
  reason: "device" | "network" | "both";
};

const ALERT_WHAT = {
  device: "a device",
  network: "a network",
  both: "a device and network",
} as const;

/** e.g. "Thu, 12 Nov 2026 at 21:49 UTC" (spelled-out date, no bare 4-digit year next to a code). */
export function formatAlertTime(at: Date): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(at);
  return `${date} at ${time} UTC`;
}

/**
 * "Someone signed in from a new device or network" security notice. It deliberately
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
    `Your InkBoard account was just signed in to from ${ALERT_WHAT[d.reason]} we haven't seen you use before.`,
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
    footer: "We send this whenever your account is signed in to from a new device or network.",
    body: `
<tr><td style="padding:40px 40px 0"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${C.well};font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:${C.primary}">Security notice</span></td></tr>
<tr><td style="padding:14px 40px 0;font-family:${SERIF};font-size:30px;line-height:36px;color:${C.ink}">New sign-in to your account</td></tr>
${para(`${escapeHtml(greeting)} your InkBoard account was just signed in to from ${ALERT_WHAT[d.reason]} we haven't seen you use before.`, { top: 14 })}
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

export type WelcomeDetails = {
  penName: string;
  /** The editor's public author page slug (/a/<slug>). */
  slug: string;
  appUrl: string;
};

/** Who signs the welcome email. */
export const WELCOME_SIGNATURE = { name: "Evans Elabo", role: "Creator, InkBoard" };

/**
 * Sent once, when a newcomer finishes onboarding (their first sign-in). A
 * personal note from the founder: what InkBoard is for and what they can do.
 * Like the sign-in alert, it never says "code" and has no 4–8 digit numbers.
 */
export function welcomeEmail(d: WelcomeDetails): EmailMessage {
  const newPoemUrl = new URL("/admin/poems/new", d.appUrl).href;
  const authorUrl = new URL(`/a/${encodeURIComponent(d.slug)}`, d.appUrl).href;
  const profileUrl = new URL("/admin/profile", d.appUrl).href;
  const boardUrl = new URL("/", d.appUrl).href;
  const subject = `Welcome to InkBoard, ${d.penName}`;

  const features: [string, string, string][] = [
    ["Write and publish", "Draft as long as you like, preview the card readers will see, and publish to the board when it's ready.", "Line breaks and indentation stay exactly as you type them, with *italic* and **bold** for emphasis."],
    ["Keep some poems private", "Lock any poem with a password, one per poem or one for all of them, and share it only with the readers you choose.", "Everyone else sees the title and a lock."],
    ["Your author page", "Your poems gather in your own section of the board and on your author page.", "Pick an avatar, add a short bio and links, and pin the poem you want readers to meet first."],
    ["Share anywhere", "Every published poem has its own link with a share card, so it looks right when you post it.", ""],
  ];

  const text = [
    `Hi ${d.penName},`,
    "",
    "Welcome to InkBoard. I'm glad you're here.",
    "",
    "InkBoard is a quiet, open board of poems, grouped by author, that anyone can wander through. Here's what you can do:",
    "",
    ...features.flatMap(([title, a, b]) => [`- ${title}: ${a}${b ? ` ${b}` : ""}`]),
    "",
    `Write your first poem: ${newPoemUrl}`,
    `Your author page: ${authorUrl}`,
    `Set up your profile: ${profileUrl}`,
    "",
    "If anything feels off, or you have an idea that would make InkBoard better for you, I'd love to hear it.",
    "",
    "Happy writing,",
    WELCOME_SIGNATURE.name,
    WELCOME_SIGNATURE.role,
    "",
    boardUrl,
  ].join("\n");

  const feature = ([title, a, b]: [string, string, string]) =>
    `<tr><td style="padding:18px 0 0;width:28px;vertical-align:top"><div style="width:8px;height:8px;margin-top:8px;border-radius:4px;background:${C.primary}"></div></td><td style="padding:18px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.ink}"><strong style="font-family:${SERIF};font-size:16px;line-height:24px;font-weight:600">${escapeHtml(title)}</strong><br><span style="color:${C.muted}">${escapeHtml(a)}${b ? ` ${escapeHtml(b)}` : ""}</span></td></tr>`;
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="color:${C.primary};text-decoration:underline">${label}</a>`;

  const html = frame({
    appUrl: d.appUrl,
    automated: false,
    wordmark: { size: 20, lineHeight: 26 },
    preheader: "What you can do on InkBoard, and where to start.",
    footer: "You're receiving this because you just created your InkBoard account. It's the only welcome note we send.",
    body: `
${heading(`Welcome, ${escapeHtml(d.penName)}`, { size: 26, lineHeight: 32 })}
${para("I'm glad you're here. InkBoard is a quiet, open board of poems, grouped by author, that anyone can wander through. Here's what you can do:", { top: 14, size: 15, lineHeight: 24 })}
<tr><td style="padding:4px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${features.map(feature).join("\n")}
</table>
</td></tr>
${button(newPoemUrl, "Write your first poem", { size: 14 })}
${para(`Or ${link(profileUrl, "set up your profile")} first, and see ${link(authorUrl, "your author page")}.`, { top: 14, size: 13, lineHeight: 21, color: C.muted })}
${divider()}
${para("If anything feels off, or you have an idea that would make InkBoard better for you, I'd love to hear it.", { top: 24, size: 15, lineHeight: 24 })}
${para("Happy writing,", { top: 20, size: 15, lineHeight: 24 })}
<tr><td style="padding:6px 40px 0;font-family:${SERIF};font-size:15px;line-height:22px;font-weight:600;color:${C.muted}">${escapeHtml(WELCOME_SIGNATURE.name)}</td></tr>
${para(escapeHtml(WELCOME_SIGNATURE.role), { top: 2, size: 13, color: C.muted })}
${bottomSpace}`,
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

/**
 * e.g. "Sun 15 Nov, 21:49 UTC": no year, so the message has no 4-digit number
 * at all. Recovery emails can't avoid the word "code" ("recovery code"), so
 * they must never contain anything a code detector could offer to copy.
 */
export function formatNoticeTime(at: Date): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(at);
  return `${date}, ${time} UTC`;
}

/** Shared look of the recovery notices: badge, heading, intro, detail rows, steps, button. */
function securityNotice(d: {
  appUrl: string;
  preheader: string;
  footer: string;
  heading: string;
  intro: string;
  rows: [string, string][];
  steps: string[];
  closing: string;
  button: [string, string];
}): string {
  const row = (label: string, value: string, last: boolean) =>
    `<tr><td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${C.line};`}width:112px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};vertical-align:top">${label}</td><td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${C.line};`}font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${C.ink}">${escapeHtml(value)}</td></tr>`;
  const step = (n: number, html: string) =>
    `<tr><td style="padding:8px 0 0;width:32px;vertical-align:top"><div style="width:22px;height:22px;border-radius:11px;background:${C.well};font-family:${SANS};font-size:12px;line-height:22px;font-weight:700;text-align:center;color:${C.primary}">${n}</div></td><td style="padding:8px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.ink}">${html}</td></tr>`;
  return frame({
    appUrl: d.appUrl,
    preheader: d.preheader,
    footer: d.footer,
    body: `
<tr><td style="padding:40px 40px 0"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${C.well};font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:${C.primary}">Security notice</span></td></tr>
<tr><td style="padding:14px 40px 0;font-family:${SERIF};font-size:30px;line-height:36px;color:${C.ink}">${d.heading}</td></tr>
${para(d.intro, { top: 14 })}
<tr><td style="padding:20px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};border-bottom:1px solid ${C.line}">
${d.rows.map(([label, value], i) => row(label, value, i === d.rows.length - 1)).join("\n")}
</table>
</td></tr>
${para("<strong>Was this you?</strong> Then there's nothing to do.", { top: 24, size: 15 })}
${para("<strong>Wasn't you?</strong>", { top: 16, size: 15 })}
<tr><td style="padding:0 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${d.steps.map((s, i) => step(i + 1, s)).join("\n")}
</table>
</td></tr>
${para(d.closing, { top: 16, size: 13, color: C.muted })}
${button(d.button[0], d.button[1])}
${bottomSpace}`,
  });
}

export type RecoveryCodeUsedDetails = {
  penName: string | null;
  /** Human device label (describeUserAgent). */
  device: string;
  at: Date;
  /** Unused codes left after this one. */
  remaining: number;
  appUrl: string;
};

const leftPhrase = (n: number) => (n === 0 ? "none left" : `${n} left`);

/**
 * "A recovery code was used to sign in · N left". Says "code" (it has to), so
 * it carries no 4–8 digit numbers: no year, no IP address (an IPv6 group can
 * be four digits), and never the code itself. Tested.
 */
export function recoveryCodeUsedEmail(d: RecoveryCodeUsedDetails): EmailMessage {
  const profileUrl = new URL("/admin/profile", d.appUrl).href;
  const when = formatNoticeTime(d.at);
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const subject = `A recovery code was used to sign in · ${leftPhrase(d.remaining)}`;
  const left =
    d.remaining === 0
      ? "That was your last one: make a new set from your profile so you still have a way in without email."
      : `You have ${pluralCount(d.remaining, "unused recovery code")} left.`;
  const steps = [
    `Sign that device out under "Signed-in devices" on your profile.`,
    "Make a new set of recovery codes there. That cancels every old one, including any someone else has.",
    "Check where you kept your codes, and keep the new ones somewhere only you can reach.",
  ];
  const text = [
    greeting,
    "",
    "Someone just signed in to your InkBoard account with one of your recovery codes. That code can't be used again.",
    left,
    "",
    `Device: ${d.device}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do.",
    "",
    "If it wasn't you:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Your profile: ${profileUrl}`,
    "",
    "InkBoard",
  ].join("\n");
  const html = securityNotice({
    appUrl: d.appUrl,
    preheader: `Signed in from ${d.device}. ${left}`,
    footer: "We send this every time a recovery code is used on your account.",
    heading: "A recovery code was used",
    intro: `${escapeHtml(greeting)} someone just signed in to your InkBoard account with one of your recovery codes. That code can't be used again. ${escapeHtml(left)}`,
    rows: [
      ["Device", d.device],
      ["When", when],
    ],
    steps: steps.map((s) => escapeHtml(s).replace("&#34;Signed-in devices&#34;", "<em>Signed-in devices</em>")),
    closing: "Someone signing in with a recovery code didn't need your email, so your inbox is safe.",
    button: [profileUrl, "Review your account"],
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

export type RecoveryCodesChangedDetails = {
  penName: string | null;
  device: string;
  at: Date;
  /** True when the editor had no codes before (set up, not replaced). */
  firstSet: boolean;
  appUrl: string;
};

/**
 * Sent when an editor makes a set of recovery codes (first or replacement).
 * Never contains the codes; same digit rule as recoveryCodeUsedEmail.
 */
export function recoveryCodesChangedEmail(d: RecoveryCodesChangedDetails): EmailMessage {
  const profileUrl = new URL("/admin/profile", d.appUrl).href;
  const when = formatNoticeTime(d.at);
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const subject = d.firstSet
    ? "Recovery codes were set up for your InkBoard account"
    : "Your InkBoard recovery codes were replaced";
  const what = d.firstSet
    ? "A set of recovery codes was just made for your InkBoard account. Each one signs in once, without email."
    : "A new set of recovery codes was just made for your InkBoard account. The old codes no longer work.";
  const steps = [
    `Sign that device out under "Signed-in devices" on your profile.`,
    "Make another new set yourself, which cancels the set that was just made.",
    "Secure your email account: making codes needs a recent sign-in or a confirmation sent to your inbox.",
  ];
  const text = [
    greeting,
    "",
    what,
    "",
    `Device: ${d.device}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do. Keep the new codes somewhere safe.",
    "",
    "If it wasn't you:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Your profile: ${profileUrl}`,
    "",
    "InkBoard",
  ].join("\n");
  const html = securityNotice({
    appUrl: d.appUrl,
    preheader: d.firstSet ? `Recovery codes set up from ${d.device}.` : `New recovery codes made from ${d.device}. The old ones no longer work.`,
    footer: "We send this whenever recovery codes are made for your account.",
    heading: d.firstSet ? "Recovery codes set up" : "Recovery codes replaced",
    intro: `${escapeHtml(greeting)} ${escapeHtml(what)}`,
    rows: [
      ["Device", d.device],
      ["When", when],
    ],
    steps: steps.map((s) => escapeHtml(s).replace("&#34;Signed-in devices&#34;", "<em>Signed-in devices</em>")),
    closing: "We never send the codes themselves by email.",
    button: [profileUrl, "Review your account"],
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

/**
 * The step-up email: a 6-digit code that confirms a signed-in editor before a
 * sensitive change. Same layout rules as otpEmail (code first, alone on its
 * line, no other 4–8 digit numbers) but no sign-in link: it signs nobody in.
 */
export function stepUpEmail({ code, appUrl, ttlMinutes }: { code: string; appUrl: string; ttlMinutes: number }): EmailMessage {
  const subject = "Confirm it's you on InkBoard";
  const text = [
    "Your InkBoard confirmation code is:",
    "",
    code,
    "",
    "Enter it on your profile page to make new recovery codes.",
    `It expires in ${pluralCount(ttlMinutes, "minute")} and works once, only in the browser that asked for it.`,
    "",
    "Didn't ask for this? Someone may be signed in to your account: sign out your other devices from your profile.",
    "",
    "InkBoard",
    new URL("/", appUrl).href,
  ].join("\n");
  const html = frame({
    appUrl,
    preheader: `Your InkBoard confirmation code is ${code}. It expires in ${pluralCount(ttlMinutes, "minute")}.`,
    footer: "You're receiving this because someone signed in to your InkBoard account asked to confirm it's you.",
    body: `
${heading("Confirm it's you")}
${para("Your InkBoard confirmation code is:", { top: 14, color: C.muted })}
<tr><td style="padding:16px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="padding:22px 12px;background:${C.well};border-radius:14px">
<p style="margin:0;font-family:${MONO};font-size:38px;line-height:44px;font-weight:700;letter-spacing:10px;color:${C.ink}"><strong>${escapeHtml(code)}</strong></p>
</td></tr></table>
</td></tr>
${para(`Enter it on your profile page to make new recovery codes. It expires in ${pluralCount(ttlMinutes, "minute")} and works only in the browser that asked for it.`, { top: 14, size: 14, color: C.muted })}
${para("Didn't ask for this? Someone may be signed in to your account: sign out your other devices from your profile.", { top: 28, size: 13, color: C.faint })}
${bottomSpace}`,
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

export type PasskeyNoticeDetails = {
  penName: string | null;
  /** The passkey's name (editor-chosen). Shown only if it has no 4+ digit run (see passkeyLabel). */
  passkeyName: string;
  /** Device that made the change (describeUserAgent). */
  device: string;
  at: Date;
  appUrl: string;
};

/**
 * A passkey's name as the notices show it. Names are typed by the editor and
 * may hold a year or a model number ("MacBook 2024"); the notices must have no
 * 4–8 digit numbers at all, so such a name is left out rather than altered.
 */
export function passkeyLabel(name: string): string | null {
  return /\d{4}/.test(name) ? null : name;
}

/**
 * "A passkey was added to your account". Same digit rule as the recovery
 * notices: no year, no IP address. `afterRecovery`: it was added under the
 * recovery-code exception (no email check), which deserves its own warning.
 */
export function passkeyAddedEmail(d: PasskeyNoticeDetails & { afterRecovery: boolean }): EmailMessage {
  const profileUrl = new URL("/admin/profile", d.appUrl).href;
  const when = formatNoticeTime(d.at);
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const label = passkeyLabel(d.passkeyName);
  const subject = "A passkey was added to your InkBoard account";
  const what = `A new passkey${label ? ` (“${label}”)` : ""} was just added to your InkBoard account. It can sign in without your email.`;
  const why = d.afterRecovery
    ? "It was added right after a recovery code was used to sign in, so if that wasn't you, someone may have one of your recovery codes."
    : null;
  const steps = [
    `Remove that passkey under "Passkeys" on your profile.`,
    `Sign out any device you don't recognise under "Signed-in devices".`,
    "Make a new set of recovery codes there, which cancels every old one.",
  ];
  const text = [
    greeting,
    "",
    what,
    ...(why ? [why] : []),
    "",
    `Device: ${d.device}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do.",
    "",
    "If it wasn't you:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Your profile: ${profileUrl}`,
    "",
    "InkBoard",
  ].join("\n");
  const html = securityNotice({
    appUrl: d.appUrl,
    preheader: `Passkey added from ${d.device}. If this wasn't you, remove it from your profile.`,
    footer: "We send this whenever a passkey is added to your account.",
    heading: "A passkey was added",
    intro: `${escapeHtml(greeting)} ${escapeHtml(what)}${why ? ` <strong>${escapeHtml(why)}</strong>` : ""}`,
    rows: [
      ["Device", d.device],
      ["When", when],
    ],
    steps: steps.map(emphasiseQuoted),
    closing: "A passkey only works on the devices or password manager that hold it.",
    button: [profileUrl, "Review your passkeys"],
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

/** "A passkey was removed from your account". Same rules as passkeyAddedEmail. */
export function passkeyRemovedEmail(d: PasskeyNoticeDetails): EmailMessage {
  const profileUrl = new URL("/admin/profile", d.appUrl).href;
  const when = formatNoticeTime(d.at);
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const label = passkeyLabel(d.passkeyName);
  const subject = "A passkey was removed from your InkBoard account";
  const what = `A passkey${label ? ` (“${label}”)` : ""} was just removed from your InkBoard account. It can no longer sign in.`;
  const steps = [
    `Sign out any device you don't recognise under "Signed-in devices" on your profile.`,
    "Secure your email account: removing a passkey needs a recent sign-in or a confirmation.",
    "Add your passkey again from your profile if you still want it.",
  ];
  const text = [
    greeting,
    "",
    what,
    "",
    `Device: ${d.device}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do.",
    "",
    "If it wasn't you:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Your profile: ${profileUrl}`,
    "",
    "InkBoard",
  ].join("\n");
  const html = securityNotice({
    appUrl: d.appUrl,
    preheader: `Passkey removed from ${d.device}.`,
    footer: "We send this whenever a passkey is removed from your account.",
    heading: "A passkey was removed",
    intro: `${escapeHtml(greeting)} ${escapeHtml(what)}`,
    rows: [
      ["Device", d.device],
      ["When", when],
    ],
    steps: steps.map(emphasiseQuoted),
    closing: "Your other passkeys, recovery codes and email sign-in are unchanged.",
    button: [profileUrl, "Review your account"],
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

/** Escape a step and show its "quoted" section names in italics. */
function emphasiseQuoted(step: string): string {
  return escapeHtml(step).replace(/&#34;([^&]+)&#34;/g, "<em>$1</em>");
}

export type AccountDeletedDetails = {
  penName: string | null;
  /** Device that deleted it (describeUserAgent). */
  device: string;
  at: Date;
  appUrl: string;
};

/**
 * "Your InkBoard account was deleted" (Phase 17), sent to the address the
 * account had. Same digit rule as the other notices (no year, no IP).
 */
export function accountDeletedEmail(d: AccountDeletedDetails): EmailMessage {
  const when = formatNoticeTime(d.at);
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const subject = "Your InkBoard account was deleted";
  const what =
    "Your InkBoard account was just deleted, with all its poems, collections and saved versions. Your author page and poem links no longer work.";
  const steps = [
    "Secure your email account and the devices that hold your passkeys: deleting an account needs a recent sign-in with one of them.",
    "We can't bring the poems back. If you downloaded a copy, you can sign up again with this address and add them to a new account.",
  ];
  const text = [
    greeting,
    "",
    what,
    "",
    `Device: ${d.device}`,
    `When: ${when}`,
    "",
    "If this was you, there's nothing to do. Thank you for writing on InkBoard.",
    "",
    "If it wasn't you:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "InkBoard",
  ].join("\n");
  const html = securityNotice({
    appUrl: d.appUrl,
    preheader: `Deleted from ${d.device}. If this wasn't you, secure your email account.`,
    footer: "This is the last message we send to this address about this account.",
    heading: "Your account was deleted",
    intro: `${escapeHtml(greeting)} ${escapeHtml(what)}`,
    rows: [
      ["Device", d.device],
      ["When", when],
    ],
    steps: steps.map((s) => escapeHtml(s)),
    closing: "Thank you for writing on InkBoard.",
    button: [new URL("/", d.appUrl).href, "Visit the board"],
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

export type ReportEmailDetails = {
  kind: "poem" | "novel" | "chapter" | "author";
  /** The work's title (a chapter: "Novel, Chapter n"), or the pen name for an author. */
  title: string;
  penName: string;
  /** Absolute link to the page. */
  link: string;
  /** The reason's label (src/lib/report.ts). */
  reason: string;
  /** The reader's words, as written: escaped here, never trusted. */
  details: string | null;
  at: Date;
  /** Earlier reports of the same page still kept. */
  earlier: number;
  /** The page's path ("/p/ama/dusk"), for the owner's hide command (Phase 32 round 2). */
  path: string;
  appUrl: string;
};

/** The owner's command to hide a reported page (scripts/content-takedown.ts). */
export const hideCommand = (path: string) => `pnpm content:hide ${path}`;

/** The owner's page (Phase 32 round 3), where a report is reviewed: absolute, from the app's URL. */
export const ownerPageUrl = (appUrl: string) => new URL("/admin/owner", appUrl).href;

const REPORT_KIND_LABEL = { poem: "Poem", novel: "Novel", chapter: "Chapter", author: "Author" } as const;

/**
 * "Report: …" (Phase 32), to InkBoard's owner. Names the page, never its text.
 * The reader's reply address, if any, is the message's Reply-To (set by the
 * sender), so it isn't repeated in the body.
 */
export function reportEmail(d: ReportEmailDetails): EmailMessage {
  const kind = REPORT_KIND_LABEL[d.kind];
  const what = d.kind === "author" ? d.penName : `“${d.title}” by ${d.penName}`;
  // One line, whatever the reader typed into the title fields (they can't, but a title can hold anything).
  const subject = `Report: ${kind.toLowerCase()} ${what}`.replace(/\s+/g, " ").slice(0, 180);
  const earlier =
    d.earlier === 0 ? "None" : `${pluralCount(d.earlier, "earlier report")} of this page`;
  const when = formatNoticeTime(d.at);
  const rows: [string, string][] = [
    ["What", `${kind}: ${d.kind === "author" ? d.penName : d.title}`],
    ...(d.kind === "author" ? [] : ([["By", d.penName]] as [string, string][])),
    ["Reason", d.reason],
    ["When", when],
    ["Earlier", earlier],
  ];
  const text = [
    `A reader reported a page on InkBoard.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    `Link: ${d.link}`,
    "",
    "Details:",
    d.details ?? "(none given)",
    "",
    "Reply to this email to answer the reader, if they left an address.",
    "",
    `Review it on InkBoard: ${ownerPageUrl(d.appUrl)}`,
    "",
    "To hide this page from readers:",
    hideCommand(d.path),
  ].join("\n");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid ${C.line};width:96px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};vertical-align:top">${label}</td><td style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${C.ink}">${escapeHtml(value)}</td></tr>`;
  const detailsHtml = d.details
    ? `<div style="white-space:pre-wrap;padding:14px 16px;border-radius:12px;background:${C.well};font-family:${SANS};font-size:14px;line-height:22px;color:${C.ink}">${escapeHtml(d.details)}</div>`
    : `<span style="color:${C.muted}">None given.</span>`;
  const html = frame({
    appUrl: d.appUrl,
    preheader: `${d.reason}: ${kind.toLowerCase()} ${what}`,
    footer: "Sent because a reader used a Report link.",
    automated: false,
    body: `
${heading("A reader reported a page", { size: 26, lineHeight: 32 })}
<tr><td style="padding:20px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line}">
${rows.map(([k, v]) => row(k, v)).join("\n")}
</table>
</td></tr>
${para("<strong>Details</strong>", { top: 20, size: 15 })}
<tr><td style="padding:8px 40px 0;font-family:${SANS};font-size:14px;line-height:22px">${detailsHtml}</td></tr>
${button(d.link, "Open the page")}
${para("Reply to this email to answer the reader, if they left an address.", { top: 16, size: 13, color: C.muted })}
${para(`Review it on InkBoard: <a href="${escapeHtml(ownerPageUrl(d.appUrl))}" style="color:${C.primary}">${escapeHtml(ownerPageUrl(d.appUrl))}</a>`, { top: 16, size: 13, color: C.muted })}
${para(`To hide this page from readers: <code style="font-family:${MONO};font-size:13px;background:${C.well};padding:2px 6px;border-radius:6px">${escapeHtml(hideCommand(d.path))}</code>`, { top: 12, size: 13, color: C.muted })}
${bottomSpace}`,
  });
  return { subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

export type TakedownNoticeDetails = {
  penName: string | null;
  /** What was hidden or restored: one poem, one novel (with its chapters), or the whole author page. */
  kind: "poem" | "novel" | "author";
  /** The poem's or novel's title (unused for "author"). */
  title: string | null;
  at: Date;
  /** Where to ask about it: PRIVACY_CONTACT_EMAIL. */
  contact: string;
  appUrl: string;
};

/**
 * A work's title in a takedown notice, or null when it would break the
 * notice rules (a 4+ digit run a code detector could offer, or the word
 * "code"); the email then says "one of your poems".
 */
export function takedownTitle(title: string | null): string | null {
  if (!title) return null;
  return /\d{4}|code/i.test(title) ? null : title;
}

function takedownWhat(d: TakedownNoticeDetails): { what: string; noun: string } {
  const title = takedownTitle(d.title);
  if (d.kind === "author") return { what: "your author page and all your poems and novels", noun: "author page" };
  if (d.kind === "novel") return { what: title ? `your novel “${title}” and its chapters` : "one of your novels", noun: "novel" };
  return { what: title ? `your poem “${title}”` : "one of your poems", noun: "poem" };
}

/** Shared look of the two takedown notices: heading, intro, the time, a closing line with the contact, a button. */
function takedownNotice(d: TakedownNoticeDetails, o: { subject: string; heading: string; intro: string; detail: string; preheader: string }): EmailMessage {
  const greeting = d.penName ? `Hi ${d.penName},` : "Hi,";
  const when = formatNoticeTime(d.at);
  const ask = `If you'd like to ask about it, write to ${d.contact}.`;
  const dashboard = new URL("/admin", d.appUrl).href;
  const text = [greeting, "", o.intro, "", o.detail, "", `When: ${when}`, "", ask, "", `Your dashboard: ${dashboard}`, "", "InkBoard"].join("\n");
  const mail = escapeHtml(d.contact);
  const html = frame({
    appUrl: d.appUrl,
    preheader: o.preheader,
    footer: "Sent to the address on your InkBoard account.",
    automated: false,
    body: `
${heading(escapeHtml(o.heading), { size: 26, lineHeight: 32 })}
${para(`${escapeHtml(greeting)} ${escapeHtml(o.intro)}`, { top: 14 })}
${para(escapeHtml(o.detail), { top: 12, size: 15 })}
${para(`When: ${escapeHtml(when)}`, { top: 12, size: 14, color: C.muted })}
${para(`If you&#39;d like to ask about it, write to <a href="mailto:${mail}" style="color:${C.primary}">${mail}</a>.`, { top: 16, size: 15 })}
${button(dashboard, "Open your dashboard")}
${bottomSpace}`,
  });
  return { subject: o.subject, text, html, headers: { ...AUTOMATED_HEADERS } };
}

/**
 * "Your poem was hidden on InkBoard" (Phase 32 round 2): the owner hid a work
 * (or the whole author page) after a report. What, when, that nothing is
 * deleted, and where to ask; never the report's reason or details, or
 * anything about the reader. No 4–8 digit numbers and no "code", like the
 * other notices (formatNoticeTime, takedownTitle).
 */
export function contentHiddenEmail(d: TakedownNoticeDetails): EmailMessage {
  const { what, noun } = takedownWhat(d);
  const subject = d.kind === "author" ? "Your InkBoard author page was hidden" : `Your ${noun} was hidden on InkBoard`;
  return takedownNotice(d, {
    subject,
    heading: d.kind === "author" ? "Your author page was hidden" : `Your ${noun} was hidden`,
    intro: `InkBoard's owner has hidden ${what} from readers, after a report.`,
    detail:
      "Nothing is deleted. You can still see, edit, download and delete it from your dashboard, but readers can't open it, and it isn't on the board, in search or in feeds.",
    preheader: `Readers can't see ${what} for now. Nothing is deleted.`,
  });
}

/** "Your poem is back on InkBoard": the owner restored what they hid, exactly as it was. */
export function contentRestoredEmail(d: TakedownNoticeDetails): EmailMessage {
  const { what, noun } = takedownWhat(d);
  const subject = d.kind === "author" ? "Your InkBoard author page is back" : `Your ${noun} is back on InkBoard`;
  return takedownNotice(d, {
    subject,
    heading: d.kind === "author" ? "Your author page is back" : `Your ${noun} is back`,
    intro: `InkBoard's owner has restored ${what}.`,
    detail: "Readers can see it again, exactly as it was: the same address, text and settings.",
    preheader: `Readers can see ${what} again.`,
  });
}
