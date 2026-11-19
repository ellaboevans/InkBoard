import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters } from "@/db/schema";

/*
 * "Is this chapter released?" (Phase 28, scheduled chapters). The one
 * definition every reader query uses: a chapter is released when it is
 * published and its release time has come, by the database's clock. A
 * scheduled chapter is published with a release time in the future, so at its
 * minute it simply becomes visible: nothing has to run then.
 *
 * Reader code (board.ts, feeds.ts, search.ts, the sitemap, short links,
 * unlocks, share images, notifications, stats) must never test
 * `status = 'published'` on chapters itself: tests/novels/released-helper.test.ts
 * fails if it does.
 */

/** The chapters table's own columns (Drizzle queries). */
export function chapterReleased(): SQL;
/** A chapters alias in hand-written SQL, e.g. `chapterReleased("c")`. */
export function chapterReleased(alias: string): SQL;
export function chapterReleased(alias?: string): SQL {
  if (alias === undefined) return sql`(${chapters.status} = 'published' AND ${chapters.releaseAt} <= now())`;
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`Bad SQL alias ${alias}`);
  return sql.raw(`(${alias}.status = 'published' AND ${alias}.release_at <= now())`);
}

/** Scheduled: published, with its release still ahead (the writer's side only). */
export function chapterScheduled(): SQL {
  return sql`(${chapters.status} = 'published' AND ${chapters.releaseAt} > now())`;
}

/**
 * Seconds until the next scheduled release anywhere (null if none), from the
 * database's clock: the cached reader data lives no longer than this
 * (board-cache.ts), so a release shows without anything running at that moment.
 * One indexed query (chapters_status_release_idx).
 */
export async function secondsToNextRelease(): Promise<number | null> {
  const r = (await getDb().execute(sql`
    SELECT extract(epoch FROM min(release_at) - now())::float8 AS s
    FROM chapters WHERE status = 'published' AND release_at > now()
  `)) as unknown as { rows: { s: number | null }[] };
  const s = r.rows[0]?.s;
  return s === null || s === undefined ? null : s;
}
