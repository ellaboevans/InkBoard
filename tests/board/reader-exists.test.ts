import { eq, sql } from "drizzle-orm";
import { withRelease } from "../support/chapters";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chapters, collections, editors, novels, poems } from "@/db/schema";
import type { ReaderPath } from "@/lib/reader-paths";
import {
  loadAuthorPage,
  loadCollectionPage,
  loadNovelPage,
  loadReaderChapter,
  loadReaderPoem,
  readerPathExists,
} from "@/server/board";

/*
 * The proxy's existence check (docs/PLAN.md, Phase 19) must say "missing"
 * exactly when the page itself would render "not found": a 404 for a page
 * that has content would hide it, and a 200 for a missing one is the bug
 * being fixed. Compared here against the pages' own loaders, case by case.
 */
const db = getDb();

beforeEach(async () => {
  const [ama] = await db.insert(editors).values({ email: "ama@example.com", penName: "Ama", slug: "ama" }).returning();
  await db.insert(editors).values({ email: "new@example.com", penName: null, slug: "not-onboarded" });
  const [kofi] = await db.insert(editors).values({ email: "kofi@example.com", penName: "Kofi", slug: "kofi" }).returning();

  const [full] = await db.insert(collections).values({ editorId: ama.id, title: "Full", slug: "full" }).returning();
  const [drafts] = await db.insert(collections).values({ editorId: ama.id, title: "Drafts", slug: "drafts" }).returning();
  await db.insert(collections).values({ editorId: ama.id, title: "Empty", slug: "empty" });
  await db.insert(collections).values({ editorId: kofi.id, title: "Kofi's", slug: "kofis" });

  const poem = (over: Partial<typeof poems.$inferInsert>) => ({
    editorId: ama.id,
    title: "x",
    body: "a line",
    visibility: "public" as const,
    status: "published" as const,
    publishedAt: new Date(),
    ...over,
    slug: over.slug!,
  });
  await db.insert(poems).values([
    poem({ slug: "public", collectionId: full.id, collectionPosition: 1 }),
    poem({ slug: "private", visibility: "private", passwordHash: "x" }),
    poem({ slug: "draft", status: "draft", publishedAt: null, collectionId: drafts.id, collectionPosition: 1 }),
    poem({ slug: "by-kofi", editorId: kofi.id }),
  ]);

  // Novels (Phase 23b): one with published chapters and drafts, one with drafts only, one of Kofi's.
  const [book] = await db.insert(novels).values({ editorId: ama.id, title: "Book", slug: "book" }).returning();
  const [unready] = await db.insert(novels).values({ editorId: ama.id, title: "Unready", slug: "unready" }).returning();
  await db.insert(novels).values({ editorId: ama.id, title: "Empty", slug: "empty-novel" });
  const [kofiBook] = await db.insert(novels).values({ editorId: kofi.id, title: "K", slug: "kofi-book" }).returning();
  const chapter = (novelId: string, slug: string, position: number, published: boolean, everPublished = published) => ({
    novelId,
    slug,
    position,
    title: slug,
    body: "text",
    status: published ? ("published" as const) : ("draft" as const),
    publishedAt: everPublished ? new Date() : null,
  });
  await db.insert(chapters).values(withRelease([
    chapter(book.id, "one", 1, true),
    chapter(book.id, "draft", 2, false),
    chapter(book.id, "pulled", 3, false, true),
    chapter(unready.id, "first", 1, false),
    chapter(kofiBook.id, "k1", 1, true),
  ]));
  // Not onboarded, with a published chapter: still nothing for readers.
  const [ghost] = await db.select().from(editors).where(eq(editors.slug, "not-onboarded"));
  const [ghostBook] = await db.insert(novels).values({ editorId: ghost.id, title: "G", slug: "ghost-book" }).returning();
  await db.insert(chapters).values(withRelease(chapter(ghostBook.id, "g1", 1, true)));

  // Scheduled chapters (Phase 28): one beside the book's published chapter, and a novel whose only chapter is scheduled.
  const [soon] = await db.insert(novels).values({ editorId: ama.id, title: "Soon", slug: "soon" }).returning();
  const later = new Date(Date.now() + 3 * 86_400_000);
  await db.insert(chapters).values([
    { ...chapter(book.id, "next-week", 4, true), publishedAt: later, releaseAt: later },
    { ...chapter(soon.id, "opening", 1, true), publishedAt: later, releaseAt: later },
  ]);
});

