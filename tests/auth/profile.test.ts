import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { slugify } from "@/lib/slug";
import { setPenName, updateProfile } from "@/server/auth/profile";
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
    expect(await updateProfile(e.id, { penName: "  Jalal ad-Din  ", bio: "" })).toEqual({
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
