import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems, pushFollows, pushSubscriptions, shortLinks } from "@/db/schema";
import { readingMinutes } from "@/lib/novel-limits";
import { byVisits, FOLLOWER_THRESHOLD, followerCount } from "@/lib/writer-stats";
import { getWriterStats } from "@/server/writer-stats";

/* Stats for writers (docs/PLAN.md, Phase 27): the writer's own numbers, from data already kept. */

const db = getDb();
let codes = 0;
const code = () => `kmn${"bcdfghjkmnpqrstvwxz"[codes % 19]}${"bcdfghjkmnpqrstvwxz"[Math.floor(codes++ / 19) % 19]}q`;

async function editor(name: string) {
  const [e] = await db.insert(editors).values({ email: `${name}@example.com`, penName: name, slug: name }).returning();
  return e.id;
}
async function poem(editorId: string, title: string, over: Partial<typeof poems.$inferInsert> = {}) {
  const [p] = await db
    .insert(poems)
    .values({ editorId, title, slug: title.toLowerCase().replace(/\W+/g, "-"), body: "a line", status: "published", publishedAt: new Date(), ...over })
    .returning();
  return p.id;
}
async function link(target: { poemId: string } | { chapterId: string }, visits: number) {
  await db.insert(shortLinks).values({ ...target, code: code(), visits });
}
async function novel(editorId: string, title: string, visibility: "public" | "private" = "public") {
  const [n] = await db
    .insert(novels)
    .values({ editorId, title, slug: title.toLowerCase().replace(/\W+/g, "-"), visibility, ...(visibility === "private" ? { passwordHash: "scrypt$1$1$1$x$y" } : {}) })
    .returning();
  return n.id;
}
async function chapter(novelId: string, position: number, title: string, words: number, status: "published" | "draft") {
  const [c] = await db
    .insert(chapters)
    .values({ novelId, position, title, slug: `c${position}`, body: "Text.", wordCount: words, status, publishedAt: status === "published" ? new Date() : null })
    .returning();
  return c.id;
}
async function followers(editorId: string, n: number, start = 0) {
  for (let i = start; i < start + n; i++) {
    const [s] = await db
      .insert(pushSubscriptions)
      .values({ endpoint: `https://fcm.googleapis.com/fcm/send/d-${editorId}-${i}`, p256dh: "k", auth: "a" })
      .returning();
    await db.insert(pushFollows).values({ subscriptionId: s.id, editorId });
  }
}

