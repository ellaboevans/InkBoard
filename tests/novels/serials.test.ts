import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels } from "@/db/schema";
import { loadSerialsPage } from "@/server/board";
import { withRelease } from "../support/chapters";

/*
 * The "ongoing serials" page, /novels (docs/PLAN.md, Phase 29), against real
 * SQL: ongoing then finished, each by its latest released chapter, newest
 * first; scheduled chapters count only from their minute; draft-only novels
 * and authors without a pen name absent; private novels listed without text;
 * every author's novels present; no chapter text or email in the JSON.
 */
const db = getDb();
const at = (d: string) => new Date(d);

async function setup() {
  const [ama] = await db.insert(editors).values({ email: "ama-secret@example.com", penName: "Ama", slug: "ama" }).returning();
  const [kofi] = await db.insert(editors).values({ email: "kofi-secret@example.com", penName: "Kofi", slug: "kofi" }).returning();
  const [nobody] = await db.insert(editors).values({ email: "nopen-secret@example.com" }).returning();
  const novel = async (editorId: string, slug: string, over: Partial<typeof novels.$inferInsert> = {}) =>
    (await db.insert(novels).values({ editorId, title: slug.toUpperCase(), slug, ...over }).returning())[0];
  const ferry = await novel(ama.id, "ferry", { language: "ak", blurb: "The lake.\nSecond paragraph." });
  const quiet = await novel(ama.id, "quiet");
  const done = await novel(kofi.id, "done", { status: "complete" });
  const older = await novel(kofi.id, "older-done", { status: "complete" });
  const locked = await novel(kofi.id, "locked", { visibility: "private", passwordHash: "scrypt$16384$8$1$c2FsdA$aGFzaA" });
  const drafts = await novel(ama.id, "drafts-only");
  const hidden = await novel(nobody.id, "no-pen-name");
  const ch = (novelId: string, slug: string, position: number, publishedAt: string | null, over: Partial<typeof chapters.$inferInsert> = {}) => ({
    novelId,
    slug,
    title: slug === "untitled" ? "" : `Title ${slug}`,
    position,
    body: `CHAPTER TEXT ${slug}`,
    wordCount: 460,
    status: publishedAt ? ("published" as const) : ("draft" as const),
    publishedAt: publishedAt ? at(publishedAt) : null,
    ...over,
  });
  await db.insert(chapters).values(
    withRelease([
      ch(ferry.id, "one", 1, "2026-10-01"),
      ch(ferry.id, "two", 2, "2026-10-08"),
      ch(ferry.id, "draft", 3, null),
      ch(quiet.id, "untitled", 1, "2026-06-01"),
      ch(done.id, "end", 1, "2026-09-01"),
      ch(older.id, "old", 1, "2026-03-01"),
      ch(locked.id, "secret", 1, "2026-10-20"),
      ch(drafts.id, "nope", 1, null),
      ch(hidden.id, "hidden", 1, "2026-10-01"),
    ]),
  );
  // Scheduled for tomorrow: published, but not released.
  const [scheduled] = await db
    .insert(chapters)
    .values(withRelease(ch(quiet.id, "soon", 2, null, { status: "published", publishedAt: new Date(Date.now() + 86_400_000), releaseAt: new Date(Date.now() + 86_400_000) })))
    .returning();
  return { scheduled };
}

const slugs = (list: { slug: string }[]) => list.map((n) => n.slug);

describe("the ongoing serials page", () => {
  it("ongoing first, finished below, each by its latest released chapter, newest first", async () => {
    await setup();
    const page = await loadSerialsPage();
    expect(slugs(page.ongoing)).toEqual(["locked", "ferry", "quiet"]);
    expect(slugs(page.complete)).toEqual(["done", "older-done"]);
    const ferry = page.ongoing.find((n) => n.slug === "ferry")!;
    expect(ferry).toMatchObject({
      penName: "Ama",
      authorSlug: "ama",
      language: "ak",
      chapterCount: 2,
      readingMinutes: 4,
      blurb: "The lake.",
      chapterSlugs: ["one", "two"],
      latest: { number: 2, title: "Title two", displayTitle: "Title two", slug: "two", publishedAt: "2026-10-08T00:00:00.000Z" },
      updatedAt: "2026-10-08T00:00:00.000Z",
    });
    // Our "Chapter n" for an untitled chapter.
    expect(page.ongoing.find((n) => n.slug === "quiet")!.latest).toMatchObject({ number: 1, title: "", displayTitle: "Chapter 1" });
  });

  it("a scheduled chapter isn't counted or shown before its time, and is from then", async () => {
    const { scheduled } = await setup();
    let quiet = (await loadSerialsPage()).ongoing.find((n) => n.slug === "quiet")!;
    expect(quiet.chapterCount).toBe(1);
    expect(quiet.chapterSlugs).toEqual(["untitled"]);
    expect(JSON.stringify(await loadSerialsPage())).not.toContain("soon");

    await db.execute(sql`UPDATE chapters SET release_at = now() - interval '1 minute', published_at = now() - interval '1 minute' WHERE id = ${scheduled.id}`);
    const page = await loadSerialsPage();
    quiet = page.ongoing.find((n) => n.slug === "quiet")!;
    expect(quiet.chapterCount).toBe(2);
    expect(quiet.latest).toMatchObject({ number: 2, slug: "soon" });
    // Now the most recently updated serial.
    expect(slugs(page.ongoing)[0]).toBe("quiet");
  });

  it("draft-only novels and authors without a pen name are absent; every author's novels are present", async () => {
    await setup();
    const page = await loadSerialsPage();
    const all = [...page.ongoing, ...page.complete];
    expect(slugs(all)).not.toContain("drafts-only");
    expect(slugs(all)).not.toContain("no-pen-name");
    expect(new Set(all.map((n) => n.authorSlug))).toEqual(new Set(["ama", "kofi"]));
  });

  it("a private novel is listed (title, count, lock) without any text; the JSON holds no chapter text or email", async () => {
    await setup();
    const page = await loadSerialsPage();
    const locked = page.ongoing.find((n) => n.slug === "locked")!;
    expect(locked).toMatchObject({ visibility: "private", chapterCount: 1, title: "LOCKED" });
    const json = JSON.stringify(page);
    for (const secret of ["CHAPTER TEXT", "secret@", "@example.com", "Title draft", "Title nope", "Title hidden", "scrypt", "passwordHash"]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("an unpublished novel's chapters leave it off the page", async () => {
    await setup();
    await db.update(chapters).set({ status: "draft", releaseAt: null }).where(eq(chapters.slug, "end"));
    expect(slugs((await loadSerialsPage()).complete)).toEqual(["older-done"]);
  });
});
