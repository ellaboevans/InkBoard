import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOwner } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { isSessionFresh } from "@/server/auth/step-up";
import { loadHiddenNow, loadOpenReportGroups, loadReviewedReportGroups, REVIEWED_SHOWN_DAYS, type ReportGroup } from "@/server/owner-reports";
import { absoluteUrl } from "@/lib/site";
import { FEATURED_MAX, loadFeaturedForOwner } from "@/server/featured";
import { OwnerPanel, type FeaturedView, type GroupView, type HiddenView } from "./owner-panel";

export const metadata: Metadata = { title: "Reports" };

/*
 * The owner's page (docs/PLAN.md, Phase 32 round 3): readers' reports grouped
 * by page, what is hidden now, Hide / Restore / Mark as reviewed. Only the
 * owner: requireOwner() here and in every action (anyone else gets the same
 * 404 as a missing page; the proxy makes a full page load's status a real 404
 * too). Reading needs no step-up; every change does (the actions check).
 */
export default function OwnerPage() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-8">
      <div>
        <h1 className="font-serif text-3xl">Reports</h1>
        <p className="mt-1 text-muted-foreground">
          What readers reported, grouped by page. Hiding never deletes anything, and the writer is emailed.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Owner />
      </Suspense>
    </div>
  );
}

// Formatted here, not in the browser, so server and client agree (like updatedLabel).
const timeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const label = (d: Date) => `${timeFormat.format(d)} UTC`;

function view(g: ReportGroup): GroupView {
  return {
    key: `${g.kind}:${g.targetId}`,
    kind: g.kind,
    targetId: g.targetId,
    title: g.title,
    penName: g.penName,
    path: g.path,
    url: absoluteUrl(g.path),
    hidden: g.hidden,
    novelTitle: g.novelTitle,
    reports: g.reports.map((r) => ({
      id: r.id,
      reason: r.reasonLabel,
      details: r.details,
      atLabel: label(r.at),
      reviewedLabel: r.reviewedAt ? label(r.reviewedAt) : null,
    })),
  };
}

async function Owner() {
  const { editor, sessionId } = await requireOwner();
  const [open, reviewed, hidden, fresh, keys, featured] = await Promise.all([
    loadOpenReportGroups(),
    loadReviewedReportGroups(),
    loadHiddenNow(),
    isSessionFresh(editor.id, sessionId),
    listPasskeys(editor.id),
    loadFeaturedForOwner(),
  ]);
  const featuredViews: FeaturedView[] = featured.map((f) => ({
    key: `${f.kind}:${f.id}`,
    kind: f.kind,
    id: f.id,
    title: f.title,
    penName: f.penName,
    url: absoluteUrl(f.path),
    featuredLabel: label(f.featuredAt),
    shown: f.shown,
  }));
  const hiddenViews: HiddenView[] = hidden.map((h) => ({
    key: `${h.kind}:${h.id}`,
    kind: h.kind,
    title: h.title,
    penName: h.penName,
    path: h.path,
    url: absoluteUrl(h.path),
    hiddenLabel: label(h.hiddenAt),
  }));
  return (
    <OwnerPanel
      open={open.map(view)}
      reviewed={reviewed.map(view)}
      hidden={hiddenViews}
      featured={featuredViews}
      featuredMax={FEATURED_MAX}
      reviewedDays={REVIEWED_SHOWN_DAYS}
      fresh={fresh}
      email={editor.email}
      hasPasskeys={keys.length > 0}
    />
  );
}
