import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { collections, editors, poems } from "@/db/schema";
import type { ReaderPath } from "@/lib/reader-paths";
import { loadAuthorPage, loadCollectionPage, loadReaderPoem, readerPathExists } from "@/server/board";

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
];

async function pageHasContent(p: ReaderPath) {
  if (p.kind === "author") return (await loadAuthorPage(p.author)) !== null;
  if (p.kind === "poem") return (await loadReaderPoem(p.author, p.poem)) !== null;
  return (await loadCollectionPage(p.author, p.collection)) !== null;
}

describe("readerPathExists", () => {
  it("agrees with the page's own loader in every case", async () => {
    for (const p of cases) {
      expect(await readerPathExists(p), JSON.stringify(p)).toBe(await pageHasContent(p));
    }
  });

  it("finds published poems (private ones too: their page shows the unlock form) and nothing unpublished", async () => {
    expect(await readerPathExists({ kind: "poem", author: "ama", poem: "private" })).toBe(true);
    expect(await readerPathExists({ kind: "poem", author: "ama", poem: "draft" })).toBe(false);
    expect(await readerPathExists({ kind: "collection", author: "ama", collection: "drafts" })).toBe(false);
    expect(await readerPathExists({ kind: "author", author: "not-onboarded" })).toBe(false);
  });
});
