import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { isReportReason, reportReasonLabel, type ReportKind } from "@/lib/report";
import type { TakedownGuard } from "./takedown";

/*
 * The owner's page (docs/PLAN.md, Phase 32 round 3): readers' reports grouped
 * by page, what is hidden now, and "Mark as reviewed". Owner-only: only the
 * owner's page and its actions import this module (a test checks), after
 * requireOwner(). Like the takedown's lookups it sees hidden rows on purpose.
 * Titles, pen names and paths only: never poem or chapter text, and nothing
 * about the reader (reports hold none).
 */

/** How long a reviewed report stays on the "Reviewed" tab (the 90-day cleanup deletes it later). */
export const REVIEWED_SHOWN_DAYS = 30;

export type OwnerReport = {
  id: string;
  reason: string;
  reasonLabel: string;
  /** The reader's words, as written: render as text, never HTML. */
  details: string | null;
  at: Date;
  reviewedAt: Date | null;
};

export type ReportGroup = {
  kind: ReportKind;
  /** The reported row's id (poem, novel, chapter or editor). */
  targetId: string;
  /** The work's title ("Novel, Chapter" for a chapter); the pen name for an author. */
  title: string;
  penName: string;
  /** The reader page's path, e.g. /p/ama/dusk. */
  path: string;
  /** Hidden now: the page itself, its novel or its author. */
  hidden: boolean;
  /** For a chapter's group: its novel, which Hide or Restore acts on. */
  novelTitle: string | null;
  /** Newest first. */
  reports: OwnerReport[];
};

type Row = {
  id: string;
  reason: string;
  details: string | null;
  at: Date | string;
  reviewedAt: Date | string | null;
  kind: ReportKind;
  targetId: string;
  title: string | null;
  penName: string | null;
  path: string;
  hidden: boolean;
  novelTitle: string | null;
};

async function reportRows(where: SQL): Promise<Row[]> {
  const res = (await getDb().execute(sql`
    SELECT r.id, r.reason, r.details, r.created_at AS "at", r.reviewed_at AS "reviewedAt",
      CASE WHEN r.poem_id IS NOT NULL THEN 'poem' WHEN r.novel_id IS NOT NULL THEN 'novel'
           WHEN r.chapter_id IS NOT NULL THEN 'chapter' ELSE 'author' END AS "kind",
      COALESCE(r.poem_id, r.novel_id, r.chapter_id, r.editor_id)::text AS "targetId",
      COALESCE(p.title, n.title, cn.title || ', ' || COALESCE(NULLIF(c.title, ''), 'a chapter'), e.pen_name) AS "title",
      COALESCE(pe.pen_name, ne.pen_name, ce.pen_name, e.pen_name) AS "penName",
      CASE
        WHEN p.id IS NOT NULL THEN '/p/' || pe.slug || '/' || p.slug
        WHEN n.id IS NOT NULL THEN '/a/' || ne.slug || '/n/' || n.slug
        WHEN c.id IS NOT NULL THEN '/a/' || ce.slug || '/n/' || cn.slug || '/' || c.slug
        ELSE '/a/' || e.slug END AS "path",
      COALESCE(p.hidden_at, pe.hidden_at, n.hidden_at, ne.hidden_at, cn.hidden_at, ce.hidden_at, e.hidden_at) IS NOT NULL AS "hidden",
      cn.title AS "novelTitle"
    FROM reports r
    LEFT JOIN poems p ON p.id = r.poem_id LEFT JOIN editors pe ON pe.id = p.editor_id
    LEFT JOIN novels n ON n.id = r.novel_id LEFT JOIN editors ne ON ne.id = n.editor_id
    LEFT JOIN chapters c ON c.id = r.chapter_id LEFT JOIN novels cn ON cn.id = c.novel_id
      LEFT JOIN editors ce ON ce.id = cn.editor_id
    LEFT JOIN editors e ON e.id = r.editor_id
    WHERE ${where}
    ORDER BY r.created_at DESC, r.id
  `)) as unknown as { rows: Row[] };
  return res.rows;
}

