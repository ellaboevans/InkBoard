import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems } from "@/db/schema";
import { loadAuthorFeed, loadNovelFeed, loadSiteFeed } from "@/server/feeds";

/*
 * Novels in the Atom feeds (docs/PLAN.md, Phase 24), against real SQL:
 * published chapters only, numbered without drafts, ids urn:uuid:<chapter
 * id>, the site feed with each novel's first chapter only, a feed per novel,
 * and nothing of drafts or the email anywhere.
 */
const db = getDb();
const at = (d: string) => new Date(d);

async function setup() {
  const [ama] = await db.insert(editors).values({ email: "ama-secret@example.com", penName: "Ama Serwaa", slug: "ama" }).returning();
  const [ferry] = await db.insert(novels).values({ editorId: ama.id, title: "The Ferry", slug: "ferry", language: "ak" }).returning();
  const [drafty] = await db.insert(novels).values({ editorId: ama.id, title: "DRAFT NOVEL", slug: "drafty" }).returning();
  const ch = (novelId: string, slug: string, position: number, title: string, status: "draft" | "published", publishedAt: string | null, body: string) => ({
    novelId, slug, position, title, status, body, publishedAt: publishedAt ? at(publishedAt) : null,
  });
  const rows = await db
    .insert(chapters)
    .values([
      ch(ferry.id, "thursday", 1, "Thursday", "published", "2026-10-01T10:00:00Z", "^^The ferry came *late*.\n\n* * *\n\nAkua waited."),
      ch(ferry.id, "secret", 2, "SECRET TITLE", "draft", null, "SECRET TEXT"),
      ch(ferry.id, "chapter", 3, "", "published", "2026-10-08T10:00:00Z", "Second published."),
      ch(ferry.id, "radio", 4, "The Radio", "published", "2026-10-15T10:00:00Z", "Third <published>."),
      ch(drafty.id, "hidden", 1, "Hidden", "draft", null, "HIDDEN TEXT"),
    ])
    .returning({ id: chapters.id, slug: chapters.slug });
  await db.insert(poems).values({ editorId: ama.id, title: "A Poem", slug: "a-poem", body: "a line", status: "published", publishedAt: at("2026-10-10T10:00:00Z") });
  const id = (slug: string) => rows.find((r) => r.slug === slug)!.id;
  return { ama, ferry, id };
}

const entries = (xml: string) => [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => m[0]);
const titleOf = (entry: string) => /<title[^>]*>([^<]*)<\/title>/.exec(entry)![1];
const noDrafts = (xml: string) => {
  for (const s of ["SECRET", "HIDDEN", "DRAFT NOVEL", "-secret@", "^^"]) expect(xml, s).not.toContain(s);
};

describe("chapters in the author feed", () => {
  it("one entry per published chapter, numbered among published chapters, merged with poems by date", async () => {
    const { id } = await setup();
    const xml = (await loadAuthorFeed("ama"))!;
    expect(entries(xml).map(titleOf)).toEqual([
      "The Ferry: Chapter 3 · The Radio",
      "A Poem",
      "The Ferry: Chapter 2",
      "The Ferry: Chapter 1 · Thursday",
    ]);
    expect(xml).toContain(`<id>urn:uuid:${id("radio")}</id>`);
    expect(xml).toContain("/a/ama/n/ferry/radio");
    // The chapter as HTML (escaped once more as XML), in the novel's language.
    expect(xml).toContain('<content type="html" xml:lang="ak">&lt;p&gt;Third &amp;lt;published&amp;gt;.&lt;/p&gt;</content>');
    expect(xml).toContain("&lt;p&gt;The ferry came &lt;em&gt;late&lt;/em&gt;.&lt;/p&gt;\n&lt;hr&gt;");
    noDrafts(xml);
  });
});

describe("the site feed", () => {
  it("carries only each novel's first chapter, as 'New novel by …', dated when the novel first appeared", async () => {
    const { id } = await setup();
    const xml = await loadSiteFeed();
    const novelEntries = entries(xml).filter((e) => e.includes("/n/"));
    expect(novelEntries).toHaveLength(1);
    expect(titleOf(novelEntries[0])).toBe("New novel by Ama Serwaa: The Ferry");
    expect(novelEntries[0]).toContain(`<id>urn:uuid:${id("thursday")}</id>`);
    expect(novelEntries[0]).toContain("<published>2026-10-01T10:00:00Z</published>");
    noDrafts(xml);
  });

  it("follows the order: reordering makes another chapter the first one shown", async () => {
    const { id } = await setup();
    // Chapter "thursday" drops to the end (positions renumbered in two steps, as positions.ts does).
    await db.update(chapters).set({ position: 10 }).where(eq(chapters.id, id("thursday")));
    const xml = await loadSiteFeed();
    expect(xml).toContain(`<id>urn:uuid:${id("chapter")}</id>`);
    expect(xml).not.toContain(`<id>urn:uuid:${id("thursday")}</id>`);
    // Still dated when the novel first had a published chapter.
    expect(entries(xml).find((e) => e.includes("/n/"))).toContain("<published>2026-10-01T10:00:00Z</published>");
  });
});

describe("a novel's own feed", () => {
  it("lists its published chapters, newest first; null for a draft-only novel, another author's or an unknown one", async () => {
    await setup();
    const xml = (await loadNovelFeed("ama", "ferry"))!;
    expect(xml).toContain("<title type=\"text\">The Ferry, by Ama Serwaa</title>");
    expect(xml).toMatch(/<link rel="self" type="application\/atom\+xml" href="https?:\/\/[^"]+\/a\/ama\/n\/ferry\/feed\.xml"\/>/);
    expect(entries(xml).map(titleOf)).toEqual(["The Ferry: Chapter 3 · The Radio", "The Ferry: Chapter 2", "The Ferry: Chapter 1 · Thursday"]);
    expect(xml).not.toContain("A Poem");
    noDrafts(xml);
    expect(await loadNovelFeed("ama", "drafty")).toBeNull();
    expect(await loadNovelFeed("ama", "nope")).toBeNull();
    expect(await loadNovelFeed("nobody", "ferry")).toBeNull();
    await db.insert(editors).values({ email: "kofi@x.com", penName: "Kofi", slug: "kofi" });
    expect(await loadNovelFeed("kofi", "ferry")).toBeNull();
  });
});
