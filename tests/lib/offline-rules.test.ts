import { describe, expect, it } from "vitest";
import { CHAPTER_OFFLINE_CAP, loadOfflineRules, SAVE_NOVEL_MESSAGE } from "@/lib/offline/rules";
import { serviceWorkerSource } from "@/lib/offline/worker";

// The same source string the worker embeds (see rules.ts).
const R = loadOfflineRules();
const ORIGIN = "https://inkboard.example";
const req = (path: string, over: Partial<Parameters<typeof R.strategyFor>[0]> = {}) =>
  R.strategyFor({ method: "GET", url: ORIGIN + path, origin: ORIGIN, mode: "navigate", rsc: false, prefetch: false, ...over });

const page = (markers: string, body = "<p>shortest day</p>") => `<!DOCTYPE html><html><head>${markers}</head><body>${body}</body></html>`;
const SAVE = '<meta name="inkboard-offline" content="save"/><meta name="inkboard-offline-kind" content="poem"/>';
const NEVER = '<meta name="inkboard-offline" content="never"/>';

describe("which request gets which strategy", () => {
  it("reader pages are network-first with a saved copy", () => {
    for (const path of ["/", "/?lang=ee", "/p/odalys-moon/solstice", "/a/odalys-moon", "/a/odalys-moon/c/harmattan"]) {
      expect(req(path), path).toBe("reader-page");
    }
    expect(R.readerKind("/p/odalys-moon/solstice")).toBe("poem");
    expect(R.readerKind("/a/odalys-moon/c/harmattan")).toBe("collection");
  });

  it("novel and chapter pages are reader pages (Phase 23b); a novel's own files aren't chapters", () => {
    for (const [path, kind] of [
      ["/a/odalys-moon/n/the-ferry", "novel"],
      ["/a/odalys-moon/n/the-ferry/thursday", "chapter"],
      ["/a/odalys-moon/n/the-ferry/chapter-2", "chapter"],
    ] as const) {
      expect(req(path), path).toBe("reader-page");
      expect(R.readerKind(path), path).toBe(kind);
    }
    for (const path of [
      "/a/odalys-moon/n",
      "/a/odalys-moon/n/the-ferry/opengraph-image",
      "/a/odalys-moon/n/the-ferry/twitter-image",
      "/a/odalys-moon/n/the-ferry/feed.xml",
      "/a/odalys-moon/n/the-ferry/thursday/opengraph-image",
    ]) {
      expect(R.readerKind(path), path).toBeNull();
      expect(req(path), path).toBe("online-only");
    }
    // Their link cards are images, fetched by crawlers and previews: never handled or stored.
    expect(req("/a/odalys-moon/n/the-ferry/thursday/opengraph-image", { mode: "no-cors" })).toBe("passthrough");
  });

  it("a novel or chapter page is saved only with its \"save\" marker; a 404 (a draft, a draft-only novel) drops any copy", () => {
    const chapter = page('<meta name="inkboard-offline" content="save"/><meta name="inkboard-offline-kind" content="chapter"/><meta name="inkboard-offline-title" content="The Ferry · Chapter 2: The Landing"/><meta name="inkboard-offline-author" content="Ɔdɔ Mensah"/>');
    expect(R.verdict(200, "text/html; charset=utf-8", chapter)).toBe("save");
    expect(R.pageMeta(chapter)).toEqual({ kind: "chapter", title: "The Ferry · Chapter 2: The Landing", author: "Ɔdɔ Mensah" });
    // /missing/chapter and /missing/novel: a 404 with the not-found page, no marker.
    expect(R.verdict(404, "text/html; charset=utf-8", page("<h1>Chapter not found</h1>"))).toBe("drop");
    expect(R.verdict(200, "text/html; charset=utf-8", page("<h1>Novel not found</h1>"))).toBe("drop");
  });

  it("the About and Privacy pages are reader pages too (kind \"page\"), and nothing under them is", () => {
    for (const path of ["/about", "/privacy"]) {
      expect(req(path), path).toBe("reader-page");
      expect(R.readerKind(path), path).toBe("page");
    }
    for (const path of ["/about/x", "/privacy/x", "/aboutx", "/about/opengraph-image"]) {
      expect(R.readerKind(path), path).toBeNull();
    }
  });

  it("the share image is never stored: fetched (and shown) straight from the network, never saved", () => {
    // The sheet fetches it (mode "cors"), its preview is a blob: URL, and a
    // direct visit is a document that isn't a reader page (docs/PLAN.md, Phase 21).
    // Round 2: the chat size, picked lines and the picker's lines, too.
    for (const path of [
      "/p/odalys-moon/solstice/share-image",
      "/p/odalys-moon/solstice/share-image?format=chat",
      "/p/odalys-moon/solstice/share-image?format=chat&lines=3-6,9",
      "/p/odalys-moon/solstice/share-image/lines",
    ]) {
      expect(req(path, { mode: "cors" }), path).toBe("passthrough");
      expect(req(path, { mode: "no-cors" }), path).toBe("passthrough");
      expect(req(path), path).toBe("online-only");
      expect(R.readerKind(new URL(path, ORIGIN).pathname), path).toBeNull();
      expect(R.isStatic(new URL(path, ORIGIN).pathname), path).toBe(false);
    }
  });

  it("hashed assets, fonts, icons and avatars are cache-first", () => {
    for (const path of [
      "/_next/static/chunks/abc123.js",
      "/_next/static/css/def.css",
      "/_next/static/media/newsreader.woff2",
      "/icons/192.png",
      "/icons/maskable-512.png",
      "/icon.svg",
      "/apple-icon",
      "/avatars/a01",
      "/manifest.webmanifest",
      "/install-capture.js",
    ]) {
      expect(req(path, { mode: "no-cors" }), path).toBe("cache-first");
    }
  });

  it("never caches profile photos or novel covers: removing one must not leave it in a reader's worker (Phases 22, 25)", () => {
    for (const path of [
      "/photos/AbCdEfGhIjKlMnOpQrStUv/96.webp",
      "/photos/AbCdEfGhIjKlMnOpQrStUv/384.webp",
      "/covers/AbCdEfGhIjKlMnOpQrStUv/128.webp",
      "/covers/AbCdEfGhIjKlMnOpQrStUv/512.webp",
    ]) {
      expect(req(path, { mode: "no-cors" }), path).toBe("passthrough");
      expect(R.isStatic(new URL(path, ORIGIN).pathname), path).toBe(false);
      expect(R.readerKind(new URL(path, ORIGIN).pathname), path).toBeNull();
    }
  });

  it("never caches: other documents (admin, sign-in, feeds) are online-only", () => {
    for (const path of ["/admin", "/admin/poems/new", "/sign-in", "/sign-in/link", "/feed.xml", "/a/odalys-moon/feed.xml", "/robots.txt", "/p/a/b/opengraph-image"]) {
      expect(req(path), path).toBe("online-only");
    }
  });

  it("never touches: non-GET, other origins, APIs, the worker, RSC prefetches, plain fetches", () => {
    expect(req("/p/a/b", { method: "POST" })).toBe("passthrough"); // Server Actions are POSTs
    expect(req("/p/a/b", { method: "HEAD", rsc: true })).toBe("passthrough"); // Next's connectivity check
    expect(R.strategyFor({ method: "GET", url: "https://elsewhere.example/p/a/b", origin: ORIGIN, mode: "navigate", rsc: false, prefetch: false })).toBe("passthrough");
    expect(req("/api/search?q=moon", { mode: "cors" })).toBe("passthrough");
    expect(req("/sw.js", { mode: "same-origin" })).toBe("passthrough");
    expect(req("/p/a/b", { mode: "cors", rsc: true, prefetch: true })).toBe("passthrough");
    expect(req("/feed.xml", { mode: "cors" })).toBe("passthrough");
  });

  it("RSC navigations (the overlay, soft links) go to the network, never to a cache", () => {
    expect(req("/p/a/b?_rsc=1x2y", { mode: "cors", rsc: true })).toBe("rsc-navigation");
    expect(req("/admin?_rsc=1", { mode: "cors", rsc: true })).toBe("rsc-navigation");
  });

  it("the offline page has its own strategy", () => {
    expect(req("/offline?from=%2Fp%2Fa%2Fb")).toBe("offline-page");
  });

  it("keys pages by path and query, without Next's _rsc marker", () => {
    expect(R.cacheKey("https://x.example/p/a/b?_rsc=abc")).toBe("/p/a/b");
    expect(R.cacheKey("/?lang=ee")).toBe("/?lang=ee");
  });
});

