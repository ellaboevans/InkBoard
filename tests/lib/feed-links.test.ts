import { describe, expect, it } from "vitest";
import {
  ATOM_TYPE,
  authorPageAlternates,
  boardAlternates,
  chapterPageAlternates,
  collectionPageAlternates,
  novelPageAlternates,
  poemPageAlternates,
  serialsPageAlternates,
} from "@/lib/feed-links";
import { chapterPath, novelPath } from "@/lib/novel-seo";
import { absoluteUrl } from "@/lib/site";

/*
 * Every reader page's `alternates`: its canonical URL and its feed links, most
 * specific first (CLAUDE.md "Feeds"). The pages' generateMetadata return
 * exactly these (they can't run under Vitest: their loaders use next/cache).
 */
const feeds = (a: { types: Record<string, { url: string; title: string }[]> }) => a.types[ATOM_TYPE];
const site = { url: absoluteUrl("/feed.xml"), title: "InkBoard: new poems" };
const author = { url: absoluteUrl("/a/ama/feed.xml"), title: "Ama Ɔdɔ on InkBoard" };
const novelFeed = { url: absoluteUrl("/a/ama/n/ferry/feed.xml"), title: "The Ferry, by Ama Ɔdɔ" };

describe("each reader page's feed links", () => {
  it("board: the site feed only", () => {
    const a = boardAlternates();
    expect(a.canonical).toBe("/");
    expect(feeds(a)).toEqual([site]);
  });

  it("novels page (Phase 29): the site feed only", () => {
    const a = serialsPageAlternates();
    expect(a.canonical).toBe("/novels");
    expect(feeds(a)).toEqual([site]);
  });

  it("author page: the author's feed, then the site's", () => {
    const a = authorPageAlternates({ slug: "ama", penName: "Ama Ɔdɔ" });
    expect(a.canonical).toBe("/a/ama");
    expect(feeds(a)).toEqual([author, site]);
  });

  it("collection page: the author's feed, then the site's", () => {
    const a = collectionPageAlternates({ authorSlug: "ama", penName: "Ama Ɔdɔ", slug: "harmattan" });
    expect(a.canonical).toBe("/a/ama/c/harmattan");
    expect(feeds(a)).toEqual([author, site]);
  });

  it("poem page: the author's feed, then the site's", () => {
    const a = poemPageAlternates({ authorSlug: "ama", penName: "Ama Ɔdɔ", slug: "dry-wind" });
    expect(a.canonical).toBe("/p/ama/dry-wind");
    expect(feeds(a)).toEqual([author, site]);
  });

  it("novel page: the novel's feed, the author's, then the site's", () => {
    const a = novelPageAlternates({ authorSlug: "ama", penName: "Ama Ɔdɔ", slug: "ferry", title: "The Ferry" });
    expect(a.canonical).toBe(novelPath("ama", "ferry"));
    expect(feeds(a)).toEqual([novelFeed, author, site]);
  });

  it("chapter page: the novel's feed, the author's, then the site's", () => {
    const a = chapterPageAlternates({ authorSlug: "ama", penName: "Ama Ɔdɔ", slug: "thursday", novel: { slug: "ferry", title: "The Ferry" } });
    expect(a.canonical).toBe(chapterPath("ama", "ferry", "thursday"));
    expect(feeds(a)).toEqual([novelFeed, author, site]);
  });

  it("every feed URL is absolute", () => {
    const all = [
      boardAlternates(),
      authorPageAlternates({ slug: "ama", penName: "A" }),
      chapterPageAlternates({ authorSlug: "ama", penName: "A", slug: "c", novel: { slug: "n", title: "N" } }),
    ].flatMap(feeds);
    for (const f of all) expect(f.url).toMatch(/^https?:\/\/[^/]+\//);
  });
});
