import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapterReleased } from "@/server/chapter-release";

/*
 * "Is this chapter released?" has one definition (Phase 28, src/server/chapter-release.ts):
 * a reader query that tests a chapter's status itself would show a scheduled
 * chapter before its time. Only poems may be tested for status = 'published'
 * in these files.
 */
const READER_FILES = ["src/server/board.ts", "src/server/feeds.ts", "src/server/search.ts", "src/app/sitemap.ts", "src/lib/sitemap-entries.ts"];

/** Lines that test a status against 'published' without being about poems. */
export function chapterStatusChecks(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => /status\b\s*(=|,|===)\s*['"`]published['"`]|chapters\.status|"chapters"\."status"/.test(line))
    .filter((line) => !/\bpoems\.status\b|\bp\.status\b|\$\{poems\.status\}/.test(line));
}

describe("reader queries use the one released helper", () => {
  it("no chapter status check in board.ts, feeds.ts, search.ts or the sitemap", () => {
    for (const file of READER_FILES) {
      const source = readFileSync(path.resolve(file), "utf8");
      expect(chapterStatusChecks(source), file).toEqual([]);
    }
  });

  it("the queries that read chapters say chapterReleased", () => {
    for (const file of ["src/server/board.ts", "src/server/feeds.ts", "src/server/search.ts"]) {
      expect(readFileSync(path.resolve(file), "utf8"), file).toContain("chapterReleased(");
    }
  });

  it("the check itself catches the ways a chapter status could be tested (so it can fail)", () => {
    expect(chapterStatusChecks('.where(eq(chapters.status, "published"))')).toHaveLength(1);
    expect(chapterStatusChecks("WHERE c.status = 'published'")).toHaveLength(1);
    expect(chapterStatusChecks("AND ${chapters.status} = 'published'")).toHaveLength(1);
    expect(chapterStatusChecks("WHERE p.status = 'published'")).toEqual([]);
    expect(chapterStatusChecks('.where(and(eq(poems.status, "published"), onboarded))')).toEqual([]);
  });

  it("released means published and its time has come, by the database clock", async () => {
    const r = (await getDb().execute(sql`
      SELECT ${chapterReleased("c")} AS released FROM (VALUES
        ('published'::poem_status, now() - interval '1 second'),
        ('published'::poem_status, now() + interval '1 hour'),
        ('draft'::poem_status, NULL::timestamptz)
      ) AS c(status, release_at)
    `)) as unknown as { rows: { released: boolean }[] };
    expect(r.rows.map((x) => x.released)).toEqual([true, false, false]);
  });
});
