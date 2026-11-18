import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems } from "@/db/schema";
import { countWords } from "@/lib/prose";
import { loadAuthorPage, loadBoardSections, loadNovelPage, loadReaderChapter } from "@/server/board";

/*
 * The reader loaders for novels (docs/PLAN.md, Phase 23b), against real SQL:
 * published chapters only, numbered 1..n without drafts, counts and reading
 * times over published chapters only, a novel with nothing published is
 * null everywhere, another author's slug is null, and no email or draft
 * (title, text or count) ever reaches the JSON.
 */
const db = getDb();

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const at = (d: string) => new Date(d);

async function setup() {
  const [ama] = await db
    .insert(editors)
    .values({ email: "ama-secret@example.com", penName: "Ama Serwaa", slug: "ama" })
    .returning();
  const [kofi] = await db
    .insert(editors)
    .values({ email: "kofi-secret@example.com", penName: "Kofi", slug: "kofi" })
    .returning();
  const [ferry] = await db
    .insert(novels)
    .values({
      editorId: ama.id,
      title: "The Ferry at Yeji",
      slug: "the-ferry",
      blurb: "Every Thursday the ferry crosses the lake.\nSecond paragraph of the blurb.",
      language: "en",
    })
    .returning();
  const [unfinished] = await db
    .insert(novels)
    .values({ editorId: ama.id, title: "Only Drafts", slug: "only-drafts" })
    .returning();
  const [kofis] = await db.insert(novels).values({ editorId: kofi.id, title: "Kofi's Book", slug: "kofis-book" }).returning();

  const chapter = (over: Partial<typeof chapters.$inferInsert> & { novelId: string; slug: string; position: number }) => {
    const body = over.body ?? words(460);
    return {
      title: over.slug,
      status: "published" as const,
      publishedAt: at("2026-10-02"),
      ...over,
      body,
      wordCount: countWords(body),
    };
  };
  // Reading order: Thursday, (draft), The Landing, (once published, now a draft), [untitled].
  await db.insert(chapters).values([
    chapter({ novelId: ferry.id, slug: "thursday", title: "Thursday", position: 1, publishedAt: at("2026-10-02") }),
    chapter({
      novelId: ferry.id, slug: "draft-chapter", title: "SECRET DRAFT TITLE", position: 2,
      body: "SECRET DRAFT TEXT " + words(9000), status: "draft", publishedAt: null,
    }),
    chapter({ novelId: ferry.id, slug: "the-landing", title: "The Landing", position: 3, body: words(2300), publishedAt: at("2026-10-09") }),
    chapter({
      novelId: ferry.id, slug: "pulled", title: "PULLED TITLE", position: 4,
      body: "PULLED TEXT", status: "draft", publishedAt: at("2026-10-12"),
    }),
    chapter({ novelId: ferry.id, slug: "chapter", title: "", position: 5, body: words(100), publishedAt: at("2026-10-16") }),
    chapter({ novelId: unfinished.id, slug: "draft-only", title: "DRAFT ONLY", position: 1, status: "draft", publishedAt: null }),
    chapter({ novelId: kofis.id, slug: "one", title: "One", position: 1, publishedAt: at("2026-09-01") }),
  ]);
  await db.insert(poems).values({ editorId: ama.id, title: "A Poem", slug: "a-poem", body: "a line", status: "published", publishedAt: at("2026-08-01") });
  return { ama, kofi, ferry, unfinished, kofis };
}

const noDrafts = (json: string) => {
  for (const secret of ["SECRET DRAFT", "PULLED", "DRAFT ONLY", "only-drafts", "draft-chapter", "-secret@", "Only Drafts"]) {
    expect(json, secret).not.toContain(secret);
  }
};

describe("loadNovelPage", () => {
  it("lists published chapters only, numbered 1..n without drafts, with words and reading times over them", async () => {
    const { ferry } = await setup();
    const page = (await loadNovelPage("ama", "the-ferry"))!;
    expect(page).toMatchObject({
      id: ferry.id,
      title: "The Ferry at Yeji",
      penName: "Ama Serwaa",
      authorSlug: "ama",
      language: "en",
      status: "ongoing",
      chapterCount: 3,
      wordCount: 460 + 2300 + 100,
      readingMinutes: Math.round(2860 / 230),
      // The latest published chapter's first publish.
      updatedAt: at("2026-10-16").toISOString(),
      blurb: "Every Thursday the ferry crosses the lake.",
      fullBlurb: "Every Thursday the ferry crosses the lake.\nSecond paragraph of the blurb.",
    });
    expect(page.chapters.map((c) => [c.number, c.displayTitle, c.slug, c.readingMinutes])).toEqual([
      [1, "Thursday", "thursday", 2],
      [2, "The Landing", "the-landing", 10],
      // No title of its own: named by its reader number, not its position (5).
      [3, "Chapter 3", "chapter", 1],
    ]);
    noDrafts(JSON.stringify(page));
  });

  it("is null for a novel with no published chapter, another author's slug, an unknown slug or author", async () => {
    await setup();
    expect(await loadNovelPage("ama", "only-drafts")).toBeNull();
    expect(await loadNovelPage("ama", "kofis-book")).toBeNull();
    expect(await loadNovelPage("kofi", "the-ferry")).toBeNull();
    expect(await loadNovelPage("ama", "nope")).toBeNull();
    expect(await loadNovelPage("nobody", "the-ferry")).toBeNull();
    expect(await loadNovelPage("kofi", "kofis-book")).not.toBeNull();
  });

  it("disappears once its last published chapter is unpublished, and isn't shown for an author without a pen name", async () => {
    const { kofi, kofis } = await setup();
    await db.update(chapters).set({ status: "draft" }).where(eq(chapters.novelId, kofis.id));
    expect(await loadNovelPage("kofi", "kofis-book")).toBeNull();
    await db.update(chapters).set({ status: "published" }).where(eq(chapters.novelId, kofis.id));
    await db.update(editors).set({ penName: null }).where(eq(editors.id, kofi.id));
    expect(await loadNovelPage("kofi", "kofis-book")).toBeNull();
  });
});

