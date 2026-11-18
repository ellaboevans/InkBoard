import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels } from "@/db/schema";
import { coverHex, oklchToHex } from "@/lib/novel-cover";
import { chapterDescription, chapterJsonLd, novelDescription, novelJsonLd } from "@/lib/novel-seo";
import { sitemapEntries } from "@/lib/sitemap-entries";
import { absoluteUrl } from "@/lib/site";
import { loadBoardSections, loadNovelPage, loadReaderChapter, loadSitemapChapters } from "@/server/board";

/*
 * Findable and shareable novels (docs/PLAN.md, Phase 23b round 2): the
 * JSON-LD (Book with hasPart, Chapter isPartOf), meta descriptions and the
 * sitemap, built from the real loaders: published chapters only, never a
 * draft or a draft-only novel, and inLanguage only when the novel has one.
 */
const db = getDb();

async function setup() {
  const [ama] = await db.insert(editors).values({ email: "ama-secret@example.com", penName: "Ama Serwaa", slug: "ama" }).returning();
  const [ewe] = await db
    .insert(novels)
    .values({ editorId: ama.id, title: "Ɖeka", slug: "deka", blurb: "A blurb   with\nspaces.", language: "ee", status: "complete" })
    .returning();
  const [plain] = await db.insert(novels).values({ editorId: ama.id, title: "Untagged", slug: "untagged" }).returning();
  const [drafty] = await db.insert(novels).values({ editorId: ama.id, title: "DRAFT NOVEL", slug: "draft-novel" }).returning();
  const ch = (novelId: string, slug: string, position: number, status: "draft" | "published", body = "Some text.") => ({
    novelId,
    slug,
    position,
    status,
    title: slug === "chapter" ? "" : slug.toUpperCase(),
    body,
    wordCount: 2,
    publishedAt: status === "published" ? new Date("2026-11-01T10:00:00Z") : null,
  });
  await db.insert(chapters).values([
    ch(ewe.id, "one", 1, "published", "*Nùnyá* came late.\n\n* * *\n\nShe waited.\nAnd waited."),
    ch(ewe.id, "secret-draft", 2, "draft", "DRAFT TEXT"),
    ch(ewe.id, "chapter", 3, "published"),
    ch(plain.id, "only", 1, "published"),
    ch(drafty.id, "hidden", 1, "draft", "HIDDEN TEXT"),
  ]);
}

describe("JSON-LD for novels", () => {
  it("a Book lists its published chapters only, numbered without drafts, with inLanguage when it has one", async () => {
    await setup();
    const ld = novelJsonLd((await loadNovelPage("ama", "deka"))!);
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Book",
      name: "Ɖeka",
      url: absoluteUrl("/a/ama/n/deka"),
      author: { "@type": "Person", name: "Ama Serwaa", url: absoluteUrl("/a/ama") },
      inLanguage: "ee",
      creativeWorkStatus: "Complete",
      isAccessibleForFree: true,
    });
    expect(ld.hasPart).toEqual([
      { "@type": "Chapter", name: "ONE", position: 1, url: absoluteUrl("/a/ama/n/deka/one"), datePublished: "2026-11-01T10:00:00.000Z" },
      { "@type": "Chapter", name: "Chapter 2", position: 2, url: absoluteUrl("/a/ama/n/deka/chapter"), datePublished: "2026-11-01T10:00:00.000Z" },
    ]);
    const json = JSON.stringify(ld);
    for (const s of ["DRAFT", "secret-draft", "-secret@", "came late"]) expect(json, s).not.toContain(s);

    const untagged = novelJsonLd((await loadNovelPage("ama", "untagged"))!);
    expect(untagged).not.toHaveProperty("inLanguage");
    expect(untagged.creativeWorkStatus).toBe("Ongoing");
  });

  it("a Chapter isPartOf its Book, carries the novel's language, and holds no text", async () => {
    await setup();
    const ld = chapterJsonLd((await loadReaderChapter("ama", "deka", "chapter"))!);
    expect(ld).toMatchObject({
      "@type": "Chapter",
      name: "Chapter 2",
      position: 2,
      url: absoluteUrl("/a/ama/n/deka/chapter"),
      inLanguage: "ee",
      isPartOf: { "@type": "Book", name: "Ɖeka", url: absoluteUrl("/a/ama/n/deka"), inLanguage: "ee" },
    });
    expect(JSON.stringify(chapterJsonLd((await loadReaderChapter("ama", "deka", "one"))!))).not.toContain("came late");
    expect(chapterJsonLd((await loadReaderChapter("ama", "untagged", "only"))!)).not.toHaveProperty("inLanguage");
  });
});

describe("meta descriptions", () => {
  it("a novel's is its blurb on one line; a chapter's its first lines as plain text (stripProse)", async () => {
    await setup();
    expect(novelDescription((await loadNovelPage("ama", "deka"))!)).toBe("A blurb with spaces.");
    expect(novelDescription((await loadNovelPage("ama", "untagged"))!)).toBe("A novel by Ama Serwaa on InkBoard, 1 chapter so far.");
    // No emphasis stars, no scene break, line breaks as spaces.
    expect(chapterDescription((await loadReaderChapter("ama", "deka", "one"))!)).toBe("Nùnyá came late. She waited. And waited.");
    const long = chapterDescription({ body: "word ".repeat(100), number: 1, penName: "x", novel: { title: "y" } as never });
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the sitemap", () => {
  it("lists every novel page and published chapter, never a draft or a novel with nothing published", async () => {
    await setup();
    const urls = sitemapEntries(await loadBoardSections(), await loadSitemapChapters()).map((e) => e.url);
    for (const path of ["/a/ama", "/a/ama/n/deka", "/a/ama/n/deka/one", "/a/ama/n/deka/chapter", "/a/ama/n/untagged", "/a/ama/n/untagged/only"]) {
      expect(urls, path).toContain(absoluteUrl(path));
    }
    for (const bit of ["secret-draft", "draft-novel", "hidden"]) {
      expect(urls.some((u) => u.includes(bit)), bit).toBe(false);
    }
    expect(urls.filter((u) => u.includes("/n/"))).toHaveLength(5);
  });
});

describe("the drawn cover's colours", () => {
  it("converts OKLCH to the same sRGB the browser draws (known values)", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    // CSS Color 4's example: oklch(0.628 0.2577 29.23) is sRGB red.
    expect(oklchToHex(0.628, 0.2577, 29.23)).toBe("#ff0000");
    // Paper is light, ink dark, on every hue: the cover's title stays readable.
    for (const hue of [0, 60, 120, 200, 280, 340]) {
      const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
      expect(lum(coverHex("paper", hue)) - lum(coverHex("ink", hue))).toBeGreaterThan(400);
    }
  });
});
