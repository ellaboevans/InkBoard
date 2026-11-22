import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, editors } from "@/db/schema";
import { exportToMarkdown } from "@/lib/export-format";
import { SCHEDULE_TOO_LATE, SCHEDULE_TOO_SOON } from "@/lib/chapter-schedule";
import {
  loadAuthorPage,
  loadBoardSections,
  loadNovelPage,
  loadReaderChapter,
  loadShareChapter,
  loadSitemapChapters,
  readerPathExists,
} from "@/server/board";
import { secondsToNextRelease } from "@/server/chapter-release";
import { loadEditorExport } from "@/server/export";
import { loadAuthorFeed, loadNovelFeed, loadSiteFeed } from "@/server/feeds";
import {
  createChapter,
  createNovel,
  getChapter,
  getNovel,
  listNovels,
  publishChapter,
  saveChapter,
  scheduleChapter,
  unpublishChapter,
  updateNovel,
} from "@/server/novels";
import { searchBoard } from "@/server/search";
import { ensureChapterShortCode, resolveShortCode } from "@/server/short-links";
import { getWriterStats } from "@/server/writer-stats";

/*
 * Scheduled chapters (docs/PLAN.md, Phase 28): published with a release time
 * in the future. Readers see nothing of one before its time, exactly like a
 * draft, and all of it from its time, decided by the database clock with
 * nothing running then. "Its time passes" is simulated by moving the release
 * time into the past in SQL.
 */

const db = getDb();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

