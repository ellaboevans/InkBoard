/**
 * Readers' reports (docs/PLAN.md, Phase 32): the rules the dialog and the
 * server share. Pure, so both import it.
 */

export const REPORT_REASONS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "harassment", label: "Harassment, hate or threats" },
  { value: "sexual-violent", label: "Sexual or violent content" },
  { value: "copied", label: "Copied from someone else" },
  { value: "personal-info", label: "Someone's personal information" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && REPORT_REASONS.some((r) => r.value === value);
}

export function reportReasonLabel(reason: ReportReason): string {
  return REPORT_REASONS.find((r) => r.value === reason)!.label;
}

/** What a report is about, named by the page's own slugs (server-rendered props; the server checks it again). */
export type ReportTarget =
  | { kind: "poem"; author: string; poem: string }
  | { kind: "novel"; author: string; novel: string }
  | { kind: "chapter"; author: string; novel: string; chapter: string }
  | { kind: "author"; author: string };

export type ReportKind = ReportTarget["kind"];

export const REPORT_DETAILS_MAX = 1000;
export const REPORT_EMAIL_MAX = 254;

/** Per network (ipBucket): reports in an hour. */
export const REPORTS_PER_NETWORK_PER_HOUR = 5;
/** The same page, once per network in this long. */
export const REPORT_REPEAT_WINDOW_SECONDS = 24 * 60 * 60;
/** Report emails to the owner per day, all readers together; past it a report is stored, not emailed. */
export const REPORT_EMAILS_PER_DAY = 30;

/** The one answer to every accepted report, rate-limited or repeated ones included. */
export const REPORT_THANKS = "Thanks. InkBoard's owner will look at it.";
/** A draft, a scheduled chapter before its time, or a missing page. */
export const REPORT_UNAVAILABLE = "This page isn't available.";

export type ReportFieldErrors = { reason?: string; details?: string; email?: string };

export type ReportInput = { reason: ReportReason; details: string | null; replyTo: string | null };

/** Check the form's fields; the same checks run in the dialog and on the server. */
export function validateReport(raw: {
  reason: unknown;
  details: unknown;
  email: unknown;
}): { ok: true; value: ReportInput } | { ok: false; errors: ReportFieldErrors } {
  const errors: ReportFieldErrors = {};
  const reason = isReportReason(raw.reason) ? raw.reason : null;
  if (!reason) errors.reason = "Choose a reason.";
  const details = typeof raw.details === "string" ? raw.details.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
  if ([...details].length > REPORT_DETAILS_MAX) errors.details = `Keep the details under ${REPORT_DETAILS_MAX.toLocaleString("en")} characters.`;
  else if (reason === "other" && !details) errors.details = "Tell us what’s wrong.";
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  if (email && (email.length > REPORT_EMAIL_MAX || !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(email))) {
    errors.email = "Enter an email address like name@example.com, or leave it empty.";
  }
  if (!reason || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { reason, details: details || null, replyTo: email || null } };
}

/** The page a target names. */
export function reportTargetPath(t: ReportTarget): string {
  const e = encodeURIComponent;
  switch (t.kind) {
    case "poem":
      return `/p/${e(t.author)}/${e(t.poem)}`;
    case "novel":
      return `/a/${e(t.author)}/n/${e(t.novel)}`;
    case "chapter":
      return `/a/${e(t.author)}/n/${e(t.novel)}/${e(t.chapter)}`;
    case "author":
      return `/a/${e(t.author)}`;
  }
}

/** A target from untrusted input (the action's arguments), or null. */
export function parseReportTarget(raw: unknown): ReportTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;
  if (!s(r.author)) return null;
  const author = r.author as string;
  if (r.kind === "author") return { kind: "author", author };
  if (r.kind === "poem" && s(r.poem)) return { kind: "poem", author, poem: r.poem as string };
  if (r.kind === "novel" && s(r.novel)) return { kind: "novel", author, novel: r.novel as string };
  if (r.kind === "chapter" && s(r.novel) && s(r.chapter)) {
    return { kind: "chapter", author, novel: r.novel as string, chapter: r.chapter as string };
  }
  return null;
}
