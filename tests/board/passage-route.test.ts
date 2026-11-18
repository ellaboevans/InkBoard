import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems, rateLimits, retiredShortCodes, shortLinks } from "@/db/schema";
import { loadShareChapter } from "@/server/board";
import { rateLimit } from "@/server/rate-limit";
import { passageImageEtag, renderPassageImage } from "@/server/share-image";
import { handlePassageImage, handlePassageOutline, shareRenderKey, type PassageRouteDeps } from "@/server/share-image-route";
import { handleShortLink } from "@/server/short-link-route";
import { countChapterShareVisit, countShareVisit, ensureChapterShortCode, ensureShortCode, resolveShortCode } from "@/server/short-links";

/*
 * "Share a passage" (docs/PLAN.md, Phase 25 round 3), through the
 * framework-free handler with the real loader, renderer and rate limit (only
 * Next's cache is left out): the order of checks, so a private novel's
 * chapter is the same 404 as a missing one before anything about it is
 * looked at; the 400s; no server cache for picks (304 from the ETag); and
 * short links for chapters, alongside the poems' unchanged ones.
 */

const db = getDb();
const SECRET = "SECRET-PRIVATE-CHAPTER-TEXT.";
const TEXT = "The ferry came late. Akua waited at the landing.\n\nKwabena did not come back. The radio stayed.";