let ama: string;
let kofi: string;
let ferryId: string;
let thursday: string;
let landing: string;
beforeEach(async () => {
  const [a, k] = await db
    .insert(editors)
    .values([
      { email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama-sewaa" },
      { email: "kofi@example.com", penName: "Kofi", slug: "kofi" },
    ])
    .returning();
  ama = a.id;
  kofi = k.id;
  const ferry = await createNovel(ama, { title: "The Ferry at Yeji", blurb: "Every Thursday." });
  if (!ferry.ok) throw new Error("novel");
  ferryId = ferry.novel.id;
  const one = await createChapter(ama, ferryId, { title: "Thursday", body: "The ferry came late.", status: "published" });
  const two = await createChapter(ama, ferryId, { title: "The Landing", body: "SECRET SCHEDULED TEXT about the landing.", status: "draft" });
  if (!one.ok || !two.ok) throw new Error("chapters");
  thursday = one.chapter.id;
  landing = two.chapter.id;
});

/** Its time comes (in SQL, rather than waiting). */
const release = (id: string) =>
  db.execute(sql`UPDATE chapters SET release_at = now() - interval '1 minute', published_at = now() - interval '1 minute' WHERE id = ${id}`);

async function readerView() {
  const sections = await loadBoardSections();
  const page = await loadNovelPage("ama-sewaa", "the-ferry-at-yeji");
  return {
    book: sections.find((s) => s.slug === "ama-sewaa")?.novels[0] ?? null,
    authorNovels: (await loadAuthorPage("ama-sewaa"))?.novels.map((n) => [n.title, n.chapterCount, n.wordCount]) ?? null,
    pageChapters: page?.chapters.map((c) => [c.number, c.displayTitle]) ?? null,
    pageCounts: page ? [page.chapterCount, page.wordCount] : null,
    chapter: await loadReaderChapter("ama-sewaa", "the-ferry-at-yeji", "the-landing"),
    exists: await readerPathExists({ kind: "chapter", author: "ama-sewaa", novel: "the-ferry-at-yeji", chapter: "the-landing" }),
    sitemap: (await loadSitemapChapters()).map((c) => c.chapterSlug),
    share: await loadShareChapter("ama-sewaa", "the-ferry-at-yeji", "the-landing"),
    feeds: [await loadSiteFeed(), await loadAuthorFeed("ama-sewaa"), await loadNovelFeed("ama-sewaa", "the-ferry-at-yeji")].join("\n"),
  };
}

describe("scheduling: the writer's side", () => {
  it("schedules a draft for a future time: published, released at that time, readers see nothing yet", async () => {
    const at = inDays(2);
    const res = await scheduleChapter(ama, landing, at);
    expect(res).toMatchObject({ ok: true, chapter: { id: landing, slug: "the-landing" } });
    const c = await getChapter(ama, landing);
    expect(c).toMatchObject({ status: "published", scheduled: true });
    expect(c!.releaseAt!.toISOString()).toBe(at);
    // Its first release is that time: readers' dates are right from the release minute.
    expect(c!.publishedAt!.toISOString()).toBe(at);
  });

  it("refuses a time in the past or under the lead time, more than a year ahead, junk, an empty or live chapter", async () => {
    expect(await scheduleChapter(ama, landing, new Date(Date.now() - 60_000).toISOString())).toEqual({ ok: false, error: SCHEDULE_TOO_SOON });
    expect(await scheduleChapter(ama, landing, new Date(Date.now() + 2 * 60_000).toISOString())).toEqual({ ok: false, error: SCHEDULE_TOO_SOON });
    expect(await scheduleChapter(ama, landing, inDays(366))).toEqual({ ok: false, error: SCHEDULE_TOO_LATE });
    expect(await scheduleChapter(ama, landing, "next Friday")).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await scheduleChapter(ama, thursday, inDays(2))).toMatchObject({ ok: false, error: expect.stringContaining("already published") });
    const empty = await createChapter(ama, ferryId, { title: "Empty" });
    if (!empty.ok) throw new Error("empty");
    expect(await scheduleChapter(ama, empty.chapter.id, inDays(2))).toMatchObject({ ok: false, error: expect.stringContaining("empty") });
    // The same checks through the editor's save (which saves the text with the schedule).
    expect(await saveChapter(ama, landing, { title: "The Landing", body: "x", releaseAt: inDays(400) })).toEqual({
      ok: false,
      errors: { releaseAt: SCHEDULE_TOO_LATE },
    });
    expect((await getChapter(ama, landing))!.status).toBe("draft");
  });

  it("another editor's chapter looks missing, and malformed ids are refused before SQL", async () => {
    expect(await scheduleChapter(kofi, landing, inDays(2))).toEqual({ ok: false, notFound: true });
    expect(await saveChapter(kofi, landing, { title: "x", body: "y", releaseAt: inDays(2) })).toEqual({ ok: false, notFound: true });
    expect(await scheduleChapter(ama, "not-an-id", inDays(2))).toEqual({ ok: false, notFound: true });
    expect((await getChapter(ama, landing))!.status).toBe("draft");
  });

  it("an edit keeps the schedule; reschedule moves it; cancel is a draft again, with its slug following the title again", async () => {
    const at = inDays(2);
    await saveChapter(ama, landing, { title: "The Landing", body: "Text.", releaseAt: at });
    // Saving changes ("keep current status": published) keeps the schedule.
    expect(await saveChapter(ama, landing, { title: "The Landing", body: "Edited text.", status: "published" })).toMatchObject({
      ok: true,
      chapter: { scheduled: true },
      announce: false,
    });
    expect((await getChapter(ama, landing))!.releaseAt!.toISOString()).toBe(at);
    // The slug is fixed from scheduling.
    await saveChapter(ama, landing, { title: "At the Landing", body: "Edited text.", status: "published" });
    expect((await getChapter(ama, landing))!.slug).toBe("the-landing");

    const later = inDays(5);
    expect(await scheduleChapter(ama, landing, later)).toMatchObject({ ok: true });
    expect((await getChapter(ama, landing))!.releaseAt!.toISOString()).toBe(later);
    expect((await getChapter(ama, landing))!.publishedAt!.toISOString()).toBe(later);

    expect(await unpublishChapter(ama, landing)).toMatchObject({ ok: true, chapter: { status: "draft", releaseAt: null } });
    const c = await getChapter(ama, landing);
    expect(c).toMatchObject({ status: "draft", scheduled: false, releaseAt: null, publishedAt: null });
    // Never out: cancelling gives it the slug of its title again, and it follows the title from then on.
    expect((await getChapter(ama, landing))!.slug).toBe("at-the-landing");
    await saveChapter(ama, landing, { title: "On the Landing", body: "Edited text." });
    expect((await getChapter(ama, landing))!.slug).toBe("on-the-landing");
  });

  it("Publish now releases it at once and claims its notification there", async () => {
    await scheduleChapter(ama, landing, inDays(2));
    const res = await saveChapter(ama, landing, { title: "The Landing", body: "Text.", status: "published", releaseNow: true });
    expect(res).toMatchObject({ ok: true, chapter: { scheduled: false }, publishedNow: true, announce: true });
    expect(await loadReaderChapter("ama-sewaa", "the-ferry-at-yeji", "the-landing")).not.toBeNull();
    // publishChapter is the same for a scheduled chapter.
    const three = await createChapter(ama, ferryId, { title: "Three", body: "Text." });
    if (!three.ok) throw new Error("three");
    await scheduleChapter(ama, three.chapter.id, inDays(3));
    expect(await publishChapter(ama, three.chapter.id)).toMatchObject({ ok: true, chapter: { scheduled: false }, announce: true });
  });

  it("the chapter list and dashboard count scheduled chapters apart from drafts and published ones", async () => {
    await scheduleChapter(ama, landing, inDays(2));
    await createChapter(ama, ferryId, { title: "Notes" });
    expect((await listNovels(ama))[0]).toMatchObject({ chapterCount: 3, publishedCount: 1, scheduledCount: 1 });
    expect((await getNovel(ama, ferryId))!.chapters.map((c) => [c.title, c.status, c.scheduled])).toEqual([
      ["Thursday", "published", false],
      ["The Landing", "published", true],
      ["Notes", "draft", false],
    ]);
    expect((await getWriterStats(ama)).novels[0]).toMatchObject({ publishedChapters: 1, scheduledChapters: 1, draftChapters: 1 });
    await release(landing);
    expect((await listNovels(ama))[0]).toMatchObject({ publishedCount: 2, scheduledCount: 0 });
    expect((await getWriterStats(ama)).novels[0]).toMatchObject({ publishedChapters: 2, scheduledChapters: 0 });
  });
});

