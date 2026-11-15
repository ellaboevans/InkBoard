import { describe, expect, it } from "vitest";
import { loadOfflineRules } from "@/lib/offline/rules";
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

  it("keeps the most recent 50 poems and 30 other pages", () => {
    expect(R.CAPS).toEqual({ poem: 50, other: 30 });
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
});
