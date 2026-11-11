import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { setPenName, slugify } from "@/server/auth/profile";

const db = getDb();

describe("slugify", () => {
  it.each([
    ["Emily Dickinson", "emily-dickinson"],
    ["  Rūmī  ", "rumi"],
    ["José Martí!!", "jose-marti"],
    ["李白", "author"],
    ["---", "author"],
  ])("%p -> %p", (input, slug) => expect(slugify(input)).toBe(slug));

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