describe("readers see nothing of a scheduled chapter before its time, and all of it from then", () => {
  it("every reader loader, before and after release", async () => {
    const before = await readerView();
    await scheduleChapter(ama, landing, inDays(2));
    // Exactly as while it was a draft: no title, number, count, word total, page, feed entry or sitemap entry.
    const scheduled = await readerView();
    expect(scheduled).toEqual(before);
    expect(scheduled.pageChapters).toEqual([[1, "Thursday"]]);
    expect(scheduled.chapter).toBeNull();
    expect(scheduled.exists).toBe(false);
    expect(scheduled.share).toBeNull();
    expect(scheduled.feeds).not.toContain("The Landing");
    expect(scheduled.feeds).not.toContain("SECRET SCHEDULED TEXT");
    expect(scheduled.sitemap).toEqual(["thursday"]);
    expect(await ensureChapterShortCode(landing)).toBeNull();

    await release(landing);
    const out = await readerView();
    expect(out.pageChapters).toEqual([
      [1, "Thursday"],
      [2, "The Landing"],
    ]);
    expect(out.pageCounts![0]).toBe(2);
    expect(out.book).toMatchObject({ chapterCount: 2 });
    expect(out.chapter).toMatchObject({ number: 2, of: 2, displayTitle: "The Landing", body: "SECRET SCHEDULED TEXT about the landing." });
    expect(out.exists).toBe(true);
    expect(out.sitemap).toEqual(["thursday", "the-landing"]);
    expect(out.share).toMatchObject({ number: 2 });
    expect(out.feeds).toContain("The Landing");
    const code = await ensureChapterShortCode(landing);
    expect(code).toEqual(expect.any(String));
    expect(await resolveShortCode(code!)).toMatchObject({ chapterId: landing, chapterSlug: "the-landing" });
  });

  it("a novel whose only chapter is scheduled appears at that time: board, author page, search", async () => {
    const quiet = await createNovel(ama, { title: "Lighthouse Letters" });
    if (!quiet.ok) throw new Error("novel");
    const only = await createChapter(ama, quiet.novel.id, { title: "One", body: "Dear keeper." });
    if (!only.ok) throw new Error("chapter");
    await scheduleChapter(ama, only.chapter.id, inDays(1));
    const titles = async () => ((await loadBoardSections()).find((s) => s.slug === "ama-sewaa")?.novels ?? []).map((n) => n.title);
    expect(await titles()).toEqual(["The Ferry at Yeji"]);
    expect(await loadNovelPage("ama-sewaa", "lighthouse-letters")).toBeNull();
    expect((await searchBoard("lighthouse")).novels).toEqual([]);
    expect(await readerPathExists({ kind: "novel", author: "ama-sewaa", novel: "lighthouse-letters" })).toBe(false);

    await release(only.chapter.id);
    expect(await titles()).toContain("Lighthouse Letters");
    expect(await loadNovelPage("ama-sewaa", "lighthouse-letters")).not.toBeNull();
    expect((await searchBoard("lighthouse")).novels.map((n) => n.title)).toEqual(["Lighthouse Letters"]);
  });

  it("an author whose only work is a scheduled chapter isn't on the board or in search until then", async () => {
    const book = await createNovel(kofi, { title: "Harmattan" });
    if (!book.ok) throw new Error("novel");
    const c = await createChapter(kofi, book.novel.id, { title: "Dust", body: "Dry wind." });
    if (!c.ok) throw new Error("chapter");
    await scheduleChapter(kofi, c.chapter.id, inDays(1));
    expect((await loadBoardSections()).map((s) => s.slug)).not.toContain("kofi");
    expect((await searchBoard("kofi")).authors).toEqual([]);
    await release(c.chapter.id);
    expect((await loadBoardSections()).map((s) => s.slug)).toContain("kofi");
    expect((await searchBoard("kofi")).authors.map((a) => a.penName)).toEqual(["Kofi"]);
  });

  it("a scheduled chapter never makes a gap in the numbering: later released ones are numbered without it", async () => {
    await scheduleChapter(ama, landing, inDays(2));
    const three = await createChapter(ama, ferryId, { title: "Market Day", body: "Fish.", status: "published" });
    if (!three.ok) throw new Error("three");
    expect((await loadNovelPage("ama-sewaa", "the-ferry-at-yeji"))!.chapters.map((c) => [c.number, c.displayTitle])).toEqual([
      [1, "Thursday"],
      [2, "Market Day"],
    ]);
    await release(landing);
    expect((await loadNovelPage("ama-sewaa", "the-ferry-at-yeji"))!.chapters.map((c) => [c.number, c.displayTitle])).toEqual([
      [1, "Thursday"],
      [2, "The Landing"],
      [3, "Market Day"],
    ]);
  });
});