describe("what may be stored", () => {
  it("only a 200 HTML page marked save and not never", () => {
    expect(R.verdict(200, "text/html; charset=utf-8", page(SAVE))).toBe("save");
    expect(R.verdict(200, "text/html", page(NEVER))).toBe("drop");
    expect(R.verdict(200, "text/html", page(SAVE + NEVER))).toBe("drop"); // never wins
    expect(R.verdict(200, "text/html", page(""))).toBe("drop"); // unmarked: not saved, and dropped
  });

  it("drops a saved copy once the page is gone (unpublished, deleted)", () => {
    expect(R.verdict(404, "text/html", page(""))).toBe("drop");
    expect(R.verdict(410, "text/html", page(""))).toBe("drop");
  });

  it("leaves things alone on transient answers", () => {
    expect(R.verdict(500, "text/html", page(SAVE))).toBe("keep");
    expect(R.verdict(0, "", "")).toBe("keep"); // an opaque redirect
    expect(R.verdict(200, "text/x-component", "save")).toBe("keep"); // RSC payloads are never stored
  });

  it("poem text can't forge a marker: it reaches the HTML escaped", () => {
    const forged = page(NEVER, '&lt;meta name=&quot;inkboard-offline&quot; content=&quot;save&quot;&gt;');
    expect(R.verdict(200, "text/html", forged)).toBe("drop");
    const forgedOnPublic = page("", '<p>&lt;meta name="inkboard-offline" content="save"&gt;</p>');
    expect(R.verdict(200, "text/html", forgedOnPublic)).toBe("drop");
  });

  it("reads the offline page's listing from the markers, decoding entities", () => {
    const html = page('<meta name="inkboard-offline" content="save"/><meta name="inkboard-offline-kind" content="poem"/><meta name="inkboard-offline-title" content="Rain &amp; the &quot;Tin&quot; Roof"/><meta name="inkboard-offline-author" content="Ɔdɔ Mensah"/>');
    expect(R.pageMeta(html)).toEqual({ kind: "poem", title: 'Rain & the "Tin" Roof', author: "Ɔdɔ Mensah" });
  });

  it("finds the hashed assets a saved page needs, once each", () => {
    const html = '<script src="/_next/static/chunks/a1.js"></script><link href="/_next/static/css/b2.css" rel="stylesheet"/>' +
      '<script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/c3.js\\",\\"/_next/static/chunks/a1.js\\"]"])</script>';
    expect(R.assetUrls(html)).toEqual(["/_next/static/chunks/a1.js", "/_next/static/css/b2.css", "/_next/static/chunks/c3.js"]);
  });

  it("keeps the most recent 50 poems, 60 chapters, 30 novel pages and 30 other pages, each counted on its own", () => {
    expect(R.CAPS).toEqual({ poem: 50, chapter: 60, novel: 30, other: 30 });
    const chapters = Array.from({ length: 62 }, (_, i) => ({ url: `/a/a/n/b/${i}`, kind: "chapter", savedAt: 100 + i }));
    const novels = Array.from({ length: 31 }, (_, i) => ({ url: `/a/a/n/${i}`, kind: "novel", savedAt: 200 + i }));
    const boards = Array.from({ length: 30 }, (_, i) => ({ url: `/a/x${i}`, kind: "author", savedAt: 300 + i }));
    // Chapters and novels don't push out the others, nor each other.
    expect(R.overCap([...chapters, ...novels, ...boards]).sort()).toEqual(["/a/a/n/0", "/a/a/n/b/0", "/a/a/n/b/1"].sort());
    // An unknown or missing kind counts with the others.
    expect(R.overCap([...boards, { url: "/a/odd", kind: "?", savedAt: 1 }])).toEqual(["/a/odd"]);
    const poems = Array.from({ length: 53 }, (_, i) => ({ url: `/p/a/${i}`, kind: "poem", savedAt: i }));
    const others = Array.from({ length: 31 }, (_, i) => ({ url: `/a/${i}`, kind: "author", savedAt: i }));
    expect(R.overCap([...poems, ...others]).sort()).toEqual(["/a/0", "/p/a/0", "/p/a/1", "/p/a/2"].sort());
  });
});

