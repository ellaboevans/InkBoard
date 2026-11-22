"use server";

import { refresh, updateTag } from "next/cache";
import { requireOwner } from "@/server/auth/dal";
import { isSessionFresh } from "@/server/auth/step-up";
import { sendTakedownEmail } from "@/server/email";
import { markReportsReviewed } from "@/server/owner-reports";
import { runTakedown } from "@/server/takedown-route";

/*
 * The owner's page actions (docs/PLAN.md, Phase 32 round 3). Each one
 * re-authorises through requireOwner() (anyone else: notFound()), and every
 * change needs a recent verification, checked inside the writing transaction
 * (isSessionFresh as the guard), like deleting an account. Hide and Restore go
 * through runTakedown, the same path as POST /api/owner/takedown, so the
 * writer's email and "already hidden" behave identically.
 */

export type OwnerActionResult =
  | { ok: true; title: string; description: string }
  | { ok: false; reason: "step_up" }
  | { ok: false; reason: "error"; title: string; description: string };

const what = (kind: string, title: string, penName: string) =>
  kind === "author" ? `${penName}'s author page and everything on it` : kind === "novel" ? `“${title}” and its chapters` : `“${title}”`;

export async function ownerTakedownAction(link: string, action: "hide" | "restore"): Promise<OwnerActionResult> {
  const { editor, sessionId } = await requireOwner();
  const out = await runTakedown(
    { link, action },
    {
      revalidate: (tag) => updateTag(tag),
      notify: sendTakedownEmail,
      guard: (tx) => isSessionFresh(editor.id, sessionId, tx),
    },
  );
  if (!out.ok) {
    if (out.error === "step_up_required") return { ok: false, reason: "step_up" };
    return { ok: false, reason: "error", title: "Nothing changed", description: "That page isn't there any more." };
  }
  refresh();
  const named = what(out.kind, out.title, out.penName);
  if (!out.changed) {
    return {
      ok: true,
      title: action === "hide" ? "Already hidden" : "Not hidden",
      description: `${named} ${action === "hide" ? "was already hidden" : "was already shown to readers"}. Nothing changed.`,
    };
  }
  return action === "hide"
    ? { ok: true, title: "Hidden from readers", description: `${named} is hidden now. ${out.penName} has been emailed.` }
    : { ok: true, title: "Restored", description: `${named} is back, exactly as it was. ${out.penName} has been emailed.` };
}

export async function ownerMarkReviewedAction(kind: string, id: string): Promise<OwnerActionResult> {
  const { editor, sessionId } = await requireOwner();
  const res = await markReportsReviewed({ kind, id }, { guard: (tx) => isSessionFresh(editor.id, sessionId, tx) });
  if (!res.ok) {
    if (res.error === "step_up_required") return { ok: false, reason: "step_up" };
    return { ok: false, reason: "error", title: "Nothing changed", description: "Those reports aren't there any more." };
  }
  refresh();
  return {
    ok: true,
    title: "Marked as reviewed",
    description: res.count === 1 ? "That report is closed." : res.count === 0 ? "Nothing was open." : `Its ${res.count} reports are closed.`,
  };
}
