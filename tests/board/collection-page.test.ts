import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { collections, editors, poems } from "@/db/schema";
import { loadAuthorPage, loadBoardSections, loadCollectionPage } from "@/server/board";

// Collections, round 2 (docs/PLAN.md, Phase 14): the public collection page,
// the author page's list, and the board cards' badge.
const db = getDb();
const SECRET = "PRIVATE VERSE NEVER SHOWN";
let wren: string;

beforeEach(async () => {
  const [e] = await db
    .insert(editors)
    .values({ email: "wren-secret@example.com", penName: "Wren Hale", slug: "wren" })
    .returning();
  wren = e.id;
});

/** A collection with poems at positions 1..n (drafts included, like the app keeps them). */
async function seed(
  spec: { title: string; status?: "draft" | "published"; visibility?: "public" | "private"; body?: string; language?: string }[],
  collection = { title: "Harmattan Cycle", slug: "harmattan", intro: "Dry wind, seven days." },
) {
  const [c] = await db.insert(collections).values({ editorId: wren, ...collection }).returning();
  for (const [i, p] of spec.entries()) {
    await db.insert(poems).values({
      editorId: wren,
      title: p.title,
      slug: p.title.toLowerCase().replace(/ /g, "-"),
      body: p.body ?? `${p.title} line one\nline two`,
      status: p.status ?? "published",
      visibility: p.visibility ?? "public",
      passwordHash: p.visibility === "private" ? "x" : null,
      language: p.language,
      publishedAt: (p.status ?? "published") === "published" ? new Date(Date.UTC(2026, 0, i + 1)) : null,
      collectionId: c.id,
      collectionPosition: i + 1,
    });
  }
  return c;
}

describe("loadCollectionPage", () => {
  it("lists published poems in reading order, numbered without drafts", async () => {
    await seed([
      { title: "Dust" },
      { title: "Draft", status: "draft", body: "DRAFT TEXT" },
      { title: "Throat" },
      { title: "Coin", visibility: "private", body: SECRET },
    ]);
    const page = await loadCollectionPage("wren", "harmattan");
    expect(page).toMatchObject({ title: "Harmattan Cycle", slug: "harmattan", intro: "Dry wind, seven days.", penName: "Wren Hale", authorSlug: "wren" });
    expect(page!.poems.map((p) => [p.part, p.title])).toEqual([
      [1, "Dust"],
      [2, "Throat"],
      [3, "Coin"],
    ]);
    expect(page!.poems[0]).toMatchObject({ excerpt: "Dust line one\nline two", collection: { part: 1, parts: 3, slug: "harmattan" } });
    // Private: title only (N1). Drafts and the email never appear.
    expect(page!.poems[2]).toMatchObject({ visibility: "private", excerpt: null, hasMore: false });
    const json = JSON.stringify(page);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("DRAFT TEXT");
    expect(json).not.toContain("Draft");
    expect(json).not.toMatch(/@example\.com|secret/);
  });

  it("follows the editor's order", async () => {
    const c = await seed([{ title: "A" }, { title: "B" }, { title: "C" }]);
    await db.update(poems).set({ collectionPosition: 10 }).where(eq(poems.title, "A"));
    await db.update(poems).set({ collectionPosition: 1 }).where(eq(poems.title, "C"));
    await db.update(poems).set({ collectionPosition: 3 }).where(eq(poems.title, "A"));
    expect((await loadCollectionPage("wren", c.slug))!.poems.map((p) => p.title)).toEqual(["C", "B", "A"]);
  });

  it("is null for unknown slugs, empty or all-draft collections, and authors who haven't onboarded", async () => {
    await seed([{ title: "Only draft", status: "draft" }]);
    expect(await loadCollectionPage("wren", "harmattan")).toBeNull();
    expect(await loadCollectionPage("wren", "nope")).toBeNull();
    expect(await loadCollectionPage("nobody", "harmattan")).toBeNull();
    await db.insert(collections).values({ editorId: wren, title: "Empty", slug: "empty" });
    expect(await loadCollectionPage("wren", "empty")).toBeNull();

    await db.update(editors).set({ penName: null }).where(eq(editors.id, wren));
    await db.update(poems).set({ status: "published" });
    expect(await loadCollectionPage("wren", "harmattan")).toBeNull();
  });

  it("doesn't mix up two authors' collections with the same slug", async () => {
    await seed([{ title: "Wren's" }]);
    const [ama] = await db.insert(editors).values({ email: "ama@example.com", penName: "Ama", slug: "ama" }).returning();
    const [c] = await db.insert(collections).values({ editorId: ama.id, title: "Ama's cycle", slug: "harmattan" }).returning();
    await db.insert(poems).values({ editorId: ama.id, title: "Ama's", slug: "amas", body: "x", status: "published", collectionId: c.id, collectionPosition: 1 });
    expect((await loadCollectionPage("ama", "harmattan"))!.poems.map((p) => p.title)).toEqual(["Ama's"]);
    expect((await loadCollectionPage("wren", "harmattan"))!.poems.map((p) => p.title)).toEqual(["Wren's"]);
  });
});

describe("collection badges and the author page's list", () => {
  it("board cards carry 'title · n/m', counted over published poems", async () => {
    await seed([{ title: "Dust" }, { title: "Draft", status: "draft" }, { title: "Throat" }, { title: "Coin", visibility: "private", body: SECRET }]);
    await db.insert(poems).values({ editorId: wren, title: "Alone", slug: "alone", body: "x", status: "published" });
    const cards = (await loadBoardSections())[0].poems;
    const byTitle = Object.fromEntries(cards.map((p) => [p.title, p.collection]));
    expect(byTitle).toEqual({
      Dust: { title: "Harmattan Cycle", slug: "harmattan", part: 1, parts: 3 },
      Throat: { title: "Harmattan Cycle", slug: "harmattan", part: 2, parts: 3 },
      Coin: { title: "Harmattan Cycle", slug: "harmattan", part: 3, parts: 3 },
      Alone: null,
    });
    expect(JSON.stringify(cards)).not.toContain(SECRET);

    const author = await loadAuthorPage("wren");
    expect(Object.fromEntries(author!.poems.map((p) => [p.title, p.collection?.part ?? null]))).toEqual({ Dust: 1, Throat: 2, Coin: 3, Alone: null });
  });

  it("the author page lists collections with published poems, with counts", async () => {
    await seed([{ title: "Dust" }, { title: "Draft", status: "draft" }, { title: "Throat" }]);
    await seed([{ title: "Hidden draft", status: "draft" }], { title: "All drafts", slug: "drafts", intro: "" });
    await db.insert(collections).values({ editorId: wren, title: "Empty", slug: "empty" });
    expect((await loadAuthorPage("wren"))!.collections).toEqual([
      { title: "Harmattan Cycle", slug: "harmattan", intro: "Dry wind, seven days.", poemCount: 2 },
    ]);
  });
});
