import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chapterReleased } from "./chapter-release";
import { chapterDisplayTitle, readingMinutes } from "@/lib/novel-limits";
import { byVisits, followerCount, type NovelStats, type SharedLink, type WriterStats } from "@/lib/writer-stats";

/*
 * Stats for writers (docs/PLAN.md, Phase 27), for /admin/stats only. Takes the
 * DAL-resolved editor id and scopes every query by it; never imported by a
 * reader loader, feed or card (tests/stats/writer-stats.test.ts checks).
 *
 * Only what InkBoard already keeps: short_links.visits (counted in the proxy,
 * once per network per work per day, link-preview bots excluded), the
 * chapters' word counts, statuses and release times, and push_follows rows.
 * "Published" counts released chapters only (chapterReleased); scheduled
 * chapters (Phase 28) are counted apart from drafts. Two queries,
 * each on existing indexes (poems_editor_idx, novels_editor_slug_key,
 * chapters_novel_position_key, short_links_{poem,chapter}_key,
 * push_follows_editor_idx).
 */

type LinkRow = {
  kind: "poem" | "chapter";
  title: string;
  chapter_title: string | null;
  number: number | null;
  live: boolean;
  visits: number;
};

type NovelRow = {
  id: string;
  title: string;
  is_private: boolean;
  published: number;
  scheduled: number;
  drafts: number;
  words: number;
  visits: number;
};

export async function getWriterStats(editorId: string): Promise<WriterStats> {
  const db = getDb();
  const [links, summary] = await Promise.all([
    db.execute(sql`
      SELECT 'poem' AS kind, p.title, NULL AS chapter_title, NULL::int AS number,
        (p.status = 'published' AND p.visibility = 'public') AS live, sl.visits
      FROM short_links sl JOIN poems p ON p.id = sl.poem_id
      WHERE p.editor_id = ${editorId}
      UNION ALL
      SELECT 'chapter', n.title, c.title, pc.number,
        (${chapterReleased("c")} AND n.visibility = 'public'), sl.visits
      FROM short_links sl
      JOIN chapters c ON c.id = sl.chapter_id
      JOIN novels n ON n.id = c.novel_id
      -- Numbered among released chapters, like readers see them.
      LEFT JOIN (
        SELECT pc.id, row_number() OVER (PARTITION BY pc.novel_id ORDER BY pc.position)::int AS number
        FROM chapters pc JOIN novels pn ON pn.id = pc.novel_id
        WHERE pn.editor_id = ${editorId} AND ${chapterReleased("pc")}
      ) pc ON pc.id = c.id
      WHERE n.editor_id = ${editorId}
    `) as unknown as Promise<{ rows: LinkRow[] }>,
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM push_follows WHERE editor_id = ${editorId}) AS followers,
        COALESCE((
          SELECT json_agg(x) FROM (
            SELECT n.id, n.title, n.visibility = 'private' AS is_private,
              count(c.id) FILTER (WHERE ${chapterReleased("c")})::int AS published,
              count(c.id) FILTER (WHERE c.status = 'published' AND c.release_at > now())::int AS scheduled,
              count(c.id) FILTER (WHERE c.status = 'draft')::int AS drafts,
              COALESCE(sum(c.word_count) FILTER (WHERE ${chapterReleased("c")}), 0)::int AS words,
              COALESCE(sum(sl.visits), 0)::int AS visits
            FROM novels n
            LEFT JOIN chapters c ON c.novel_id = n.id
            LEFT JOIN short_links sl ON sl.chapter_id = c.id
            WHERE n.editor_id = ${editorId}
            GROUP BY n.id
          ) x
        ), '[]'::json) AS novels
    `) as unknown as Promise<{ rows: { followers: number; novels: NovelRow[] }[] }>,
  ]);

  const sharedLinks: SharedLink[] = links.rows.map((r) => ({
    kind: r.kind,
    title: r.title,
    detail:
      r.kind === "chapter"
        ? r.number === null
          ? `Unpublished chapter${r.chapter_title?.trim() ? ` · ${r.chapter_title.trim()}` : ""}`
          : r.chapter_title?.trim()
            ? `Chapter ${r.number} · ${r.chapter_title.trim()}`
            : chapterDisplayTitle("", r.number)
        : null,
    live: r.live,
    visits: Number(r.visits),
  }));

  const { followers, novels } = summary.rows[0];
  const novelStats: NovelStats[] = novels.map((n) => ({
    id: n.id,
    title: n.title,
    isPrivate: n.is_private,
    publishedChapters: n.published,
    scheduledChapters: n.scheduled,
    draftChapters: n.drafts,
    words: n.words,
    readingMinutes: readingMinutes(n.words),
    visits: n.visits,
  }));

  return { links: byVisits(sharedLinks), novels: byVisits(novelStats), followers: followerCount(Number(followers)) };
}
