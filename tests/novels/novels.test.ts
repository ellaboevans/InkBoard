import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapterRevisions, chapters, editors, novels } from "@/db/schema";
import {
  BLURB_MAX,
  CHAPTER_BODY_MAX,
  CHAPTER_REVISIONS_KEPT,
  CHAPTER_TITLE_MAX,
  CHAPTERS_MAX,
  NOVEL_TITLE_MAX,
  NOVELS_MAX,
} from "@/lib/novel-limits";
import {
  createChapter,
  createNovel,
  deleteChapter,
  deleteNovel,
  getChapter,
  getNovel,
  listChapterRevisions,
  listNovels,
  moveChapter,
  publishChapter,
  reorderChapters,
  saveChapter,
  unpublishChapter,
  updateNovel,
} from "@/server/novels";

const db = getDb();
let ada: string;
let eve: string;

beforeEach(async () => {
  const rows = await db
    .insert(editors)
    .values([
      { email: "ada@example.com", penName: "Ada", slug: "ada" },
      { email: "eve@example.com", penName: "Eve", slug: "eve" },
    ])
    .returning();
  [ada, eve] = rows.map((r) => r.id);
});

async function novel(editorId: string, title = "The Ferry at Yeji", over: Record<string, unknown> = {}) {
  const res = await createNovel(editorId, { title, ...over });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res.novel;
}

async function chapter(editorId: string, novelId: string, over: Record<string, unknown> = {}) {
  const res = await createChapter(editorId, novelId, { title: "Thursday", body: "The ferry came.", ...over });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res.chapter;
}

/** Positions of the novel's chapters, by title, in order. */
async function order(novelId: string) {
  const rows = await db
    .select({ title: chapters.title, position: chapters.position })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.position));
  expect(rows.map((r) => r.position), "positions 1..n").toEqual(rows.map((_, i) => i + 1));
  return rows.map((r) => r.title);
}

const MISSING = "00000000-0000-4000-8000-000000000000";

describe("novels: create, update, delete (Phase 23a)", () => {
  it("creates a novel with a slug from its title, NFC text and defaults", async () => {
    const res = await createNovel(ada, {
      title: "  Ɔdɔ ne Asuo  ",
      blurb: "  Every Thursday…\r\nthe ferry.  ",
      language: "ak",
    });
    expect(res).toMatchObject({ ok: true, novel: { slug: "odo-ne-asuo" } });
    const got = await getNovel(ada, (res as { novel: { id: string } }).novel.id);
    expect(got).toMatchObject({ title: "Ɔdɔ ne Asuo", blurb: "Every Thursday…\nthe ferry.", language: "ak", status: "ongoing", chapters: [] });
    expect(got!.title).toBe(got!.title.normalize("NFC"));
  });

  it("validates title, blurb, language and status", async () => {
    expect(await createNovel(ada, { title: "  " })).toMatchObject({ ok: false, errors: { title: "Give your novel a title" } });
    expect(await createNovel(ada, { title: "x".repeat(NOVEL_TITLE_MAX + 1) })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    expect(await createNovel(ada, { title: "T", blurb: "b".repeat(BLURB_MAX + 1) })).toMatchObject({ ok: false, errors: { blurb: "The blurb can be at most 2,000 characters" } });
    expect(await createNovel(ada, { title: "T", blurb: "b".repeat(BLURB_MAX) })).toMatchObject({ ok: true });
    expect(await createNovel(ada, { title: "T", language: "klingon" })).toMatchObject({ ok: false, errors: { language: expect.any(String) } });
    expect(await createNovel(ada, { title: "T", status: "abandoned" })).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
  });

  it(`stops at ${NOVELS_MAX} novels per editor`, async () => {
    await db.insert(novels).values(Array.from({ length: NOVELS_MAX }, (_, i) => ({ editorId: ada, title: `N${i}`, slug: `n${i}` })));
    expect(await createNovel(ada, { title: "One more" })).toEqual({ ok: false, errors: { form: `You can have at most ${NOVELS_MAX} novels` } });
    expect(await createNovel(eve, { title: "Eve's first" })).toMatchObject({ ok: true });
  });

  it("updates title, blurb, language and status; deleting removes chapters and versions", async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id);
    expect(await updateNovel(ada, n.id, { title: "The Ferry", blurb: "", language: "", status: "complete" })).toMatchObject({ ok: true });
    expect(await getNovel(ada, n.id)).toMatchObject({ title: "The Ferry", blurb: null, language: null, status: "complete" });
    expect(await deleteNovel(ada, n.id)).toBe(true);
    expect(await db.select().from(chapters).where(eq(chapters.id, c.id))).toEqual([]);
    expect(await db.select().from(chapterRevisions).where(eq(chapterRevisions.chapterId, c.id))).toEqual([]);
    expect(await deleteNovel(ada, n.id)).toBe(false);
  });
});