let ama: string;
let ferry: string;
let thursday: string;
beforeEach(async () => {
  const [e] = await db.insert(editors).values({ email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama" }).returning();
  ama = e.id;
  const [n] = await db.insert(novels).values({ editorId: ama, title: "The Ferry at Yeji", slug: "ferry", language: "ak" }).returning();
  ferry = n.id;
  const [draft] = await db
    .insert(chapters)
    .values({ novelId: ferry, title: "Draft", slug: "draft", body: "DRAFT TEXT.", position: 1, status: "draft" })
    .returning();
  void draft;
  const [c] = await db
    .insert(chapters)
    .values({ novelId: ferry, title: "Thursday", slug: "thursday", body: TEXT, position: 2, status: "published", publishedAt: new Date() })
    .returning();
  thursday = c.id;
});

async function privateNovel() {
  await db.execute(sql`UPDATE editors SET password_mode = 'shared', shared_password_hash = 'scrypt$x' WHERE id = ${ama}`);
  const [n] = await db.insert(novels).values({ editorId: ama, title: "Behind the Door", slug: "door", visibility: "private" }).returning();
  const [c] = await db
    .insert(chapters)
    .values({ novelId: n.id, title: "One", slug: "one", body: SECRET, position: 1, status: "published", publishedAt: new Date() })
    .returning();
  return { novelId: n.id, chapterId: c.id };
}

/** Real deps, with spies on what must (not) happen. */
function deps(over: Partial<PassageRouteDeps> = {}) {
  const d = {
    getChapter: vi.fn(loadShareChapter),
    ensureShortCode: vi.fn(ensureChapterShortCode),
    render: vi.fn(renderPassageImage),
    etagFor: vi.fn(passageImageEtag),
    limitRender: vi.fn(() => rateLimit(shareRenderKey("test-bucket"), 2, 600)),
    onParsePassage: vi.fn(),
    ...over,
  };
  return d;
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://inkboard.test${path}`, { headers });
const params = (novel = "ferry", chapter = "thursday") => ({ author: "ama", novel, chapter });
const rateRows = async () => (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key);

describe("the loader", () => {
  it("a published chapter of a public novel: its text, its number among published chapters, the author", async () => {
    const c = (await loadShareChapter("ama", "ferry", "thursday"))!;
    expect(c).toMatchObject({ id: thursday, number: 1, body: TEXT, penName: "Ama Sɛwaa", shortCode: null });
    expect(c.novel).toEqual({ id: ferry, title: "The Ferry at Yeji", slug: "ferry", language: "ak" });
  });

  it("null for a draft, a private novel's chapter (N1: no text in the result), another author's slug, unknown slugs", async () => {
    await privateNovel();
    expect(await loadShareChapter("ama", "ferry", "draft")).toBeNull();
    expect(await loadShareChapter("ama", "door", "one")).toBeNull();
    expect(await loadShareChapter("kofi", "ferry", "thursday")).toBeNull();
    expect(await loadShareChapter("ama", "nope", "thursday")).toBeNull();
  });
});

describe("the route's order", () => {
  it("a private novel's chapter, a draft and an unknown one: the same 404, before the passage is parsed, with no short code or rate-limit row", async () => {
    await privateNovel();
    for (const [novel, chapter] of [
      ["door", "one"],
      ["ferry", "draft"],
      ["ferry", "nope"],
      ["nope", "nope"],
    ]) {
      for (const q of ["?passage=1", "?passage=junk", "", "?passage=1&passage=2"]) {
        const d = deps();
        const res = await handlePassageImage(get(`/x${q}`), params(novel, chapter), d);
        expect(res.status, `${novel}/${chapter}${q}`).toBe(404);
        expect(res.headers.get("cache-control")).toContain("no-store");
        expect(await res.text()).toBe("Not found");
        expect(d.onParsePassage).not.toHaveBeenCalled();
        expect(d.ensureShortCode).not.toHaveBeenCalled();
        expect(d.limitRender).not.toHaveBeenCalled();
        expect(d.render).not.toHaveBeenCalled();
      }
    }
    expect(await rateRows()).toEqual([]);
    expect(await db.select().from(shortLinks)).toEqual([]);
    // And the picker's outline: the same 404, nothing of the text.
    const outline = await handlePassageOutline(params("door", "one"), loadShareChapter);
    expect(outline.status).toBe(404);
    expect(await outline.text()).not.toContain("SECRET");
  });

  it("an unknown format or design is a 404 before the chapter is even looked up", async () => {
    for (const q of ["?format=square&passage=1", "?design=neon&passage=1", "?format=chat&format=chat&passage=1"]) {
      const d = deps();
      expect((await handlePassageImage(get(`/x${q}`), params(), d)).status, q).toBe(404);
      expect(d.getChapter).not.toHaveBeenCalled();
    }
  });

  it("a public chapter: a 400 for a missing, repeated, junk, non-canonical, out-of-range or over-cap passage", async () => {
    for (const q of ["", "?passage=", "?passage=1&passage=1", "?passage=junk", "?passage=1.1", "?passage=1-1", "?passage=3", "?passage=2-1"]) {
      const d = deps();
      const res = await handlePassageImage(get(`/x${q}`), params(), d);
      expect(res.status, q).toBe(400);
      expect(d.render).not.toHaveBeenCalled();
    }
    // Over the cap.
    await db.update(chapters).set({ body: `${"a".repeat(700)}.` }).where(eq(chapters.id, thursday));
    expect((await handlePassageImage(get("/x?passage=1"), params(), deps())).status).toBe(400);
  });
});

describe("the picture", () => {
  it("draws a 1080×1920 PNG (or 1080×1350 for chat), prints the chapter's new short address, and reports the characters", async () => {
    const res = await handlePassageImage(get("/x?passage=1.2-2.1"), params(), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="inkboard-ferry-thursday-passage.png"');
    const [link] = await db.select().from(shortLinks);
    expect(link).toMatchObject({ chapterId: thursday, poemId: null });
    expect(res.headers.get("x-share-address")).toBe(`/s/${link.code}`);
    // "Akua waited at the landing." + join + "Kwabena did not come back."
    expect(res.headers.get("x-share-chars-picked")).toBe(String("Akua waited at the landing.".length + 1 + "Kwabena did not come back.".length));
    expect(res.headers.get("x-share-chars-shown")).toBe(res.headers.get("x-share-chars-picked"));
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
    const chat = await handlePassageImage(get("/x?format=chat&design=board&passage=2"), params(), deps());
    expect(chat.headers.get("content-disposition")).toBe('inline; filename="inkboard-ferry-thursday-chat-board-passage.png"');
    expect((await sharp(Buffer.from(await chat.arrayBuffer())).metadata()).height).toBe(1350);
    // The same code for every picture of the chapter.
    expect(await db.select().from(shortLinks)).toHaveLength(1);
  });

  it("is never cached on the server: a revalidation is a 304 from the ETag with no drawing and no count; real renders are limited", async () => {
    const first = await handlePassageImage(get("/x?passage=1"), params(), deps());
    const etag = first.headers.get("etag")!;
    const d = deps();
    const again = await handlePassageImage(get("/x?passage=1", { "if-none-match": etag }), params(), d);
    expect(again.status).toBe(304);
    expect(d.render).not.toHaveBeenCalled();
    expect(d.limitRender).not.toHaveBeenCalled();
    // The ETag changes with the pick and the design.
    const other = await handlePassageImage(get("/x?passage=2", { "if-none-match": etag }), params(), deps());
    expect(other.status).toBe(200);
    expect(other.headers.get("etag")).not.toBe(etag);
    // Two renders were allowed in the window (the deps' limit); the third is refused.
    const limited = await handlePassageImage(get("/x?design=ink&passage=1"), params(), deps());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("the picker's outline: paragraphs as sentences, the scene breaks, the novel's language", async () => {
    const res = await handlePassageOutline(params(), loadShareChapter);
    expect(await res.json()).toEqual({
      language: "ak",
      paragraphs: [
        ["The ferry came late.", "Akua waited at the landing."],
        ["Kwabena did not come back.", "The radio stayed."],
      ],
      breaks: [],
    });
  });
});

describe("short links for chapters", () => {
  it("are made once, only for a published chapter of a public novel; concurrent first pictures share one", async () => {
    const codes = await Promise.all([ensureChapterShortCode(thursday), ensureChapterShortCode(thursday), ensureChapterShortCode(thursday)]);
    expect(new Set(codes).size).toBe(1);
    const { chapterId } = await privateNovel();
    expect(await ensureChapterShortCode(chapterId)).toBeNull();
    const [draft] = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.slug, "draft"));
    expect(await ensureChapterShortCode(draft.id)).toBeNull();
    expect(await db.select().from(shortLinks)).toHaveLength(1);
  });

  it("/s/<code> redirects to the chapter (302, counted as a visit); private, unpublished or deleted is 'missing'", async () => {
    const code = (await ensureChapterShortCode(thursday))!;
    expect(await resolveShortCode(code)).toEqual({ chapterId: thursday, authorSlug: "ama", novelSlug: "ferry", chapterSlug: "thursday" });
    expect(await handleShortLink({ method: "GET", headers: new Headers({ "user-agent": "Mozilla/5.0 (Linux; Android 14)" }) }, code, resolveShortCode)).toEqual({
      kind: "redirect",
      location: "/a/ama/n/ferry/thursday",
      chapterId: thursday,
      count: true,
    });
    // The novel made private: the same 'missing' as a code that never existed.
    await db.execute(sql`UPDATE editors SET password_mode = 'shared', shared_password_hash = 'scrypt$x' WHERE id = ${ama}`);
    await db.update(novels).set({ visibility: "private" }).where(eq(novels.id, ferry));
    expect(await resolveShortCode(code)).toBeNull();
    await db.update(novels).set({ visibility: "public" }).where(eq(novels.id, ferry));
    await db.update(chapters).set({ status: "draft" }).where(eq(chapters.id, thursday));
    expect(await resolveShortCode(code)).toBeNull();
  });

  it("deleting the chapter retires its code: never given to anything else", async () => {
    const code = (await ensureChapterShortCode(thursday))!;
    await db.delete(chapters).where(eq(chapters.id, thursday));
    expect(await db.select().from(shortLinks)).toEqual([]);
    expect((await db.select().from(retiredShortCodes)).map((r) => r.code)).toEqual([code]);
    const insert = await db
      .insert(shortLinks)
      .values({ poemId: null, chapterId: null, code })
      .then(() => null, (e: unknown) => e);
    expect(insert).toBeTruthy();
  });

  it("a row points at exactly one poem or one chapter", async () => {
    const [p] = await db.insert(poems).values({ editorId: ama, title: "P", slug: "p", body: "x", status: "published", publishedAt: new Date() }).returning();
    const both = await db.insert(shortLinks).values({ poemId: p.id, chapterId: thursday, code: "bcdfgh" }).then(() => null, (e: unknown) => e);
    const neither = await db.insert(shortLinks).values({ code: "bcdfgj" }).then(() => null, (e: unknown) => e);
    expect(both).toBeTruthy();
    expect(neither).toBeTruthy();
  });

  it("visits are counted like poems': once per network per chapter per day; poems' links are unchanged", async () => {
    const code = (await ensureChapterShortCode(thursday))!;
    expect(await countChapterShareVisit(thursday, "198.51.100.1")).toBe(true);
    expect(await countChapterShareVisit(thursday, "198.51.100.1")).toBe(false);
    expect(await countChapterShareVisit(thursday, "198.51.100.2")).toBe(true);
    const [row] = await db.select({ visits: shortLinks.visits }).from(shortLinks).where(eq(shortLinks.code, code));
    expect(row.visits).toBe(2);

    const [p] = await db.insert(poems).values({ editorId: ama, title: "Open", slug: "open", body: "x", visibility: "public", status: "published", publishedAt: new Date() }).returning();
    const poemCode = (await ensureShortCode(p.id))!;
    expect(await resolveShortCode(poemCode)).toEqual({ poemId: p.id, authorSlug: "ama", poemSlug: "open" });
    expect(await countShareVisit(p.id, "198.51.100.1")).toBe(true);
    const [poemRow] = await db.select({ visits: shortLinks.visits }).from(shortLinks).where(eq(shortLinks.poemId, p.id));
    expect(poemRow.visits).toBe(1);
  });
});