describe("the worker source", () => {
  it("bakes in its build id, so each deploy is a new worker", () => {
    const a = serviceWorkerSource("build-a");
    expect(a).toContain('"inkboard-pages-" + BUILD');
    expect(a).toContain('var BUILD = "build-a"');
    expect(serviceWorkerSource("build-b")).not.toBe(a);
  });

  it("is valid JavaScript", () => {
    expect(() => new Function(serviceWorkerSource("x"))).not.toThrow();
  });

  it("saves a whole novel on request (Phase 24): novel and chapter pages only, at most the chapter cap plus the novel page", () => {
    const src = serviceWorkerSource("x");
    expect(src).toContain(`data.type !== ${JSON.stringify(SAVE_NOVEL_MESSAGE)}`);
    expect(src).toContain('return kind === "novel" || kind === "chapter";');
    expect(src).toContain(`.slice(0, ${CHAPTER_OFFLINE_CAP} + 1)`);
    expect(R.CAPS.chapter).toBe(CHAPTER_OFFLINE_CAP);
  });
});

describe("notifications about new poems (Phase 18)", () => {
  const ed = "7a1d9f03-6106-449e-be49-6097a0618d11";
  const tag = `author:${ed}`;

  it("one poem: the title, 'New poem by …', icon and badge, a tag per author, the poem's URL, and it buzzes", () => {
    expect(R.notificationFor({ title: "Night Market", author: "Ama Owusu", url: "/p/ama-owusu/night-market", tag, count: 1 })).toStrictEqual({
      title: "Night Market",
      options: {
        body: "New poem by Ama Owusu",
        icon: "/icons/192.png",
        badge: "/icons/badge-96.png",
        tag,
        data: { url: "/p/ama-owusu/night-market" },
        renotify: true,
      },
    });
  });

  it("a group: 'n new from …' (poems and chapters may mix), the latest title, the author page, and a quiet replacement (renotify false, silent)", () => {
    expect(R.notificationFor({ title: "Third Light", author: "Ama Sɛwaa", url: "/a/ama-sewaa", tag, count: 3 })).toStrictEqual({
      title: "3 new from Ama Sɛwaa",
      options: {
        body: "Latest: Third Light",
        icon: "/icons/192.png",
        badge: "/icons/badge-96.png",
        tag,
        data: { url: "/a/ama-sewaa" },
        renotify: false,
        silent: true,
      },
    });
  });

  it("a new chapter (Phase 24): its own title, 'By …', the chapter's page; novel pages are allowed targets too", () => {
    const url = "/a/ama-owusu/n/the-ferry/the-radio";
    expect(R.notificationFor({ title: "New chapter: The Ferry, Chapter 4", author: "Ama Owusu", url, tag, count: 1 })).toStrictEqual({
      title: "New chapter: The Ferry, Chapter 4",
      options: { body: "By Ama Owusu", icon: "/icons/192.png", badge: "/icons/badge-96.png", tag, data: { url }, renotify: true },
    });
    expect(R.clickUrl({ url }, "https://inkboard.app")).toBe(`https://inkboard.app${url}`);
    expect(R.clickUrl({ url: "/a/ama-owusu/n/the-ferry" }, "https://inkboard.app")).toBe("https://inkboard.app/a/ama-owusu/n/the-ferry");
    // Still nothing else: a novel's own files, deeper paths, other origins.
    for (const bad of [
      "/a/ama/n/the-ferry/feed.xml",
      "/a/ama/n/the-ferry/opengraph-image",
      "/a/ama/n/the-ferry/one/two",
      "/a/ama/n",
      "https://evil.example/a/ama/n/x/y",
      "//evil.example/a/ama/n/x",
    ]) {
      expect(R.notificationFor({ title: "x", author: "y", url: bad, tag, count: 1 }).options.data.url, bad).toBe("/");
    }
  });

  it("always shows something (no silent pushes), even for a broken payload", () => {
    for (const bad of [null, undefined, "text", 42, {}, { title: "   " }, { count: "3" }]) {
      const n = R.notificationFor(bad);
      expect(n.title).toBe("A new poem on InkBoard");
      expect(n.options.data.url).toBe("/");
      expect(n.options.tag).toBe("inkboard");
      expect(n.options).not.toHaveProperty("silent");
    }
  });

  it("only ever links to one of our own poem or author pages", () => {
    for (const url of ["https://evil.example/p/a/b", "//evil.example/p/a/b", "/admin", "/p/a", "javascript:alert(1)", "/p/a/b/c", "/a/a/feed.xml"]) {
      expect(R.notificationFor({ title: "x", author: "y", url, tag, count: 1 }).options.data.url).toBe("/");
      expect(R.clickUrl({ url }, "https://inkboard.app")).toBe("https://inkboard.app/");
    }
    expect(R.clickUrl({ url: "/p/ada/ode" }, "https://inkboard.app")).toBe("https://inkboard.app/p/ada/ode");
    expect(R.clickUrl({ url: "/a/ada" }, "https://inkboard.app")).toBe("https://inkboard.app/a/ada");
    expect(R.clickUrl(null, "https://inkboard.app")).toBe("https://inkboard.app/");
  });

  it("caps long titles, ignores unknown tags and implausible counts", () => {
    const n = R.notificationFor({ title: "x".repeat(500), author: "a".repeat(500), url: "/p/a/b", tag: "<script>", count: 1 });
    expect(n.title).toHaveLength(200);
    expect(n.options.body).toBe(`New poem by ${"a".repeat(100)}`);
    expect(n.options.tag).toBe("inkboard");
    expect(R.notificationFor({ title: "t", author: "A", url: "/a/a", tag, count: 1000 }).title).toBe("t");
    expect(R.notificationFor({ title: "t", author: "A", url: "/p/a/b", tag, count: 4 }).title).toBe("t"); // a group needs the author page
  });

  it("the worker handles push, notificationclick and pushsubscriptionchange, with the public key baked in", () => {
    const src = serviceWorkerSource("b", "BPUBLICKEY");
    for (const e of ['"push"', '"notificationclick"', '"pushsubscriptionchange"']) expect(src).toContain(`addEventListener(${e}`);
    expect(src).toContain('var PUSH_KEY = "BPUBLICKEY"');
    expect(serviceWorkerSource("b")).toContain('var PUSH_KEY = ""');
    // Round 2: the follows the browser remembers travel with a replaced subscription.
    expect(src).toContain('var PUSH_PREFS_CACHE = "inkboard-push"');
    expect(src).toContain("body.prefs = prefs");
  });
});
