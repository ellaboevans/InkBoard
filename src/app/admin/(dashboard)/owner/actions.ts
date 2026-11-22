"use server";

import { refresh, updateTag } from "next/cache";
import { after } from "next/server";
import { requireOwner } from "@/server/auth/dal";
import { isSessionFresh } from "@/server/auth/step-up";
import { sendFeaturedEmail, sendTakedownEmail } from "@/server/email";
import { BOARD_TAG } from "@/server/cache-tags";
import { FEATURE_REFUSAL_MESSAGE, featureWork, unfeatureWork } from "@/server/featured";
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

/**
 * Feature a work (Phase 33): owner only, no step-up (featuring takes nothing
 * from anyone). The writer is emailed in after() the first time a work is
 * ever featured; nothing on removal.
 */
export async function ownerFeatureAction(link: string): Promise<OwnerActionResult> {
  await requireOwner();
  const res = await featureWork(link);
  if (!res.ok) return { ok: false, reason: "error", title: "Not featured", description: FEATURE_REFUSAL_MESSAGE[res.error] };
  updateTag(BOARD_TAG);
  refresh();
  if (res.firstTime) {
    const { email, penName, kind, title, path } = res;
    after(async () => {
      try {
        await sendFeaturedEmail(email, { penName, kind, title, path });
      } catch {
        console.error("[owner] featured email failed");
      }
    });
  }
  return { ok: true, title: "Featured", description: `“${res.title}” by ${res.penName} is featured now.` };
}

export async function ownerUnfeatureAction(kind: string, id: string): Promise<OwnerActionResult> {
  await requireOwner();
  const removed = await unfeatureWork(kind, id);
  if (!removed) return { ok: false, reason: "error", title: "Nothing changed", description: "That one isn't featured any more." };
  updateTag(BOARD_TAG);
  refresh();
  return { ok: true, title: "Removed from Featured", description: "Readers no longer see it under Featured." };
}
