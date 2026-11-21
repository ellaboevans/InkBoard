import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, editors, novels, poems, reports } from "@/db/schema";
import { chapterDisplayTitle } from "@/lib/novel-limits";
import {
  REPORT_EMAILS_PER_DAY,
  REPORT_REPEAT_WINDOW_SECONDS,
  REPORTS_PER_NETWORK_PER_HOUR,
  reportTargetPath,
  validateReport,
  type ReportFieldErrors,
  type ReportKind,
  type ReportReason,
  type ReportTarget,
} from "@/lib/report";
import { ipBucket } from "./auth/ip";
import { chapterReleased } from "./chapter-release";
import { rateLimit } from "./rate-limit";

/*
 * Readers' reports (docs/PLAN.md, Phase 32 round 1). Framework-free like
 * otp.ts: the action (src/components/report/report-actions.ts) passes the
 * request's IP and sends the returned notice in after().
 *
 * Only what the reader can see can be reported: a published poem, a novel
 * with a released chapter, a released chapter, an author with a pen name
 * (readerPathExists' rules). Private poems and novels can be: their titles
 * are public, and nothing here ever selects poem or chapter text.
 *
 * Nothing about the reader is stored: not the IP (only its bucket, inside a
 * rate-limit key that the cleanup drops), user agent, cookie or reply
 * address. The reply address goes only into the owner's email, as Reply-To.
 */

/** A resolved target: the row to point at, and what the owner's email names. */
export type ResolvedReportTarget = {
  kind: ReportKind;
  /** The id of the one row the report points at (poem, novel, chapter or editor). */
  id: string;
  title: string;
  penName: string;
  path: string;
};

const authorVisible = (slug: string) => and(eq(editors.slug, slug), isNotNull(editors.penName));

/** The target if a reader can see it now, else null (draft, scheduled, missing: the same null). */
export async function resolveReportTarget(t: ReportTarget): Promise<ResolvedReportTarget | null> {
  const db = getDb();
  const path = reportTargetPath(t);
  if (t.kind === "author") {
    const [row] = await db.select({ id: editors.id, penName: editors.penName }).from(editors).where(authorVisible(t.author)).limit(1);
    return row ? { kind: "author", id: row.id, title: row.penName!, penName: row.penName!, path } : null;
  }
  if (t.kind === "poem") {
    const [row] = await db
      .select({ id: poems.id, title: poems.title, penName: editors.penName })
      .from(poems)
      .innerJoin(editors, eq(editors.id, poems.editorId))
      .where(and(authorVisible(t.author), eq(poems.slug, t.poem), eq(poems.status, "published")))
      .limit(1);
    return row ? { kind: "poem", id: row.id, title: row.title, penName: row.penName!, path } : null;
  }
  if (t.kind === "novel") {
    const [row] = await db
      .select({ id: novels.id, title: novels.title, penName: editors.penName })
      .from(novels)
      .innerJoin(editors, eq(editors.id, novels.editorId))
      .innerJoin(chapters, and(eq(chapters.novelId, novels.id), chapterReleased()))
      .where(and(authorVisible(t.author), eq(novels.slug, t.novel)))
      .limit(1);
    return row ? { kind: "novel", id: row.id, title: row.title, penName: row.penName!, path } : null;
  }
  const [row] = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      novelTitle: novels.title,
      penName: editors.penName,
      // Numbered among released chapters, as readers see it.
      number: sql<number>`(SELECT count(*)::int FROM chapters c WHERE c.novel_id = ${chapters.novelId}
        AND c.position <= ${chapters.position} AND ${chapterReleased("c")})`,
    })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .innerJoin(editors, eq(editors.id, novels.editorId))
    .where(and(authorVisible(t.author), eq(novels.slug, t.novel), eq(chapters.slug, t.chapter), chapterReleased()))
    .limit(1);
  if (!row) return null;
  const title = `${row.novelTitle}, ${chapterDisplayTitle(row.title, Number(row.number))}`;
  return { kind: "chapter", id: row.id, title, penName: row.penName!, path };
}

const targetColumn = {
  poem: reports.poemId,
  novel: reports.novelId,
  chapter: reports.chapterId,
  author: reports.editorId,
} as const;

const targetField = { poem: "poemId", novel: "novelId", chapter: "chapterId", author: "editorId" } as const;

/** What the owner's email says (src/server/email-templates.ts reportEmail). */
export type ReportNotice = {
  target: ResolvedReportTarget;
  reason: ReportReason;
  details: string | null;
  /** Only ever in the email (Reply-To); never stored or logged. */
  replyTo: string | null;
  at: Date;
  /** Earlier reports of this same page still kept. */
  earlier: number;
};