describe("scoping: another editor's novel or chapter behaves as missing", () => {
  it("every read and write", async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id);
    const nf = { ok: false, notFound: true };
    expect(await getNovel(eve, n.id)).toBeNull();
    expect(await getChapter(eve, c.id)).toBeNull();
    expect(await listNovels(eve)).toEqual([]);
    expect(await listChapterRevisions(eve, c.id)).toEqual([]);
    expect(await updateNovel(eve, n.id, { title: "Mine now" })).toEqual(nf);
    expect(await createChapter(eve, n.id, { title: "Planted" })).toEqual(nf);
    expect(await saveChapter(eve, c.id, { title: "Changed", body: "x" })).toEqual(nf);
    expect(await publishChapter(eve, c.id)).toEqual(nf);
    expect(await unpublishChapter(eve, c.id)).toEqual(nf);
    expect(await moveChapter(eve, n.id, c.id, "up")).toEqual(nf);
    expect(await reorderChapters(eve, n.id, [c.id])).toEqual(nf);
    expect(await deleteChapter(eve, c.id)).toBe(false);
    expect(await deleteNovel(eve, n.id)).toBe(false);
    // A chapter of Ada's can't be moved through Eve's novel either.
    const theirs = await novel(eve, "Eve's");
    expect(await moveChapter(eve, theirs.id, c.id, "first")).toEqual(nf);
    // Nothing changed.
    expect(await getNovel(ada, n.id)).toMatchObject({ title: "The Ferry at Yeji", chapters: [{ id: c.id, title: "Thursday", status: "draft" }] });
  });

  it("malformed and unknown ids are missing, before any SQL", async () => {
    for (const id of ["", "nope", "1; DROP TABLE novels", MISSING]) {
      expect(await getNovel(ada, id)).toBeNull();
      expect(await getChapter(ada, id)).toBeNull();
      expect(await saveChapter(ada, id, { body: "x" })).toEqual({ ok: false, notFound: true });
      expect(await createChapter(ada, id, {})).toEqual({ ok: false, notFound: true });
      expect(await deleteChapter(ada, id)).toBe(false);
    }
    const n = await novel(ada);
    expect(await reorderChapters(ada, n.id, ["nope"])).toEqual({ ok: false, notFound: true });
    expect(await reorderChapters(ada, n.id, "not an array")).toEqual({ ok: false, notFound: true });
    expect(await moveChapter(ada, n.id, MISSING, "sideways" as never)).toEqual({ ok: false, notFound: true });
  });
});