describe("loadReaderChapter", () => {
  it("gives a published chapter its text, its number among published chapters and its published neighbours", async () => {
    const { ferry } = await setup();
    const c = (await loadReaderChapter("ama", "the-ferry", "the-landing"))!;
    expect(c).toMatchObject({
      number: 2,
      of: 3,
      displayTitle: "The Landing",
      slug: "the-landing",
      novel: { id: ferry.id, title: "The Ferry at Yeji", slug: "the-ferry", language: "en", status: "ongoing" },
      penName: "Ama Serwaa",
      // Neighbours skip the drafts on either side.
      prev: { number: 1, displayTitle: "Thursday", slug: "thursday" },
      next: { number: 3, displayTitle: "Chapter 3", slug: "chapter" },
    });
    expect(c.body).toBe(words(2300));
    noDrafts(JSON.stringify(c));

    const first = (await loadReaderChapter("ama", "the-ferry", "thursday"))!;
    expect([first.number, first.prev, first.next?.slug]).toEqual([1, null, "the-landing"]);
    const last = (await loadReaderChapter("ama", "the-ferry", "chapter"))!;
    expect([last.number, last.prev?.slug, last.next]).toEqual([3, "the-landing", null]);
  });

  it("is null for a draft, a chapter unpublished after publishing, another novel's or author's chapter, and unknown slugs", async () => {
    await setup();
    expect(await loadReaderChapter("ama", "the-ferry", "draft-chapter")).toBeNull();
    expect(await loadReaderChapter("ama", "the-ferry", "pulled")).toBeNull();
    expect(await loadReaderChapter("ama", "only-drafts", "draft-only")).toBeNull();
    expect(await loadReaderChapter("ama", "the-ferry", "one")).toBeNull();
    expect(await loadReaderChapter("ama", "kofis-book", "one")).toBeNull();
    expect(await loadReaderChapter("kofi", "the-ferry", "thursday")).toBeNull();
    expect(await loadReaderChapter("ama", "the-ferry", "nope")).toBeNull();
  });
});

describe("novels on the board and the author page", () => {
  it("puts published novels in their author's section, with published counts only; draft-only novels nowhere", async () => {
    const { ama, ferry } = await setup();
    const sections = await loadBoardSections();
    const amaSection = sections.find((s) => s.editorId === ama.id)!;
    expect(amaSection.novels).toEqual([
      {
        id: ferry.id,
        title: "The Ferry at Yeji",
        slug: "the-ferry",
        language: "en",
        status: "ongoing",
        visibility: "public",
        coverKey: null,
        blurb: "Every Thursday the ferry crosses the lake.",
        chapterCount: 3,
        wordCount: 2860,
        readingMinutes: 12,
        updatedAt: at("2026-10-16").toISOString(),
      },
    ]);
    expect(amaSection.poems.map((p) => p.slug)).toEqual(["a-poem"]);
    // Kofi has a novel and no poems: still a section.
    expect(sections.map((s) => s.penName)).toEqual(["Ama Serwaa", "Kofi"]);
    expect(sections[1]).toMatchObject({ poems: [], novels: [{ slug: "kofis-book", chapterCount: 1 }] });
    noDrafts(JSON.stringify(sections));
  });

  it("drops an author whose only work is a novel with nothing published", async () => {
    const { kofis } = await setup();
    await db.update(chapters).set({ status: "draft" }).where(eq(chapters.novelId, kofis.id));
    const sections = await loadBoardSections();
    expect(sections.map((s) => s.penName)).toEqual(["Ama Serwaa"]);
  });

  it("lists the author's published novels on their page, never drafts or another author's", async () => {
    await setup();
    const page = (await loadAuthorPage("ama"))!;
    expect(page.novels.map((n) => [n.slug, n.chapterCount, n.wordCount])).toEqual([["the-ferry", 3, 2860]]);
    noDrafts(JSON.stringify(page));
    expect(JSON.stringify(page)).not.toContain("Kofi");
    expect((await loadAuthorPage("kofi"))!.novels.map((n) => n.slug)).toEqual(["kofis-book"]);
  });
});
