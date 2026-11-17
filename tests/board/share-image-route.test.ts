import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors, poems, rateLimits } from "@/db/schema";
import { loadSharePoem, type SharePoem } from "@/server/board";
import { rateLimit } from "@/server/rate-limit";
import { renderShareImage, shareImageEtag } from "@/server/share-image";
import {
  handleShareImage,
  handleShareLines,
  parseFormat,
  SHARE_RENDER_LIMIT,
  shareRenderKey,
  type ShareRouteDeps,
} from "@/server/share-image-route";

/*
 * The share image routes' rules (docs/PLAN.md, Phase 21 round 2), driven
 * through the framework-free handler with the real loader, renderer and rate
 * limit (only Next's cache is left out: getPoem/getWholeImage are uncached here).
 */

const db = getDb();
const SECRET = "the-secret-stanza-that-must-never-leak";

async function author(email: string, penName: string, slug: string) {
  const [e] = await db.insert(editors).values({ email, penName, slug }).returning();
  return e.id;
}
async function poem(editorId: string, over: Partial<typeof poems.$inferInsert>) {
  const [p] = await db
    .insert(poems)
    .values({ editorId, title: "Untitled", slug: "untitled", body: "line", status: "published", publishedAt: new Date(), ...over })
    .returning();
  return p;
}