describe("slugs", () => {
  it("a novel's follows its title while no chapter was ever published, then stays fixed", async () => {
    const n = await novel(ada, "Draft Title");
    expect(await updateNovel(ada, n.id, { title: "Better Title" })).toMatchObject({ ok: true, novel: { slug: "better-title" } });
    const c = await chapter(ada, n.id);
    expect(await updateNovel(ada, n.id, { title: "Still a Draft" })).toMatchObject({ novel: { slug: "still-a-draft" } });
    await publishChapter(ada, c.id);
    expect(await updateNovel(ada, n.id, { title: "Published Now" })).toMatchObject({ novel: { slug: "still-a-draft" } });
    // Unpublishing doesn't free it: links went out.
    await unpublishChapter(ada, c.id);
    expect(await updateNovel(ada, n.id, { title: "Withdrawn" })).toMatchObject({ novel: { slug: "still-a-draft" } });
  });

  it("a chapter's follows its title while a draft, then stays fixed; an empty title is 'chapter'", async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id, { title: "" });
    expect(c.slug).toBe("chapter");
    expect(await saveChapter(ada, c.id, { title: "The Radio", body: "x" })).toMatchObject({ chapter: { slug: "the-radio" } });
    expect(await saveChapter(ada, c.id, { title: "The Radio", body: "x", status: "published" })).toMatchObject({ publishedNow: true });
    expect(await saveChapter(ada, c.id, { title: "The Green Radio", body: "x" })).toMatchObject({ chapter: { slug: "the-radio" } });
    await unpublishChapter(ada, c.id);
    expect(await saveChapter(ada, c.id, { title: "Renamed Again", body: "x" })).toMatchObject({ chapter: { slug: "the-radio" } });
    // Empty titles get chapter, chapter-2, …
    expect((await chapter(ada, n.id, { title: "" })).slug).toBe("chapter");
    expect((await chapter(ada, n.id, { title: "" })).slug).toBe("chapter-2");
  });

  it("unique per editor for novels and per novel for chapters", async () => {
    expect((await novel(ada, "Same")).slug).toBe("same");
    expect((await novel(ada, "Same")).slug).toBe("same-2");
    expect((await novel(eve, "Same")).slug).toBe("same"); // another editor's
    const a = await novel(ada, "Book A");
    const b = await novel(ada, "Book B");
    expect((await chapter(ada, a.id, { title: "One" })).slug).toBe("one");
    expect((await chapter(ada, a.id, { title: "One" })).slug).toBe("one-2");
    expect((await chapter(ada, b.id, { title: "One" })).slug).toBe("one"); // another novel's
  });

  it("stay unique under concurrency (Promise.all)", async () => {
    const made = await Promise.all(Array.from({ length: 6 }, () => createNovel(ada, { title: "Race" })));
    expect(made.every((r) => r.ok)).toBe(true);
    expect(made.map((r) => (r as { novel: { slug: string } }).novel.slug).sort()).toEqual(["race", "race-2", "race-3", "race-4", "race-5", "race-6"]);
    const n = await novel(ada, "Chapters race");
    const cs = await Promise.all(Array.from({ length: 6 }, () => createChapter(ada, n.id, { title: "Same" })));
    expect(cs.map((r) => (r as { chapter: { slug: string } }).chapter.slug).sort()).toEqual(["same", "same-2", "same-3", "same-4", "same-5", "same-6"]);
    // Drafts retitled to one title at once.
    const ids = cs.map((r) => (r as { chapter: { id: string } }).chapter.id);
    const renamed = await Promise.all(ids.map((id) => saveChapter(ada, id, { title: "Clash", body: "x" })));
    expect(new Set(renamed.map((r) => (r as { chapter: { slug: string } }).chapter.slug)).size).toBe(6);
  });
});