describe("getWriterStats", () => {
  it("is empty for a new writer, with the follower count hidden", async () => {
    const ama = await editor("ama");
    expect(await getWriterStats(ama)).toEqual({ links: [], novels: [], followers: { kind: "few" } });
  });

  it("lists poems' and chapters' shared links, most visited first, numbered among published chapters", async () => {
    const ama = await editor("ama");
    await link({ poemId: await poem(ama, "Harmattan") }, 4);
    await link({ poemId: await poem(ama, "Gone Private", { visibility: "private", passwordHash: "scrypt$1$1$1$x$y" }) }, 2);
    await poem(ama, "Never Shared");
    const ferry = await novel(ama, "The Ferry");
    await chapter(ferry, 1, "Draft first", 100, "draft");
    await link({ chapterId: await chapter(ferry, 2, "Thursday", 1000, "published") }, 9);
    await link({ chapterId: await chapter(ferry, 3, "", 500, "published") }, 1);

    const { links } = await getWriterStats(ama);
    expect(links).toEqual([
      { kind: "chapter", title: "The Ferry", detail: "Chapter 1 · Thursday", live: true, visits: 9 },
      { kind: "poem", title: "Harmattan", detail: null, live: true, visits: 4 },
      // A poem made private keeps its visits, marked as not on InkBoard now.
      { kind: "poem", title: "Gone Private", detail: null, live: false, visits: 2 },
      { kind: "chapter", title: "The Ferry", detail: "Chapter 2", live: true, visits: 1 },
    ]);
  });

  it("counts a novel's published chapters, words and reading time like readers see, drafts apart, visits summed", async () => {
    const ama = await editor("ama");
    const ferry = await novel(ama, "The Ferry");
    await link({ chapterId: await chapter(ferry, 1, "One", 2000, "published") }, 3);
    await link({ chapterId: await chapter(ferry, 2, "Two", 1450, "published") }, 5);
    await chapter(ferry, 3, "Three", 9000, "draft");
    await chapter(ferry, 4, "Four", 0, "draft");
    const secret = await novel(ama, "Locked Room", "private");
    await chapter(secret, 1, "One", 460, "published");
    await novel(ama, "Just Started");

    const { novels: stats } = await getWriterStats(ama);
    expect(stats).toEqual([
      { id: ferry, title: "The Ferry", isPrivate: false, publishedChapters: 2, draftChapters: 2, words: 3450, readingMinutes: readingMinutes(3450), visits: 8 },
      { id: expect.any(String), title: "Just Started", isPrivate: false, publishedChapters: 0, draftChapters: 0, words: 0, readingMinutes: 0, visits: 0 },
      { id: secret, title: "Locked Room", isPrivate: true, publishedChapters: 1, draftChapters: 0, words: 460, readingMinutes: 2, visits: 0 },
    ]);
  });

  it("an unpublished chapter's link keeps its visits without a reader's number", async () => {
    const ama = await editor("ama");
    const ferry = await novel(ama, "The Ferry");
    await link({ chapterId: await chapter(ferry, 1, "Pulled", 100, "draft") }, 6);
    const { links } = await getWriterStats(ama);
    expect(links).toEqual([{ kind: "chapter", title: "The Ferry", detail: "Unpublished chapter · Pulled", live: false, visits: 6 }]);
  });

  it("counts following devices, and below the threshold never says how many", async () => {
    const ama = await editor("ama");
    await followers(ama, FOLLOWER_THRESHOLD - 1);
    expect((await getWriterStats(ama)).followers).toEqual({ kind: "few" });
    await followers(ama, 2, FOLLOWER_THRESHOLD - 1);
    expect((await getWriterStats(ama)).followers).toEqual({ kind: "count", devices: FOLLOWER_THRESHOLD + 1 });
  });

  it("never includes another writer's links, novels or followers", async () => {
    const ama = await editor("ama");
    const kofi = await editor("kofi");
    await link({ poemId: await poem(kofi, "Kofi Poem") }, 50);
    const kn = await novel(kofi, "Kofi Novel");
    await link({ chapterId: await chapter(kn, 1, "K1", 900, "published") }, 40);
    await followers(kofi, 5);
    await link({ poemId: await poem(ama, "Ama Poem") }, 1);

    const mine = await getWriterStats(ama);
    expect(mine.links.map((l) => l.title)).toEqual(["Ama Poem"]);
    expect(mine.novels).toEqual([]);
    expect(mine.followers).toEqual({ kind: "few" });
    expect(JSON.stringify(mine)).not.toMatch(/Kofi/);
    expect((await getWriterStats(kofi)).followers).toEqual({ kind: "count", devices: 5 });
  });

  it("matches the JSON download's visit numbers (the same short_links.visits)", async () => {
    const ama = await editor("ama");
    const p = await poem(ama, "Harmattan");
    await link({ poemId: p }, 7);
    const { rows } = (await db.execute(sql`SELECT visits FROM short_links WHERE poem_id = ${p}`)) as unknown as { rows: { visits: number }[] };
    expect((await getWriterStats(ama)).links[0].visits).toBe(rows[0].visits);
  });
});

describe("stats rules", () => {
  it("hides counts under the threshold", () => {
    expect(followerCount(0)).toEqual({ kind: "few" });
    expect(followerCount(FOLLOWER_THRESHOLD - 1)).toEqual({ kind: "few" });
    expect(followerCount(FOLLOWER_THRESHOLD)).toEqual({ kind: "count", devices: FOLLOWER_THRESHOLD });
  });
  it("orders by visits, then title", () => {
    expect(byVisits([{ title: "b", visits: 1 }, { title: "a", visits: 1 }, { title: "c", visits: 5 }]).map((r) => r.title)).toEqual(["c", "a", "b"]);
  });
  it("is used only by the writer's stats page: no reader loader, feed or card imports it", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    const users = walk("src").filter((f) => /\.tsx?$/.test(f) && readFileSync(f, "utf8").includes("@/server/writer-stats"));
    expect(users).toEqual([join("src", "app", "admin", "(dashboard)", "stats", "page.tsx")]);
  });
});
