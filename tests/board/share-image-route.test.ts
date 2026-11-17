import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors, poems, rateLimits, shortLinks } from "@/db/schema";
import { loadSharePoem, type SharePoem } from "@/server/board";
import { rateLimit } from "@/server/rate-limit";
import { renderShareImage, shareImageEtag, shareImageLayout } from "@/server/share-image";
import { ensureShortCode } from "@/server/short-links";
import {
  handleShareImage,
  handleShareLines,
  parseDesign,
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
  const ensure = vi.fn(ensureShortCode);
  const whole = vi.fn(async (a: string, s: string, format: "story" | "chat", design: "page" | "ink" | "board", shortCode: string) => {
    const p = await loadSharePoem(a, s);
    return p ? renderShareImage({ ...p, shortCode }, { format, design }) : null;
  });
  const d: ShareRouteDeps = {
    getPoem,
    getWholeImage: whole,
    ensureShortCode: ensure,
    renderPicked,
    etagFor: shareImageEtag,
    limitRender,
    onParseSelection: parsed,
    ...over,
  };
  return { d, getPoem, renderPicked, parsed, limitRender, ensure, whole };
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

describe("design (round 3)", () => {
  it("absent is Page; page, ink and board are known; anything else or twice is unknown", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(parseDesign(q(""))).toBe("page");
    for (const d of ["page", "ink", "board"]) expect(parseDesign(q(`design=${d}`))).toBe(d);
    for (const s of ["design=", "design=Ink", "design=dark", "design=ink&design=ink", "design=page&design=board"]) {
      expect(parseDesign(q(s)), s).toBeNull();
    }
  });

  it("an unknown design is a 404 before the poem is even looked up", async () => {
    await fixtures();
    const { d, getPoem, ensure } = deps();
    for (const q of ["?design=dark", "?design=ink&design=board", "?format=chat&design=", "?design=board&format=square"]) {
      const res = await handleShareImage(get(`/p/ama/open/share-image${q}`), { author: "ama", poem: "open" }, d);
      expect(res.status, q).toBe(404);
    }
    expect(getPoem).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it("each design and format is its own picture, file name and ETag; picked lines work in every design", async () => {
    await fixtures();
    const { d, whole } = deps({ limitRender: async () => ({ allowed: true, remaining: 9, retryAfter: 0 }) });
    const tags = new Set<string>();
    for (const design of ["page", "ink", "board"] as const) {
      for (const format of ["story", "chat"] as const) {
        const q = new URLSearchParams({ ...(format === "chat" ? { format } : {}), ...(design !== "page" ? { design } : {}) });
        const res = await handleShareImage(get(`/p/ama/open/share-image?${q}`), { author: "ama", poem: "open" }, d);
        expect(res.status).toBe(200);
        expect(await pngSize(res)).toEqual([1080, format === "chat" ? 1350 : 1920]);
        const suffix = `${format === "chat" ? "-chat" : ""}${design === "page" ? "" : `-${design}`}`;
        expect(res.headers.get("content-disposition")).toBe(`inline; filename="inkboard-open${suffix}.png"`);
        tags.add(res.headers.get("etag")!);
        const picked = await handleShareImage(get(`/p/ama/open/share-image?${q}&lines=1-2`), { author: "ama", poem: "open" }, d);
        expect(picked.status).toBe(200);
        expect(picked.headers.get("content-disposition")).toBe(`inline; filename="inkboard-open${suffix}-lines.png"`);
        tags.add(picked.headers.get("etag")!);
      }
    }
    expect(tags.size).toBe(12);
    expect(whole.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ["story", "page"],
      ["chat", "page"],
      ["story", "ink"],
      ["chat", "ink"],
      ["story", "board"],
      ["chat", "board"],
    ]);
  });
});

describe("the short link on the picture (round 3)", () => {
  it("the first picture makes the poem's code; later ones reuse it; it's what gets printed", async () => {
    await fixtures();
    const { d, ensure, whole } = deps();
    expect(await db.select().from(shortLinks)).toEqual([]);
    const first = await handleShareImage(get("/p/ama/open/share-image"), { author: "ama", poem: "open" }, d);
    const [link] = await db.select().from(shortLinks);
    expect(first.headers.get("x-share-address")).toBe(`/s/${link.code}`);
    expect(link.code).toMatch(/^[23456789bcdfghjkmnpqrstvwxz]{6}$/);
    expect(whole.mock.calls[0][4]).toBe(link.code);
    await handleShareImage(get("/p/ama/open/share-image?format=chat"), { author: "ama", poem: "open" }, d);
    expect(await db.select().from(shortLinks)).toHaveLength(1);
    expect(ensure).toHaveBeenCalledTimes(1); // the second request found the code on the poem
    const p = (await loadSharePoem("ama", "open"))!;
    expect(p.shortCode).toBe(link.code);
    expect((await shareImageLayout(p)).address.pathRows).toEqual([`/s/${link.code}`]);
  });

  it("the ETag follows the code", async () => {
    await fixtures();
    const p = (await loadSharePoem("ama", "open"))!;
    expect(shareImageEtag({ ...p, shortCode: "bbbbbb" }, { format: "story" })).not.toBe(shareImageEtag({ ...p, shortCode: "cccccc" }, { format: "story" }));
  });

  it("never made for a private poem or a draft, whatever is asked", async () => {
    await fixtures();
    const { d, ensure } = deps();
    for (const slug of ["locked", "draft"]) {
      for (const q of ["", "?design=ink", "?lines=1"]) {
        expect((await handleShareImage(get(`/p/ama/${slug}/share-image${q}`), { author: "ama", poem: slug }, d)).status).toBe(404);
      }
    }
    expect(ensure).not.toHaveBeenCalled();
    expect(await db.select().from(shortLinks)).toEqual([]);
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
      { format: "story", design: "page", picked: [2, 4] },
      { format: "chat", design: "page", picked: [1, 4] },
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