/** Rows (newest first) into groups per page, the page with the newest report first. */
function group(rows: Row[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();
  for (const r of rows) {
    const key = `${r.kind}:${r.targetId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        kind: r.kind,
        targetId: r.targetId,
        title: r.title ?? "",
        penName: r.penName ?? "",
        path: r.path,
        hidden: Boolean(r.hidden),
        novelTitle: r.kind === "chapter" ? r.novelTitle : null,
        reports: [],
      };
      groups.set(key, g);
    }
    g.reports.push({
      id: r.id,
      reason: r.reason,
      reasonLabel: isReportReason(r.reason) ? reportReasonLabel(r.reason) : r.reason,
      details: r.details,
      at: new Date(r.at),
      reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
    });
  }
  return [...groups.values()];
}

/** Open reports (not reviewed), grouped by page, the page with the newest report first. */
export async function loadOpenReportGroups(): Promise<ReportGroup[]> {
  return group(await reportRows(sql`r.reviewed_at IS NULL`));
}

/** Reports reviewed in the last REVIEWED_SHOWN_DAYS days, grouped the same way. */
export async function loadReviewedReportGroups(): Promise<ReportGroup[]> {
  return group(await reportRows(sql`r.reviewed_at > now() - make_interval(days => ${REVIEWED_SHOWN_DAYS})`));
}

export type HiddenItem = {
  kind: "poem" | "novel" | "author";
  id: string;
  /** The poem's or novel's title; the pen name for an author. */
  title: string;
  penName: string;
  /** Its reader address (/p/…, /a/…/n/…, /a/…), which Restore acts on. */
  path: string;
  hiddenAt: Date;
};

/** Everything hidden now, newest first: poems, novels and authors (each its own row). */
export async function loadHiddenNow(): Promise<HiddenItem[]> {
  const res = (await getDb().execute(sql`
    SELECT 'poem' AS kind, p.id::text AS id, p.title, e.pen_name AS "penName", '/p/' || e.slug || '/' || p.slug AS path, p.hidden_at AS "hiddenAt"
      FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.hidden_at IS NOT NULL AND e.pen_name IS NOT NULL
    UNION ALL
    SELECT 'novel', n.id::text, n.title, e.pen_name, '/a/' || e.slug || '/n/' || n.slug, n.hidden_at
      FROM novels n JOIN editors e ON e.id = n.editor_id WHERE n.hidden_at IS NOT NULL AND e.pen_name IS NOT NULL
    UNION ALL
    SELECT 'author', e.id::text, e.pen_name, e.pen_name, '/a/' || e.slug, e.hidden_at
      FROM editors e WHERE e.hidden_at IS NOT NULL AND e.pen_name IS NOT NULL
    ORDER BY "hiddenAt" DESC, id
  `)) as unknown as { rows: (Omit<HiddenItem, "hiddenAt"> & { hiddenAt: Date | string })[] };
  return res.rows.map((r) => ({ ...r, hiddenAt: new Date(r.hiddenAt) }));
}

const COLUMN = { poem: "poem_id", novel: "novel_id", chapter: "chapter_id", author: "editor_id" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Mark as reviewed": closes that one page's open reports (and no other's).
 * `guard` (isSessionFresh) runs first inside the writing transaction; when it
 * says no, nothing changes. A kind or id it can't read is "invalid".
 */
export async function markReportsReviewed(
  target: { kind: unknown; id: unknown },
  { guard }: { guard?: TakedownGuard } = {},
): Promise<{ ok: true; count: number } | { ok: false; error: "invalid" | "step_up_required" }> {
  const kind = target.kind;
  if (typeof kind !== "string" || !(kind in COLUMN) || typeof target.id !== "string" || !UUID.test(target.id)) {
    return { ok: false, error: "invalid" };
  }
  const column = sql.raw(COLUMN[kind as ReportKind]);
  const id = target.id;
  return getDb().transaction(async (tx) => {
    if (guard && !(await guard(tx))) return { ok: false as const, error: "step_up_required" as const };
    const r = (await tx.execute(sql`
      UPDATE reports SET reviewed_at = now() WHERE ${column} = ${id}::uuid AND reviewed_at IS NULL RETURNING id
    `)) as unknown as { rows: { id: string }[] };
    return { ok: true as const, count: r.rows.length };
  });
}