describe("positions stay 1..n", () => {
  it("after adds, moves, reorders and deletes", async () => {
    const n = await novel(ada);
    const [a, b, c, d] = [await chapter(ada, n.id, { title: "A" }), await chapter(ada, n.id, { title: "B" }), await chapter(ada, n.id, { title: "C" }), await chapter(ada, n.id, { title: "D" })];
    expect([a, b, c, d].map((x) => x.position)).toEqual([1, 2, 3, 4]);
    expect(await moveChapter(ada, n.id, d.id, "first")).toEqual({ ok: true, position: 1, total: 4 });
    expect(await order(n.id)).toEqual(["D", "A", "B", "C"]);
    expect(await moveChapter(ada, n.id, d.id, "up")).toEqual({ ok: true, position: 1, total: 4 }); // already first
    await moveChapter(ada, n.id, a.id, "down");
    expect(await order(n.id)).toEqual(["D", "B", "A", "C"]);
    await moveChapter(ada, n.id, d.id, "last");
    expect(await order(n.id)).toEqual(["B", "A", "C", "D"]);
    expect(await reorderChapters(ada, n.id, [c.id, d.id, a.id, b.id])).toEqual({ ok: true });
    expect(await order(n.id)).toEqual(["C", "D", "A", "B"]);
    expect(await deleteChapter(ada, d.id)).toBe(true);
    expect(await order(n.id)).toEqual(["C", "A", "B"]);
    expect((await chapter(ada, n.id, { title: "E" })).position).toBe(4);
  });

  it("a stale whole order changes nothing", async () => {
    const n = await novel(ada);
    const a = await chapter(ada, n.id, { title: "A" });
    const b = await chapter(ada, n.id, { title: "B" });
    await chapter(ada, n.id, { title: "C" }); // added since the page loaded
    expect(await reorderChapters(ada, n.id, [b.id, a.id])).toEqual({ ok: false, stale: true });
    expect(await reorderChapters(ada, n.id, [b.id, a.id, a.id])).toEqual({ ok: false, notFound: true });
    expect(await order(n.id)).toEqual(["A", "B", "C"]);
  });

  it("under concurrent adds, moves and deletes", async () => {
    const n = await novel(ada);
    const first = await Promise.all(Array.from({ length: 8 }, (_, i) => createChapter(ada, n.id, { title: `C${i}` })));
    const ids = first.map((r) => (r as { chapter: { id: string } }).chapter.id);
    await order(n.id);
    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => createChapter(ada, n.id, { title: `New${i}` })),
      moveChapter(ada, n.id, ids[0], "last"),
      moveChapter(ada, n.id, ids[7], "first"),
      deleteChapter(ada, ids[3]),
      deleteChapter(ada, ids[4]),
      saveChapter(ada, ids[1], { title: "Edited", body: "words", status: "published" }),
    ]);
    const titles = await order(n.id); // asserts 1..n
    expect(titles).toHaveLength(8 + 5 - 2);
  });
});

describe("chapters: saving, publishing, limits", () => {
  it("drafts may be empty; publishing needs text; publishedNow only the first time", async () => {
    const n = await novel(ada);
    const empty = await chapter(ada, n.id, { title: "", body: "" });
    expect(await publishChapter(ada, empty.id)).toEqual({ ok: false, errors: { body: "The chapter is empty: write something before publishing it" } });
    expect(await createChapter(ada, n.id, { body: "  \n ", status: "published" })).toMatchObject({ ok: false, errors: { body: expect.any(String) } });
    await saveChapter(ada, empty.id, { title: "", body: "Now there are words here." });
    expect(await publishChapter(ada, empty.id)).toMatchObject({ ok: true, chapter: { status: "published" }, publishedNow: true });
    const first = (await getChapter(ada, empty.id))!.publishedAt;
    expect(await unpublishChapter(ada, empty.id)).toMatchObject({ ok: true, chapter: { status: "draft" }, publishedNow: false });
    expect(await publishChapter(ada, empty.id)).toMatchObject({ publishedNow: false });
    // published_at is the first publish, kept through unpublishing.
    expect((await getChapter(ada, empty.id))!.publishedAt).toEqual(first);
  });

  it("stores prose NFC with line endings normalised, and counts words", async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id, { title: "Ŋkeke", body: "Akosua sé: “Ɔdɔ.”\r\n\r\n* * *\r\n\r\nDone now.  " });
    const got = (await getChapter(ada, c.id))!;
    expect(got.body).toBe("Akosua sé: “Ɔdɔ.”\n\n* * *\n\nDone now.");
    expect(got.body).toBe(got.body.normalize("NFC"));
    expect(got.wordCount).toBe(5);
  });

  it("limits: chapter text, chapter title, chapters per novel", async () => {
    const n = await novel(ada);
    expect(await createChapter(ada, n.id, { body: "a".repeat(CHAPTER_BODY_MAX + 1) })).toEqual({ ok: false, errors: { body: "A chapter can be at most 60,000 characters" } });
    expect(await createChapter(ada, n.id, { body: "a".repeat(CHAPTER_BODY_MAX) })).toMatchObject({ ok: true });
    expect(await createChapter(ada, n.id, { title: "t".repeat(CHAPTER_TITLE_MAX + 1) })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    const full = await novel(ada, "Long");
    await db.insert(chapters).values(Array.from({ length: CHAPTERS_MAX }, (_, i) => ({ novelId: full.id, title: "", slug: `c${i}`, position: i + 1 })));
    expect(await createChapter(ada, full.id, { title: "201" })).toEqual({ ok: false, errors: { form: "A novel can have at most 200 chapters" } });
  });

  it("listNovels counts chapters and published ones", async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id);
    await chapter(ada, n.id, { title: "Two" });
    await publishChapter(ada, c.id);
    expect(await listNovels(ada)).toMatchObject([{ id: n.id, chapterCount: 2, publishedCount: 1 }]);
  });
});

