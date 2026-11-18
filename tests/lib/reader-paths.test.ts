import { describe, expect, it } from "vitest";
import { isDocumentRequest, readerPathFromPathname } from "@/lib/reader-paths";

// The pages whose 404s the proxy decides (docs/PLAN.md, Phase 19).
describe("readerPathFromPathname", () => {
  it("recognises author, collection and poem pages, decoding their segments like Next does", () => {
    expect(readerPathFromPathname("/a/ama-serwaa")).toEqual({ kind: "author", author: "ama-serwaa" });
    expect(readerPathFromPathname("/a/ama-serwaa/")).toEqual({ kind: "author", author: "ama-serwaa" });
    expect(readerPathFromPathname("/a/ama/c/harmattan")).toEqual({ kind: "collection", author: "ama", collection: "harmattan" });
    expect(readerPathFromPathname("/p/ama/rain")).toEqual({ kind: "poem", author: "ama", poem: "rain" });
    expect(readerPathFromPathname("/p/%C9%94d%C9%94/x")).toEqual({ kind: "poem", author: "ɔdɔ", poem: "x" });
  });

  it("recognises novel and chapter pages (Phase 23b)", () => {
    expect(readerPathFromPathname("/a/ama/n/the-ferry")).toEqual({ kind: "novel", author: "ama", novel: "the-ferry" });
    expect(readerPathFromPathname("/a/ama/n/the-ferry/")).toEqual({ kind: "novel", author: "ama", novel: "the-ferry" });
    expect(readerPathFromPathname("/a/ama/n/the-ferry/thursday")).toEqual({
      kind: "chapter",
      author: "ama",
      novel: "the-ferry",
      chapter: "thursday",
    });
    expect(readerPathFromPathname("/a/ama/n/%C9%94d%C9%94/chapter-2/")).toEqual({
      kind: "chapter",
      author: "ama",
      novel: "ɔdɔ",
      chapter: "chapter-2",
    });
  });

  it("leaves a novel's own files (link cards, feed: a later round) to their routes", () => {
    for (const path of [
      "/a/ama/n",
      "/a/ama/n/the-ferry/opengraph-image",
      "/a/ama/n/the-ferry/twitter-image",
      "/a/ama/n/the-ferry/feed.xml",
      "/a/ama/n/the-ferry/thursday/opengraph-image",
    ]) {
      expect(readerPathFromPathname(path), path).toBeNull();
    }
  });

  it("ignores every other route under /a and /p, and anything else", () => {
    for (const path of [
      "/",
      "/a",
      "/a/",
      "/a/ama/feed.xml",
      "/a/ama/opengraph-image",
      "/a/ama/c",
      "/a/ama/c/x/opengraph-image",
      "/p/ama",
      "/p/ama/rain/opengraph-image",
      "/about",
      "/admin/poems/x",
    ]) {
      expect(readerPathFromPathname(path), path).toBeNull();
    }
  });

  it("returns null for a segment that can't be decoded (Next answers those itself)", () => {
    expect(readerPathFromPathname("/a/%E0%A4%A")).toBeNull();
  });
});

describe("isDocumentRequest", () => {
  const req = (headers: Record<string, string> = {}, { method = "GET", url = "http://x/a/b" } = {}) =>
    isDocumentRequest({ method, headers: new Headers(headers), url });

  it("is true for full page loads (GET or HEAD)", () => {
    expect(req()).toBe(true);
    expect(req({}, { method: "HEAD" })).toBe(true);
  });

  it("is false for soft navigations, prefetches (the overlay included) and Server Actions", () => {
    expect(req({ RSC: "1" })).toBe(false);
    expect(req({ "Next-Router-Prefetch": "1" })).toBe(false);
    expect(req({ "Next-Router-State-Tree": "%5B%5D" })).toBe(false);
    expect(req({}, { url: "http://x/a/b?_rsc=abc" })).toBe(false);
    expect(req({}, { method: "POST" })).toBe(false);
  });
});
