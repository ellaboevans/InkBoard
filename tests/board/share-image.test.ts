import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { loadSharePoem } from "@/server/board";
import { renderShareImage } from "@/server/share-image";

/*
 * The share image's loader (docs/PLAN.md, Phase 21): a published public poem
 * by an author with a pen name, scoped by author slug like the board's
 * loaders. Everything else is the same null (one 404), and a private poem's
 * text is never selected (N1).
 */

const db = getDb();
const SECRET = "the-secret-stanza-that-must-never-leak";

async function author(email: string, penName: string | null, slug: string | null, avatar: string | null = null) {
  const [e] = await db.insert(editors).values({ email, penName, slug, avatar }).returning();
  return e.id;
}

async function poem(editorId: string, over: Partial<typeof poems.$inferInsert>) {
  const [p] = await db
    .insert(poems)
    .values({ editorId, title: "Untitled", slug: "untitled", body: "line", status: "published", publishedAt: new Date(), ...over })
    .returning();
  return p;
}

describe("loadSharePoem", () => {
  it("returns a published public poem with what the image needs, and nothing else", async () => {
    const a = await author("a@x.com", "Selorm Agbɔ", "selorm-agbo", "a10");
    const p = await poem(a, { title: "Nùnyá", slug: "nunya", body: "Nùnyá, àdìdòé,\nàsí mètúnɛ́ ò.", language: "ee" });
    const got = await loadSharePoem("selorm-agbo", "nunya");
    expect(got).toEqual({
      id: p.id,
      title: "Nùnyá",
      slug: "nunya",
      body: "Nùnyá, àdìdòé,\nàsí mètúnɛ́ ò.",
      language: "ee",
      penName: "Selorm Agbɔ",
      authorSlug: "selorm-agbo",
      editorId: a,
      avatar: "a10",
    });
    // Never the email or any password field.
    expect(JSON.stringify(got)).not.toContain("a@x.com");
    expect(Object.keys(got!)).not.toContain("passwordHash");
  });

  it("a private poem is null, and its text is never selected (N1)", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await poem(a, { title: "Locked", slug: "locked", body: SECRET, visibility: "private", passwordHash: "x" });
    expect(await loadSharePoem("ann", "locked")).toBeNull();
  });

  it("drafts, unpublished poems, unknown poems and un-onboarded authors are null", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await poem(a, { title: "Draft", slug: "draft", status: "draft", publishedAt: null });
    const nameless = await author("b@x.com", null, "nameless");
    await poem(nameless, { slug: "orphan" });
    expect(await loadSharePoem("ann", "draft")).toBeNull();
    expect(await loadSharePoem("ann", "no-such-poem")).toBeNull();
    expect(await loadSharePoem("nobody", "draft")).toBeNull();
    expect(await loadSharePoem("nameless", "orphan")).toBeNull();
  });

  it("is scoped by author: another author's poem slug is null", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    await author("b@x.com", "Bea", "bea");
    await poem(a, { slug: "only-anns" });
    expect(await loadSharePoem("bea", "only-anns")).toBeNull();
    expect(await loadSharePoem("ann", "only-anns")).not.toBeNull();
  });

  it("a deleted poem, or one made private, is null from then on", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "soon-gone", body: SECRET });
    expect((await loadSharePoem("ann", "soon-gone"))?.body).toBe(SECRET);
    const { eq } = await import("drizzle-orm");
    await db.update(poems).set({ visibility: "private", passwordHash: "x" }).where(eq(poems.id, p.id));
    expect(await loadSharePoem("ann", "soon-gone")).toBeNull();
    await db.delete(poems).where(eq(poems.id, p.id));
    expect(await loadSharePoem("ann", "soon-gone")).toBeNull();
  });
});

describe("renderShareImage", () => {
  it("draws a 1080×1920 PNG, and a changed poem gives a different picture", async () => {
    const a = await author("a@x.com", "Ama Sɛwaa", "ama-sewaa", "a05");
    await poem(a, { title: "Sankɔfa", slug: "sankofa", body: "Sɛ wo werɛ fi na wosankɔfa a,\nyɛnkyiri.", language: "ak" });
    const p = (await loadSharePoem("ama-sewaa", "sankofa"))!;
    const first = await renderShareImage(p);
    const png = Buffer.from(first.png);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
    expect(first.etag).toMatch(/^"[\w-]{32}"$/);

    const again = await renderShareImage(p);
    expect(again.etag).toBe(first.etag);
    const edited = await renderShareImage({ ...p, body: `${p.body}\n\nAnother line.` });
    expect(edited.etag).not.toBe(first.etag);
    const renamed = await renderShareImage({ ...p, penName: "Ama Sɛwaa Boateng" });
    expect(renamed.etag).not.toBe(first.etag);
  });
});
