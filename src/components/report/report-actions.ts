"use server";

import { after } from "next/server";
import { getRequestMeta } from "@/server/auth/dal";
import { sendReportEmail } from "@/server/email";
import { submitReport } from "@/server/reports";
import { parseReportTarget, REPORT_UNAVAILABLE, type ReportFieldErrors } from "@/lib/report";

export type ReportState = { sent?: boolean; error?: string; errors?: ReportFieldErrors };

/**
 * A reader's report (docs/PLAN.md, Phase 32). No sign-in: the target comes
 * from the page's server-rendered props and is checked again here. Every
 * accepted report (stored, rate-limited or repeated) gets the same
 * `{ sent: true }`, so the limits can't be probed.
 */
export async function reportAction(target: unknown, _prev: ReportState, formData: FormData): Promise<ReportState> {
  const parsed = parseReportTarget(target);
  if (!parsed) return { error: REPORT_UNAVAILABLE };
  const { ip } = await getRequestMeta();
  const res = await submitReport({
    target: parsed,
    reason: formData.get("reason"),
    details: formData.get("details"),
    email: formData.get("email"),
    ip,
  });
  if (!res.ok) return res.error === "invalid" ? { errors: res.errors } : { error: REPORT_UNAVAILABLE };
  const notice = res.notice;
  // After the response, so its timing doesn't say whether an email went out.
  if (notice) {
    after(async () => {
      try {
        await sendReportEmail(notice);
      } catch {
        // Never log the notice: it may hold the reader's reply address.
        console.error("[report] email failed");
      }
    });
  }
  return { sent: true };
}
