import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { authorShown, novelShown, poemShown } from "@/server/shown";

/*
 * "Can readers see this?" has one definition per table (Phase 32 round 2,
 * src/server/shown.ts): poemShown(), novelShown(), authorShown(). A reader
 * query that tests `status = 'published'` or a pen name itself would show a
 * work the owner hid. Like tests/novels/released-helper.test.ts, but per
 * function: every function in a reader module that reads poems, novels or
 * editors must apply that table's helper, unless it's listed below with why.
 */
const READER_FILES = [
  "src/server/board.ts",
  "src/server/feeds.ts",
  "src/server/search.ts",
  "src/server/short-links.ts",
  "src/server/unlock.ts",
  "src/server/reports.ts",
  "src/server/push.ts",
  "src/server/profile-photos.ts",
  "src/server/novel-covers.ts",
  // Phase 33: what may be featured is what readers can see.
  "src/server/featured.ts",
];

/** Functions in reader modules that read these tables for someone other than readers, or by an id a helper already checked. */
const NOT_READER_QUERIES: Record<string, string> = {
  "unlock.ts:readUnlockedBody": "reads the body by the id loadLock (poemShown, authorShown) just returned",
  "short-links.ts:shareVisitsForEditor": "the writer's own dashboard, scoped by the DAL editor id",
  "reports.ts:recentReports": "the owner's `pnpm reports` listing, which says whether each page is hidden",
  "profile-photos.ts:savePhoto": "the writer's own upload",
  "profile-photos.ts:removePhoto": "the writer's own removal",
  "profile-photos.ts:takeDownPhoto": "the owner's photo takedown",
  "profile-photos.ts:unlink": "the writer's or owner's removal",
  "profile-photos.ts:sweepOrphanPhotos": "the daily cleanup",
  "novel-covers.ts:lockNovel": "the writer's own cover upload, scoped by the editor id",
  "novel-covers.ts:saveCover": "the writer's own upload",
  "novel-covers.ts:removeCover": "the writer's own removal",
  "novel-covers.ts:sweepOrphanCovers": "the daily cleanup",
};

const READS = {
  poems: /from\(poems\)|(inner|left)Join\(poems\b|\$\{poems\}|\b(FROM|JOIN) poems\b/,
  novels: /from\(novels\)|(inner|left)Join\(novels\b|\$\{novels\}|\b(FROM|JOIN) novels\b/,
  editors: /from\(editors\)|(inner|left)Join\(editors\b|\$\{editors\}|\b(FROM|JOIN) editors\b|alias\(editors/,
};
const HELPER = { poems: "poemShown(", novels: "novelShown(", editors: "authorShown(" } as const;

/** Top-level functions (declarations, exported or not) with their source. */
export function functionsOf(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const starts = [...source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    out.push({ name: m[1], body: source.slice(m.index, end) });
  });
  return out;
}

/** The tables a function reads without its helper. */
export function missingHelpers(body: string): string[] {
  return (Object.keys(READS) as (keyof typeof READS)[]).filter((t) => READS[t].test(body) && !body.includes(HELPER[t]));
}

/** Lines testing a poem's status or an author's pen name directly (what the helpers are for). */
export function rawChecks(source: string): string[] {
  return source
    .split("\n")
    .filter((line) =>
      /(poems\.status|\bp\.status|eq\(poems\.status)|pen_name IS NOT NULL|isNotNull\(\w*(editors|Author)\.penName\)|status\b\s*=\s*'published'/i.test(line),
    )
    .filter((line) => !/^\s*(\*|\/\/)/.test(line));
}

describe("reader queries use the shown helpers", () => {
  for (const file of READER_FILES) {
    const source = readFileSync(path.resolve(file), "utf8");
    const base = path.basename(file);

    it(`${base}: every function reading poems, novels or editors applies their helper`, () => {
      const missing = functionsOf(source)
        .filter((f) => !(`${base}:${f.name}` in NOT_READER_QUERIES))
        .flatMap((f) => missingHelpers(f.body).map((t) => `${f.name} reads ${t} without ${HELPER[t as keyof typeof HELPER]})`));
      expect(missing, file).toEqual([]);
    });

    it(`${base}: no poem status or pen name test of its own`, () => {
      expect(rawChecks(source), file).toEqual([]);
    });
  }

  it("the listed exceptions all still exist (so the list can't go stale)", () => {
    for (const key of Object.keys(NOT_READER_QUERIES)) {
      const [file, name] = key.split(":");
      const source = readFileSync(path.resolve("src/server", file), "utf8");
      expect(functionsOf(source).map((f) => f.name), key).toContain(name);
    }
  });

  it("announcements are claimed only for shown work (poems.ts, novels.ts)", () => {
    const poemsSrc = functionsOf(readFileSync(path.resolve("src/server/poems.ts"), "utf8"));
    const novelsSrc = functionsOf(readFileSync(path.resolve("src/server/novels.ts"), "utf8"));
    const body = (fns: { name: string; body: string }[], n: string) => fns.find((f) => f.name === n)!.body;
    expect(body(poemsSrc, "claimAnnouncement")).toContain("poemShown(");
    expect(body(poemsSrc, "claimAnnouncement")).toContain("authorShown(");
    for (const n of ["claimChapterAnnouncement", "claimReleasedChapters"]) {
      expect(body(novelsSrc, n), n).toContain("novelShown(");
      expect(body(novelsSrc, n), n).toContain("authorShown(");
    }
  });

  it("the checks catch what they should (so they can fail)", () => {
    expect(missingHelpers("const r = await db.select().from(poems).where(eq(poems.id, id));")).toEqual(["poems"]);
    expect(missingHelpers("SELECT 1 FROM novels n JOIN editors e ON e.id = n.editor_id")).toEqual(["novels", "editors"]);
    expect(missingHelpers("FROM novels n JOIN editors e WHERE ${novelShown(\"n\")} AND ${authorShown(\"e\")}")).toEqual([]);
    expect(missingHelpers("const a = alias(editors, \"x\");")).toEqual(["editors"]);
    expect(rawChecks('.where(eq(poems.status, "published"))')).toHaveLength(1);
    expect(rawChecks("WHERE p.status = 'published'")).toHaveLength(1);
    expect(rawChecks("AND e.pen_name IS NOT NULL")).toHaveLength(1);
    expect(rawChecks("isNotNull(editors.penName)")).toHaveLength(1);
    expect(rawChecks("isNotNull(poemAuthor.penName)")).toHaveLength(1);
    expect(rawChecks("and(poemShown(), authorShown())")).toEqual([]);
    expect(functionsOf("export async function a() {}\nfunction b() {}\n").map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("shown means published and not hidden (poems), not hidden (novels), a pen name and not hidden (authors)", async () => {
    const r = (await getDb().execute(sql`
      SELECT ${poemShown("p")} AS poem, ${novelShown("p")} AS novel, ${authorShown("p")} AS author FROM (VALUES
        ('published'::poem_status, NULL::timestamptz, 'Ama'),
        ('published'::poem_status, now(), 'Ama'),
        ('draft'::poem_status, NULL::timestamptz, NULL)
      ) AS p(status, hidden_at, pen_name)
    `)) as unknown as { rows: { poem: boolean; novel: boolean; author: boolean }[] };
    expect(r.rows).toEqual([
      { poem: true, novel: true, author: true },
      { poem: false, novel: false, author: false },
      { poem: false, novel: true, author: false },
    ]);
    expect(() => poemShown("p; DROP TABLE poems")).toThrow();
  });
});