/** Real deps, with spies on what must (not) happen. */
function deps(over: Partial<ShareRouteDeps> = {}) {
  const getPoem = vi.fn(loadSharePoem);
  const renderPicked = vi.fn(renderShareImage);
  const parsed = vi.fn();
  const limitRender = vi.fn(() => rateLimit(shareRenderKey("test-bucket"), 2, 600));
  const d: ShareRouteDeps = {
    getPoem,
    getWholeImage: async (a, s, format) => {
      const p = await loadSharePoem(a, s);
      return p ? renderShareImage(p, { format }) : null;
    },
    renderPicked,
    etagFor: shareImageEtag,
    limitRender,
    onParseSelection: parsed,
    ...over,
  };
  return { d, getPoem, renderPicked, parsed, limitRender };
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://x.test${path}`, { headers });
const pngSize = async (res: Response) => {
  const b = Buffer.from(await res.arrayBuffer());
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

async function fixtures() {
  const a = await author("a@x.com", "Ama Sɛwaa", "ama");
  await poem(a, { slug: "open", title: "Sankɔfa", body: "Sɛ wo werɛ fi na wosankɔfa a,\nyɛnkyiri.\n\n*It is no taboo to go back*\n*for what you forgot.*", language: "ak" });
  await poem(a, { slug: "locked", title: "Locked", body: `${SECRET}\n${SECRET}\n${SECRET}`, visibility: "private", passwordHash: "x" });
  await poem(a, { slug: "draft", title: "Draft", body: "a draft line", status: "draft", publishedAt: null });
}

describe("format", () => {
  it("absent is the Status picture; story and chat are known; anything else is unknown", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(parseFormat(q(""))).toBe("story");
    expect(parseFormat(q("format=story"))).toBe("story");
    expect(parseFormat(q("format=chat"))).toBe("chat");
    for (const s of ["format=", "format=square", "format=CHAT", "format=chat&format=chat", "format=story&format=chat"]) {
      expect(parseFormat(q(s)), s).toBeNull();
    }
  });

  it("an unknown format is a 404, never a fallback", async () => {
    await fixtures();
    const { d } = deps();
    const res = await handleShareImage(get("/p/ama/open/share-image?format=square"), { author: "ama", poem: "open" }, d);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("whole poem, both formats", () => {
  it("1080×1920 and 1080×1350 PNGs, private no-cache, an ETag, and a 304 when unchanged", async () => {
    await fixtures();
    const { d } = deps();
    const story = await handleShareImage(get("/p/ama/open/share-image"), { author: "ama", poem: "open" }, d);
    const chat = await handleShareImage(get("/p/ama/open/share-image?format=chat"), { author: "ama", poem: "open" }, d);
    expect(await pngSize(story)).toEqual([1080, 1920]);
    expect(await pngSize(chat)).toEqual([1080, 1350]);
    expect(chat.headers.get("cache-control")).toBe("private, no-cache");
    expect(chat.headers.get("content-disposition")).toBe('inline; filename="inkboard-open-chat.png"');
    expect(chat.headers.get("etag")).not.toBe(story.headers.get("etag"));
    const again = await handleShareImage(
      get("/p/ama/open/share-image?format=chat", { "If-None-Match": chat.headers.get("etag")! }),
      { author: "ama", poem: "open" },
      d,
    );
    expect(again.status).toBe(304);
  });
});

describe("a private, draft or unknown poem", () => {
  it("is the same 404 for every format and selection, before any selection parsing", async () => {
    await fixtures();
    const { d, parsed, renderPicked, limitRender } = deps();
    for (const slug of ["locked", "draft", "nope"]) {
      for (const query of ["", "?format=chat", "?lines=1", "?lines=1-3", "?lines=999", "?lines=zzz", "?lines=1&lines=2", "?format=chat&lines=2"]) {
        const res = await handleShareImage(get(`/p/ama/${slug}/share-image${query}`), { author: "ama", poem: slug }, d);
        expect(res.status, `${slug}${query}`).toBe(404);
        expect(await res.text()).toBe("Not found");
      }
    }
    // The selection was never looked at, nothing was drawn or counted.
    expect(parsed).not.toHaveBeenCalled();
    expect(renderPicked).not.toHaveBeenCalled();
    expect(limitRender).not.toHaveBeenCalled();
  });

  it("never has its text read: the loader returns nothing for it, the lines route is a 404 too", async () => {
    await fixtures();
    expect(await loadSharePoem("ama", "locked")).toBeNull();
    const lines = await handleShareLines({ author: "ama", poem: "locked" }, loadSharePoem);
    expect(lines.status).toBe(404);
    expect(await lines.text()).not.toContain(SECRET);
  });

  it("a poem made private stops at once: same 404, lines included", async () => {
    await fixtures();
    const { d } = deps();
    expect((await handleShareImage(get("/p/ama/open/share-image?lines=1"), { author: "ama", poem: "open" }, d)).status).toBe(200);
    await db.update(poems).set({ visibility: "private", passwordHash: "x" }).where(eq(poems.slug, "open"));
    for (const q of ["", "?format=chat", "?lines=1"]) {
      expect((await handleShareImage(get(`/p/ama/open/share-image${q}`), { author: "ama", poem: "open" }, d)).status, q).toBe(404);
    }
    expect((await handleShareLines({ author: "ama", poem: "open" }, loadSharePoem)).status).toBe(404);
  });
});

describe("picked lines", () => {
  it("renders a valid pick in both formats, uncached, and says how many lines fit", async () => {
    await fixtures();
    const { d, renderPicked } = deps({ limitRender: async () => ({ allowed: true, remaining: 1, retryAfter: 0 }) });
    const story = await handleShareImage(get("/p/ama/open/share-image?lines=2-4"), { author: "ama", poem: "open" }, d);
    expect(story.status).toBe(200);
    expect(await pngSize(story)).toEqual([1080, 1920]);
    expect(story.headers.get("x-share-lines-picked")).toBe("2");
    expect(story.headers.get("x-share-lines-shown")).toBe("2");
    expect(story.headers.get("content-disposition")).toBe('inline; filename="inkboard-open-lines.png"');
    const chat = await handleShareImage(get("/p/ama/open/share-image?format=chat&lines=1,4"), { author: "ama", poem: "open" }, d);
    expect(await pngSize(chat)).toEqual([1080, 1350]);
    expect(renderPicked).toHaveBeenCalledTimes(2);
    expect(renderPicked.mock.calls.map((c) => c[1])).toEqual([
      { format: "story", picked: [2, 4] },
      { format: "chat", picked: [1, 4] },
    ]);
  });

  it("a bad selection on a public poem is a 400 with nothing drawn", async () => {
    await fixtures();
    const { d, renderPicked, limitRender } = deps();
    // The poem has 5 lines; line 3 is blank.
    for (const raw of ["", "0", "6", "1-6", "3", "zzz", "2,1", "1,1", "1-2,2", "1,2", "1%2C2", "1-13"]) {
      const res = await handleShareImage(get(`/p/ama/open/share-image?lines=${raw}`), { author: "ama", poem: "open" }, d);
      expect(res.status, raw).toBe(400);
      expect(res.headers.get("cache-control"), raw).toContain("no-store");
    }
    expect((await handleShareImage(get("/p/ama/open/share-image?lines=1&lines=2"), { author: "ama", poem: "open" }, d)).status).toBe(400);
    expect(renderPicked).not.toHaveBeenCalled();
    expect(limitRender).not.toHaveBeenCalled();
  });

  it("the rate limit: counts only real renders, per IP bucket, then 429 with Retry-After; a 304 costs nothing", async () => {
    await fixtures();
    const { d, renderPicked } = deps(); // limit 2 per window in this test
    const first = await handleShareImage(get("/p/ama/open/share-image?lines=1"), { author: "ama", poem: "open" }, d);
    expect(first.status).toBe(200);
    // Revalidating that picture: a 304 from the ETag, without drawing or counting.
    for (let i = 0; i < 5; i++) {
      const res = await handleShareImage(
        get("/p/ama/open/share-image?lines=1", { "If-None-Match": first.headers.get("etag")! }),
        { author: "ama", poem: "open" },
        d,
      );
      expect(res.status).toBe(304);
    }
    expect((await handleShareImage(get("/p/ama/open/share-image?lines=2"), { author: "ama", poem: "open" }, d)).status).toBe(200);
    const over = await handleShareImage(get("/p/ama/open/share-image?lines=4"), { author: "ama", poem: "open" }, d);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(over.headers.get("cache-control")).toContain("no-store");
    expect(renderPicked).toHaveBeenCalledTimes(2);
    // Whole-poem pictures (cached) never count.
    expect((await handleShareImage(get("/p/ama/open/share-image?format=chat"), { author: "ama", poem: "open" }, d)).status).toBe(200);
    // Another network has its own budget.
    const other = deps({ limitRender: () => rateLimit(shareRenderKey("other-bucket"), 2, 600) });
    expect((await handleShareImage(get("/p/ama/open/share-image?lines=4"), { author: "ama", poem: "open" }, other.d)).status).toBe(200);
    const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key).sort();
    expect(keys).toEqual(["share:render:ip:other-bucket", "share:render:ip:test-bucket"]);
  });

  it("the production limit is per IP bucket, generous enough for a reader trying picks", () => {
    expect(SHARE_RENDER_LIMIT).toEqual({ limit: 60, windowSeconds: 600 });
    expect(shareRenderKey("203.0.113.7")).toBe("share:render:ip:203.0.113.7");
  });

  it("the ETag follows the pick, the format and the poem", async () => {
    await fixtures();
    const p = (await loadSharePoem("ama", "open")) as SharePoem;
    const tags = new Set([
      shareImageEtag(p, { format: "story" }),
      shareImageEtag(p, { format: "chat" }),
      shareImageEtag(p, { format: "story", picked: [1] }),
      shareImageEtag(p, { format: "story", picked: [1, 2] }),
      shareImageEtag(p, { format: "chat", picked: [1] }),
      shareImageEtag({ ...p, body: `${p.body} again` }, { format: "story", picked: [1] }),
      shareImageEtag({ ...p, penName: "Someone else" }, { format: "story" }),
    ]);
    expect(tags.size).toBe(7);
    expect(shareImageEtag(p, { format: "story", picked: [2, 1] })).toBe(shareImageEtag(p, { format: "story", picked: [1, 2] }));
  });
});

describe("the picker's lines", () => {
  it("a public poem's numbered lines and language, private no-cache", async () => {
    await fixtures();
    const res = await handleShareLines({ author: "ama", poem: "open" }, loadSharePoem);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(await res.json()).toEqual({
      language: "ak",
      lines: ["Sɛ wo werɛ fi na wosankɔfa a,", "yɛnkyiri.", "", "*It is no taboo to go back*", "*for what you forgot.*"],
    });
    for (const slug of ["draft", "nope"]) expect((await handleShareLines({ author: "ama", poem: slug }, loadSharePoem)).status).toBe(404);
  });
});