describe("the cache life follows the next release", () => {
  it("secondsToNextRelease: none, then the soonest scheduled release, by the database clock", async () => {
    expect(await secondsToNextRelease()).toBeNull();
    await scheduleChapter(ama, landing, inDays(2));
    const s = await secondsToNextRelease();
    expect(s).toBeGreaterThan(2 * 86_400 - 120);
    expect(s).toBeLessThanOrEqual(2 * 86_400);
    await db.execute(sql`UPDATE chapters SET release_at = now() + interval '90 seconds', published_at = now() + interval '90 seconds' WHERE id = ${landing}`);
    expect(await secondsToNextRelease()).toBeGreaterThan(80);
    expect(await secondsToNextRelease()).toBeLessThanOrEqual(90);
    await release(landing);
    expect(await secondsToNextRelease()).toBeNull();
  });
});

describe("the writer's download (Phase 28: export version 8)", () => {
  it("JSON carries each chapter's scheduled time; Markdown marks scheduled chapters", async () => {
    const at = inDays(2);
    await scheduleChapter(ama, landing, at);
    const data = await loadEditorExport(ama, { site: "https://inkboard.test" });
    expect(data!.version).toBeGreaterThanOrEqual(8);
    expect(data!.novels[0].chapters.map((c) => [c.title, c.status, c.scheduledFor, c.publishedAt === null])).toEqual([
      ["Thursday", "published", null, false],
      ["The Landing", "scheduled", at, true],
    ]);
    const md = exportToMarkdown(data!);
    expect(md).toContain("2 chapters (1 published, 1 scheduled)");
    expect(md).toContain(`- Scheduled for ${at.slice(0, 10)} ${at.slice(11, 16)} UTC`);
  });
});

describe("the data model", () => {
  it("a published chapter always has a release time, a draft never (a check in the database)", async () => {
    await expect(db.update(chapters).set({ releaseAt: null }).where(eq(chapters.id, thursday))).rejects.toThrow();
    await expect(db.update(chapters).set({ releaseAt: new Date() }).where(eq(chapters.id, landing))).rejects.toThrow();
  });

  it("other writes keep the release: a novel's details, a move", async () => {
    await scheduleChapter(ama, landing, inDays(2));
    expect(await updateNovel(ama, ferryId, { title: "The Ferry at Yeji", blurb: "New blurb." })).toMatchObject({ ok: true });
    expect((await getChapter(ama, landing))!.scheduled).toBe(true);
  });
});
