import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { loadBoardSections, loadReaderPoem } from "@/server/board";

const db = getDb();
const SECRET = "the-secret-stanza-that-must-never-leak";

async function author(email: string, penName: string | null, slug: string | null) {
  const [e] = await db.insert(editors).values({ email, penName, slug }).returning();
  return e.id;
}

async function poem(editorId: string, over: Partial<typeof poems.$inferInsert>) {
  const [p] = await db
    .insert(poems)
    .values({
      editorId,
      title: "Untitled",
      slug: "untitled",
      body: "line",
      status: "published",
      publishedAt: new Date(),
      ...over,
    })
    .returning();
  return p;
}

describe("loadBoardSections", () => {
  it("groups published poems by author, A–Z, newest first", async () => {
    const zed = await author("z@x.com", "Zed", "zed");
    const amy = await author("a@x.com", "amy", "amy");
    await poem(zed, { title: "Z1", slug: "z1" });
    await poem(amy, { title: "Older", slug: "older", publishedAt: new Date("2025-01-01") });
    await poem(amy, { title: "Newer", slug: "newer", publishedAt: new Date("2026-01-01") });

    const sections = await loadBoardSections();
    expect(sections.map((s) => [s.penName, s.slug, s.poems.map((p) => p.title)])).toEqual([
      ["amy", "amy", ["Newer", "Older"]],
      ["Zed", "zed", ["Z1"]],
    ]);
  });

  it("hides drafts, authors without published poems, and un-onboarded editors", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const b = await author("b@x.com", "Only Drafts", "only-drafts");
    const c = await author("c@x.com", null, null);
    await poem(a, { title: "Live", slug: "live" });
    await poem(a, { title: "Draft", slug: "draft", status: "draft", publishedAt: null });
    await poem(b, { title: "Hidden", slug: "hidden", status: "draft", publishedAt: null });
    await poem(c, { title: "Orphan", slug: "orphan" });

    const sections = await loadBoardSections();
    expect(sections.map((s) => s.penName)).toEqual(["Ann"]);
    expect(sections[0].poems.map((p) => p.title)).toEqual(["Live"]);
  });

  it("excerpts public poems by lines and keeps indentation", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await poem(a, { slug: "short", body: "one\n  two" });
    await poem(a, { slug: "long", body: "1\n2\n3\n4\n5\n6\n7", publishedAt: new Date("2020-01-01") });
    const [s] = await loadBoardSections();
    expect(s.poems[0]).toMatchObject({ excerpt: "one\n  two", hasMore: false });
    expect(s.poems[1]).toMatchObject({ excerpt: "1\n2\n3\n4\n5", hasMore: true });
  });

  it("N1: never returns any part of a private poem's text", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await poem(a, {
      title: "Locked",
      slug: "locked",
      body: `${SECRET}\nsecond line`,
      visibility: "private",
      passwordHash: "scrypt$x",
    });
    const sections = await loadBoardSections();
    expect(sections[0].poems[0]).toEqual({
      id: expect.any(String),
      title: "Locked",
      slug: "locked",
      visibility: "private",
      // Like the title, the language is shown for private poems; the text never is.
      language: null,
      excerpt: null,
      hasMore: false,
      collection: null,
    });
    const json = JSON.stringify(sections);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("scrypt");
  });
});

describe("loadReaderPoem", () => {
  it("returns a published public poem in full", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await poem(a, { title: "Full", slug: "full", body: "a\n   b\nc" });
    expect(await loadReaderPoem("ann", "full")).toMatchObject({
      title: "Full",
      penName: "Ann",
      authorSlug: "ann",
      visibility: "public",
      body: "a\n   b\nc",
      publishedAt: expect.stringMatching(/^\d{4}-/),
    });
  });

  it("returns a private poem without its body", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await poem(a, { slug: "p", body: SECRET, visibility: "private", passwordHash: "scrypt$x" });
    const p = await loadReaderPoem("ann", "p");
    expect(p).toMatchObject({ visibility: "private", body: null });
    expect(JSON.stringify(p)).not.toContain(SECRET);
  });

  it("does not find drafts, wrong authors, or unknown slugs", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await author("b@x.com", "Bob", "bob");
    await poem(a, { slug: "d", status: "draft", publishedAt: null });
    await poem(a, { slug: "live" });
    expect(await loadReaderPoem("ann", "d")).toBeNull();
    expect(await loadReaderPoem("bob", "live")).toBeNull();
    expect(await loadReaderPoem("ann", "nope")).toBeNull();
  });
});
