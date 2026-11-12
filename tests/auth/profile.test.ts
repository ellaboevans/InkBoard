import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { getEditorStats } from "@/server/editor-stats";
import { slugify } from "@/lib/slug";
import { getProfile, normalizeLink, setPenName, setPinnedPoem, updateProfile } from "@/server/auth/profile";
import { eq } from "drizzle-orm";

const db = getDb();

describe("slugify", () => {
  it.each([
    ["Emily Dickinson", "emily-dickinson"],
    ["  Rūmī  ", "rumi"],
    ["José Martí!!", "jose-marti"],
    ["李白", "author"],
    ["---", "author"],
  ])("%p -> %p", (input, slug) => expect(slugify(input, "author")).toBe(slug));

  it("uses the given fallback", () => expect(slugify("!!!")).toBe("untitled"));

  it("caps length without a trailing dash", () => {
    const s = slugify("a".repeat(47) + " bcd");
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("setPenName", () => {
  it("validates the pen name", async () => {
    const [e] = await db.insert(editors).values({ email: "a@x.com" }).returning();
    expect(await setPenName(e.id, "a")).toMatchObject({ ok: false });
    expect(await setPenName(e.id, "1234")).toMatchObject({ ok: false });
    expect(await setPenName(e.id, "x".repeat(61))).toMatchObject({ ok: false });
  });

  it("assigns unique slugs per editor and keeps an editor's own slug", async () => {
    const [a, b, c] = await db
      .insert(editors)
      .values([{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@x.com" }])
      .returning();
    expect(await setPenName(a.id, "Rumi")).toEqual({ ok: true, slug: "rumi" });
    expect(await setPenName(b.id, "Rumi")).toEqual({ ok: true, slug: "rumi-2" });
    expect(await setPenName(c.id, "rumi")).toEqual({ ok: true, slug: "rumi-3" });
    // Re-saving keeps the existing slug rather than bumping it.
    expect(await setPenName(a.id, "Rumi")).toEqual({ ok: true, slug: "rumi" });
  });
});

describe("updateProfile", () => {
  async function onboarded(email = "a@x.com", penName = "Rumi") {
    const [e] = await db.insert(editors).values({ email }).returning();
    await setPenName(e.id, penName);
    return e;
  }
  const row = async (id: string) =>
    (await db.select().from(editors).where(eq(editors.id, id)))[0];

  it("renames without changing the slug, so poem links keep working", async () => {
    const e = await onboarded();
    expect(await updateProfile(e.id, { penName: "  Jalal ad-Din  ", bio: "" })).toMatchObject({
      ok: true,
      profile: { penName: "Jalal ad-Din", bio: null },
    });
    expect(await row(e.id)).toMatchObject({ penName: "Jalal ad-Din", slug: "rumi", bio: null });
  });

  it("normalises the bio and clears it when blank", async () => {
    const e = await onboarded();
    await updateProfile(e.id, { penName: "Rumi", bio: "\r\n  Line one\r\nLine two  \n" });
    expect((await row(e.id)).bio).toBe("Line one\nLine two");
    await updateProfile(e.id, { penName: "Rumi", bio: "   " });
    expect((await row(e.id)).bio).toBeNull();
    await updateProfile(e.id, { penName: "Rumi", bio: null });
    expect((await row(e.id)).bio).toBeNull();
  });

  it("rejects invalid input and names the field", async () => {
    const e = await onboarded();
    expect(await updateProfile(e.id, { penName: "a", bio: "" })).toMatchObject({
      ok: false,
      field: "penName",
    });
    expect(await updateProfile(e.id, { penName: "Rumi", bio: "x".repeat(501) })).toMatchObject({
      ok: false,
      field: "bio",
    });
    expect(await updateProfile(e.id, { penName: "Rumi", bio: "x".repeat(500) })).toMatchObject({
      ok: true,
    });
    expect((await row(e.id)).penName).toBe("Rumi");
  });

  it("only changes the given editor, and only once onboarded", async () => {
    const a = await onboarded("a@x.com", "Rumi");
    const b = await onboarded("b@x.com", "Hafez");
    await updateProfile(a.id, { penName: "Shams", bio: "hi" });
    expect(await row(b.id)).toMatchObject({ penName: "Hafez", bio: null });

    const [fresh] = await db.insert(editors).values({ email: "c@x.com" }).returning();
    expect(await updateProfile(fresh.id, { penName: "Sneaky", bio: "" })).toMatchObject({
      ok: false,
    });
    expect(await row(fresh.id)).toMatchObject({ penName: null, slug: null });
  });
});

describe("rich profile fields", () => {
  async function onboarded(email = "a@x.com", penName = "Rumi") {
    const [e] = await db.insert(editors).values({ email }).returning();
    await setPenName(e.id, penName);
    return e;
  }
  async function poem(editorId: string, status: "draft" | "published" = "published") {
    const [p] = await db
      .insert(poems)
      .values({ editorId, title: `T ${Math.random()}`, slug: `t-${Math.random().toString(36).slice(2)}`, body: "b", status })
      .returning();
    return p;
  }

  it("normalises links: https only, no credentials, deduplicated, max 4", () => {
    expect(normalizeLink("example.com/me")).toBe("https://example.com/me");
    expect(normalizeLink(" https://Poets.org ")).toBe("https://poets.org/");
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://user:pw@example.com", "https://localhost", "ftp://x.org", "x".repeat(201)]) {
      expect(normalizeLink(bad), bad).toBeNull();
    }
  });

  it("saves tagline, links, avatar and keeps omitted fields", async () => {
    const e = await onboarded();
    const res = await updateProfile(e.id, {
      penName: "Rumi",
      tagline: "  small   poems  ",
      links: ["example.com", "", "https://example.com/", "https://poets.org/rumi"],
      avatar: "a07",
    });
    expect(res).toMatchObject({
      ok: true,
      profile: { tagline: "small poems", links: ["https://example.com/", "https://poets.org/rumi"], avatar: "a07" },
    });
    // Leaving fields out keeps them.
    await updateProfile(e.id, { penName: "Rumi" });
    expect(await getProfile(e.id)).toMatchObject({ tagline: "small poems", avatar: "a07" });
    // Clearing them.
    expect(await updateProfile(e.id, { penName: "Rumi", tagline: "", links: [], avatar: "" })).toMatchObject({
      ok: true,
      profile: { tagline: null, links: [], avatar: null },
    });
  });

  it("rejects invalid tagline, links and avatar ids", async () => {
    const e = await onboarded();
    expect(await updateProfile(e.id, { penName: "Rumi", tagline: "x".repeat(81) })).toMatchObject({ field: "tagline" });
    expect(await updateProfile(e.id, { penName: "Rumi", links: ["http://insecure.org"] })).toMatchObject({ field: "links" });
    expect(await updateProfile(e.id, { penName: "Rumi", links: ["a.org", "b.org", "c.org", "d.org", "e.org"] })).toMatchObject({ field: "links" });
    expect(await updateProfile(e.id, { penName: "Rumi", avatar: "../../etc" })).toMatchObject({ field: "avatar" });
    expect(await updateProfile(e.id, { penName: "Rumi", avatar: "a99" })).toMatchObject({ field: "avatar" });
  });

  it("pins only the editor's own published poems", async () => {
    const a = await onboarded("a@x.com", "Rumi");
    const b = await onboarded("b@x.com", "Hafez");
    const mine = await poem(a.id);
    const draft = await poem(a.id, "draft");
    const theirs = await poem(b.id);

    expect(await updateProfile(a.id, { penName: "Rumi", pinnedPoemId: theirs.id })).toMatchObject({ field: "pinnedPoemId" });
    expect(await updateProfile(a.id, { penName: "Rumi", pinnedPoemId: draft.id })).toMatchObject({ field: "pinnedPoemId" });
    expect(await updateProfile(a.id, { penName: "Rumi", pinnedPoemId: "nope" })).toMatchObject({ field: "pinnedPoemId" });
    expect(await setPinnedPoem(a.id, theirs.id)).toBe(false);
    expect(await setPinnedPoem(a.id, draft.id)).toBe(false);

    expect(await setPinnedPoem(a.id, mine.id)).toBe(true);
    expect((await getProfile(a.id))?.pinnedPoemId).toBe(mine.id);
    expect(await setPinnedPoem(a.id, null)).toBe(true);
    expect((await getProfile(a.id))?.pinnedPoemId).toBeNull();

    // Deleting the pinned poem unpins it (FK ON DELETE SET NULL).
    await setPinnedPoem(a.id, mine.id);
    await db.delete(poems).where(eq(poems.id, mine.id));
    expect((await getProfile(a.id))?.pinnedPoemId).toBeNull();
  });
});

describe("getEditorStats", () => {
  it("counts only the editor's own poems", async () => {
    const [a, b] = await db.insert(editors).values([{ email: "a@x.com" }, { email: "b@x.com" }]).returning();
    const at = (d: string) => new Date(d);
    await db.insert(poems).values([
      { editorId: a.id, title: "1", slug: "1", body: "b", status: "published", publishedAt: at("2026-01-02") },
      { editorId: a.id, title: "2", slug: "2", body: "b", status: "published", visibility: "private", passwordHash: "x", publishedAt: at("2026-03-04") },
      { editorId: a.id, title: "3", slug: "3", body: "b" },
      { editorId: b.id, title: "4", slug: "4", body: "b", status: "published", publishedAt: at("2026-05-06") },
    ]);
    expect(await getEditorStats(a.id)).toEqual({
      total: 3,
      published: 2,
      drafts: 1,
      privatePublished: 1,
      firstPublishedAt: at("2026-01-02"),
      lastPublishedAt: at("2026-03-04"),
    });
    expect(await getEditorStats("00000000-0000-0000-0000-000000000000")).toMatchObject({ total: 0, lastPublishedAt: null });
  });
});
