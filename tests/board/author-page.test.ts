import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { loadAuthorPage } from "@/server/board";

const db = getDb();

async function setup() {
  const [e] = await db
    .insert(editors)
    .values({
      email: "secret-email@example.com",
      penName: "Wren Hale",
      slug: "wren-hale",
      tagline: "Small weather",
      bio: "Writes before breakfast.",
      links: ["https://example.com/"],
      avatar: "a05",
    })
    .returning();
  const at = (d: string) => new Date(d);
  const [older, newer, locked] = await db
    .insert(poems)
    .values([
      { editorId: e.id, title: "Older", slug: "older", body: "old line", status: "published", publishedAt: at("2026-01-01") },
      { editorId: e.id, title: "Newer", slug: "newer", body: "new line", status: "published", publishedAt: at("2026-03-01") },
      {
        editorId: e.id, title: "Locked", slug: "locked", body: "TOP SECRET VERSE", status: "published",
        visibility: "private", passwordHash: "x", publishedAt: at("2026-02-01"),
      },
      { editorId: e.id, title: "Draft", slug: "draft", body: "draft text" },
    ])
    .returning();
  return { e, older, newer, locked };
}

describe("loadAuthorPage", () => {
  it("returns the public profile and published poems, never private text or the email", async () => {
    await setup();
    const page = (await loadAuthorPage("wren-hale"))!;
    expect(page).toMatchObject({ penName: "Wren Hale", tagline: "Small weather", bio: "Writes before breakfast.", links: ["https://example.com/"], avatar: "a05" });
    expect(page.poems.map((p) => p.title)).toEqual(["Newer", "Locked", "Older"]);
    const locked = page.poems.find((p) => p.slug === "locked")!;
    expect(locked).toMatchObject({ visibility: "private", excerpt: null, hasMore: false });
    const json = JSON.stringify(page);
    expect(json).not.toContain("TOP SECRET");
    expect(json).not.toContain("draft text");
    expect(json).not.toContain("secret-email");
    expect(json).not.toContain("password");
  });

  it("puts the pinned poem first, and ignores it once unpublished", async () => {
    const { e, older } = await setup();
    await db.update(editors).set({ pinnedPoemId: older.id }).where(eq(editors.id, e.id));
    let page = (await loadAuthorPage("wren-hale"))!;
    expect(page.poems[0]).toMatchObject({ slug: "older", pinned: true });
    expect(page.poems.filter((p) => p.pinned)).toHaveLength(1);

    await db.update(poems).set({ status: "draft" }).where(eq(poems.id, older.id));
    page = (await loadAuthorPage("wren-hale"))!;
    expect(page.poems.some((p) => p.pinned)).toBe(false);
    expect(page.poems.map((p) => p.slug)).not.toContain("older");
  });

  it("is null for unknown or not-yet-onboarded authors", async () => {
    await db.insert(editors).values({ email: "new@example.com", slug: "half-done" });
    expect(await loadAuthorPage("nobody")).toBeNull();
    expect(await loadAuthorPage("half-done")).toBeNull();
  });
});