const cases: ReaderPath[] = [
  { kind: "author", author: "ama" },
  { kind: "author", author: "not-onboarded" },
  { kind: "author", author: "nobody" },
  { kind: "poem", author: "ama", poem: "public" },
  { kind: "poem", author: "ama", poem: "private" },
  { kind: "poem", author: "ama", poem: "draft" },
  { kind: "poem", author: "ama", poem: "by-kofi" },
  { kind: "poem", author: "kofi", poem: "by-kofi" },
  { kind: "poem", author: "nobody", poem: "public" },
  { kind: "collection", author: "ama", collection: "full" },
  { kind: "collection", author: "ama", collection: "drafts" },
  { kind: "collection", author: "ama", collection: "empty" },
  { kind: "collection", author: "ama", collection: "kofis" },
  { kind: "collection", author: "kofi", collection: "kofis" },
  { kind: "collection", author: "ama", collection: "nope" },
  { kind: "novel", author: "ama", novel: "book" },
  { kind: "novel", author: "ama", novel: "unready" },
  { kind: "novel", author: "ama", novel: "empty-novel" },
  { kind: "novel", author: "ama", novel: "kofi-book" },
  { kind: "novel", author: "kofi", novel: "kofi-book" },
  { kind: "novel", author: "not-onboarded", novel: "ghost-book" },
  { kind: "novel", author: "ama", novel: "nope" },
  { kind: "novel", author: "nobody", novel: "book" },
  { kind: "chapter", author: "ama", novel: "book", chapter: "one" },
  { kind: "chapter", author: "ama", novel: "book", chapter: "draft" },
  { kind: "chapter", author: "ama", novel: "book", chapter: "pulled" },
  { kind: "chapter", author: "ama", novel: "book", chapter: "nope" },
  { kind: "chapter", author: "ama", novel: "unready", chapter: "first" },
  { kind: "chapter", author: "ama", novel: "book", chapter: "k1" },
  { kind: "chapter", author: "ama", novel: "kofi-book", chapter: "k1" },
  { kind: "chapter", author: "kofi", novel: "kofi-book", chapter: "k1" },
  { kind: "chapter", author: "kofi", novel: "book", chapter: "one" },
  { kind: "chapter", author: "not-onboarded", novel: "ghost-book", chapter: "g1" },
  { kind: "chapter", author: "ama", novel: "book", chapter: "next-week" },
  { kind: "novel", author: "ama", novel: "soon" },
  { kind: "chapter", author: "ama", novel: "soon", chapter: "opening" },
];

async function pageHasContent(p: ReaderPath) {
  if (p.kind === "author") return (await loadAuthorPage(p.author)) !== null;
  if (p.kind === "poem") return (await loadReaderPoem(p.author, p.poem)) !== null;
  if (p.kind === "novel") return (await loadNovelPage(p.author, p.novel)) !== null;
  if (p.kind === "chapter") return (await loadReaderChapter(p.author, p.novel, p.chapter)) !== null;
  return (await loadCollectionPage(p.author, p.collection)) !== null;
}

describe("readerPathExists", () => {
  it("agrees with the page's own loader in every case", async () => {
    for (const p of cases) {
      expect(await readerPathExists(p), JSON.stringify(p)).toBe(await pageHasContent(p));
    }
  });

  it("a scheduled chapter is missing until its time, then found, in step with the loaders (Phase 28)", async () => {
    const scheduled = cases.slice(-3);
    for (const p of scheduled) {
      expect(await readerPathExists(p), JSON.stringify(p)).toBe(false);
      expect(await pageHasContent(p), JSON.stringify(p)).toBe(false);
    }
    // Its time passes (moved into the past in SQL rather than waited for).
    await db.execute(sql`UPDATE chapters SET release_at = now() - interval '1 minute', published_at = now() - interval '1 minute'
      WHERE slug IN ('next-week', 'opening')`);
    for (const p of scheduled) {
      expect(await readerPathExists(p), JSON.stringify(p)).toBe(true);
      expect(await pageHasContent(p), JSON.stringify(p)).toBe(true);
    }
  });

  it("finds published poems (private ones too: their page shows the unlock form) and nothing unpublished", async () => {
    expect(await readerPathExists({ kind: "poem", author: "ama", poem: "private" })).toBe(true);
    expect(await readerPathExists({ kind: "poem", author: "ama", poem: "draft" })).toBe(false);
    expect(await readerPathExists({ kind: "collection", author: "ama", collection: "drafts" })).toBe(false);
    expect(await readerPathExists({ kind: "author", author: "not-onboarded" })).toBe(false);
  });

  it("finds a novel only with a published chapter, and a chapter only while it's published (Phase 23b)", async () => {
    expect(await readerPathExists({ kind: "novel", author: "ama", novel: "book" })).toBe(true);
    expect(await readerPathExists({ kind: "novel", author: "ama", novel: "unready" })).toBe(false);
    expect(await readerPathExists({ kind: "chapter", author: "ama", novel: "book", chapter: "one" })).toBe(true);
    expect(await readerPathExists({ kind: "chapter", author: "ama", novel: "book", chapter: "draft" })).toBe(false);
    expect(await readerPathExists({ kind: "chapter", author: "ama", novel: "book", chapter: "pulled" })).toBe(false);
  });
});