export type ReportResult =
  | { ok: true; notice: ReportNotice | null }
  | { ok: false; error: "invalid"; errors: ReportFieldErrors }
  | { ok: false; error: "unavailable" };

/**
 * Take a report. Every accepted report, whether it was stored or dropped by a
 * limit, comes back as `{ ok: true }` (the same thank-you), so the limits
 * can't be probed. `notice` is set only when the owner should be emailed.
 */
export async function submitReport(input: {
  target: ReportTarget;
  reason: unknown;
  details: unknown;
  email: unknown;
  ip: string | null;
}): Promise<ReportResult> {
  const valid = validateReport({ reason: input.reason, details: input.details, email: input.email });
  if (!valid.ok) return { ok: false, error: "invalid", errors: valid.errors };
  const target = await resolveReportTarget(input.target);
  if (!target) return { ok: false, error: "unavailable" };

  // Tiered: the network's hourly budget first, then this page once a day.
  const bucket = ipBucket(input.ip);
  const network = await rateLimit(`report:ip:${bucket}`, REPORTS_PER_NETWORK_PER_HOUR, 3600);
  if (!network.allowed) return { ok: true, notice: null };
  const page = await rateLimit(`report:page:${target.id}:${bucket}`, 1, REPORT_REPEAT_WINDOW_SECONDS);
  if (!page.allowed) return { ok: true, notice: null };

  const db = getDb();
  const column = targetColumn[target.kind];
  const [{ earlier }] = await db
    .select({ earlier: sql<number>`count(*)::int` })
    .from(reports)
    .where(eq(column, target.id));
  const [row] = await db
    .insert(reports)
    .values({ [targetField[target.kind]]: target.id, reason: valid.value.reason, details: valid.value.details })
    .returning({ at: reports.createdAt });

  // At most REPORT_EMAILS_PER_DAY emails a day for everyone together; past it, stored only.
  const cap = await rateLimit("report:email:day", REPORT_EMAILS_PER_DAY, 86400);
  if (!cap.allowed) return { ok: true, notice: null };
  return {
    ok: true,
    notice: {
      target,
      reason: valid.value.reason,
      details: valid.value.details,
      replyTo: valid.value.replyTo,
      at: row.at,
      earlier: Number(earlier),
    },
  };
}

/** One report as `pnpm reports` prints it. */
export type ReportListing = {
  at: Date | string;
  reason: string;
  details: string | null;
  kind: ReportKind;
  title: string | null;
  penName: string | null;
  path: string;
};

/** For `pnpm reports` (scripts/reports.ts): the last `days` days, newest first, with their pages. */
export async function recentReports(
  days = 30,
  db: Pick<ReturnType<typeof getDb>, "execute"> = getDb(),
): Promise<ReportListing[]> {
  const res = (await db.execute(sql`
    SELECT r.created_at AS "at", r.reason, r.details,
      CASE WHEN r.poem_id IS NOT NULL THEN 'poem' WHEN r.novel_id IS NOT NULL THEN 'novel'
           WHEN r.chapter_id IS NOT NULL THEN 'chapter' ELSE 'author' END AS "kind",
      COALESCE(p.title, n.title, cn.title || ', ' || COALESCE(NULLIF(c.title, ''), 'a chapter'), e.pen_name) AS "title",
      COALESCE(pe.pen_name, ne.pen_name, ce.pen_name, e.pen_name) AS "penName",
      CASE
        WHEN p.id IS NOT NULL THEN '/p/' || pe.slug || '/' || p.slug
        WHEN n.id IS NOT NULL THEN '/a/' || ne.slug || '/n/' || n.slug
        WHEN c.id IS NOT NULL THEN '/a/' || ce.slug || '/n/' || cn.slug || '/' || c.slug
        ELSE '/a/' || e.slug END AS "path"
    FROM reports r
    LEFT JOIN poems p ON p.id = r.poem_id LEFT JOIN editors pe ON pe.id = p.editor_id
    LEFT JOIN novels n ON n.id = r.novel_id LEFT JOIN editors ne ON ne.id = n.editor_id
    LEFT JOIN chapters c ON c.id = r.chapter_id LEFT JOIN novels cn ON cn.id = c.novel_id
      LEFT JOIN editors ce ON ce.id = cn.editor_id
    LEFT JOIN editors e ON e.id = r.editor_id
    WHERE r.created_at > now() - make_interval(days => ${days})
    ORDER BY r.created_at DESC
  `)) as unknown as { rows: ReportListing[] };
  return res.rows;
}