describe("revisions", () => {
  it("are recorded only when the title or text changes", async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id, { title: "One", body: "First." });
    expect(await listChapterRevisions(ada, c.id)).toHaveLength(1);
    await saveChapter(ada, c.id, { title: "One", body: "First." }); // no change
    await publishChapter(ada, c.id);
    await saveChapter(ada, c.id, { title: "One", body: "First.  \r\n" }); // the same once normalised
    expect(await listChapterRevisions(ada, c.id)).toHaveLength(1);
    await saveChapter(ada, c.id, { title: "One", body: "Second." });
    await saveChapter(ada, c.id, { title: "Uno", body: "Second." });
    expect((await listChapterRevisions(ada, c.id)).map((r) => [r.title, r.body])).toEqual([
      ["Uno", "Second."],
      ["One", "Second."],
      ["One", "First."],
    ]);
    // An empty new draft starts with no history; its first real save records the empty state first.
    const blank = await chapter(ada, n.id, { title: "", body: "" });
    expect(await listChapterRevisions(ada, blank.id)).toEqual([]);
    await saveChapter(ada, blank.id, { body: "Words." });
    expect((await listChapterRevisions(ada, blank.id)).map((r) => r.body)).toEqual(["Words.", ""]);
  });

  it(`are pruned to the newest ${CHAPTER_REVISIONS_KEPT}`, async () => {
    const n = await novel(ada);
    const c = await chapter(ada, n.id, { body: "v0" });
    for (let i = 1; i <= 14; i++) await saveChapter(ada, c.id, { title: "Thursday", body: `v${i}` });
    const kept = await listChapterRevisions(ada, c.id);
    expect(kept.map((r) => r.body)).toEqual(Array.from({ length: CHAPTER_REVISIONS_KEPT }, (_, i) => `v${14 - i}`));
    const [{ n: rows }] = ((await db.execute(sql`SELECT count(*)::int AS n FROM chapter_revisions`)) as unknown as { rows: { n: number }[] }).rows;
    expect(rows).toBe(CHAPTER_REVISIONS_KEPT);
  });
});

describe("chapter versions never reach readers", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });

  it("only novels.ts (and the schema) reference chapter_revisions", () => {
    const using = files("src").filter((f) => /chapterRevisions|chapter_revisions/.test(readFileSync(f, "utf8")));
    expect(using.sort()).toEqual(["src/db/schema.ts", "src/server/novels.ts"]);
  });
});
