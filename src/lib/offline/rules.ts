/**
 * The service worker's pure rules (docs/PLAN.md, Phase 15 round 2): which
 * request gets which strategy, and whether a fetched page may be kept.
 *
 * They are plain JavaScript in a string because the worker (/sw.js, built by
 * worker.ts) embeds this source verbatim. tests/lib/offline-rules.test.ts
 * evaluates the same string, so what's tested is exactly what ships.
 *
 * THE STORAGE RULE (what may be saved for offline reading):
 *   1. Only reader pages: the board (/), poem pages (/p/a/b), author pages
 *      (/a/a), collection pages (/a/a/c/c), novel pages (/a/a/n/n) and
 *      chapter pages (/a/a/n/n/c; Phase 23b), and the About and Privacy pages
 *      (/about, /privacy; kind "page", Phase 19). A novel's own files
 *      (opengraph-image, twitter-image, feed.xml) are never chapters. Never /admin, /sign-in, /api,
 *      the feeds, /sw.js, anything that isn't a GET, any RSC request
 *      (navigations, prefetches, the overlay) or Server Action.
 *   2. The saved copy is never the response the reader got. The worker
 *      fetches the page again with `credentials: "omit"`: no session, no
 *      unlock cookie, so it is the same for everyone and can't hold a private
 *      poem's unlocked text or anything specific to one editor.
 *   3. That copy is kept only if it is a 200 text/html page carrying
 *      <meta name="inkboard-offline" content="save"> and NOT
 *      <meta name="inkboard-offline" content="never"> (a private poem's page
 *      carries "never" whatever the reader unlocked). Poem text can't forge
 *      either tag: in HTML it is escaped (`<` becomes `&lt;`).
 *   4. A 404/410, a "never" page, or a 200 page without "save" deletes any
 *      saved copy (unpublished, deleted or now-private poems). Other
 *      statuses (5xx, redirects) leave things as they are.
 */
/** Chapters a device keeps for offline reading (all novels together), newest first. */
export const CHAPTER_OFFLINE_CAP = 60;

export const OFFLINE_RULES_JS = String.raw`
var InkboardOffline = (function () {
  var POEM = /^\/p\/[^/]+\/[^/]+$/;
  var AUTHOR = /^\/a\/[^/]+$/;
  var COLLECTION = /^\/a\/[^/]+\/c\/[^/]+$/;
  var NOVEL = /^\/a\/[^/]+\/n\/[^/]+$/;
  var CHAPTER = /^\/a\/[^/]+\/n\/[^/]+\/([^/]+)$/;
  var NOVEL_FILES = ["opengraph-image", "twitter-image", "feed.xml"];
  var PAGES = ["/about", "/privacy"];
  // Hashed build assets (JS, CSS, next/font files), icons and avatars: cache-first.
  // Never /photos/ (profile photos, Phase 22): they pass through to the browser's
  // own cache (an hour), so a removed photo can't outlive that in the worker.
  var STATIC_PREFIXES = ["/_next/static/", "/icons/", "/avatars/"];
  var STATIC_FILES = ["/icon.svg", "/apple-icon", "/favicon.ico", "/manifest.webmanifest", "/install-capture.js"];
  // Saved pages kept per kind, newest first: poems, chapters (a commute's
  // worth of a novel) and novel pages each have their own; everything else
  // (board, author, collection, About, Privacy) shares "other".
  var CAPS = { poem: 50, chapter: ${CHAPTER_OFFLINE_CAP}, novel: 30, other: 30 };

  function readerKind(pathname) {
    if (pathname === "/") return "board";
    if (POEM.test(pathname)) return "poem";
    if (COLLECTION.test(pathname)) return "collection";
    if (NOVEL.test(pathname)) return "novel";
    var chapter = CHAPTER.exec(pathname);
    if (chapter && NOVEL_FILES.indexOf(chapter[1]) === -1) return "chapter";
    if (AUTHOR.test(pathname)) return "author";
    if (PAGES.indexOf(pathname) !== -1) return "page";
    return null;
  }

  function isStatic(pathname) {
    if (STATIC_FILES.indexOf(pathname) !== -1) return true;
    for (var i = 0; i < STATIC_PREFIXES.length; i++) if (pathname.indexOf(STATIC_PREFIXES[i]) === 0) return true;
    return false;
  }

  /**
   * req: { method, url, origin, mode, rsc, prefetch }
   *   rsc: the RSC header (or an _rsc query) is present; prefetch: a Next prefetch header is.
   * Returns one of:
   *   "passthrough"     not ours to handle (non-GET, other origins, RSC prefetches, /sw.js, APIs…)
   *   "cache-first"     hashed assets, icons, avatars
   *   "reader-page"     network-first, then the saved copy, then the offline page
   *   "offline-page"    the offline page itself: network-first, then the copy saved at install
   *   "online-only"     other documents (/admin, /sign-in, feeds…): network, else the offline page; never saved
   *   "rsc-navigation"  a soft navigation: network; offline, an answer that makes Next load the page as a document
   */
  function strategyFor(req) {
    var url = new URL(req.url);
    if (req.method !== "GET") return "passthrough";
    if (url.origin !== req.origin) return "passthrough";
    var path = url.pathname;
    if (path === "/sw.js") return "passthrough";
    if (req.rsc) return req.prefetch ? "passthrough" : "rsc-navigation";
    if (isStatic(path)) return "cache-first";
    if (req.mode !== "navigate") return "passthrough";
    if (path === "/offline") return "offline-page";
    if (readerKind(path)) return "reader-page";
    return "online-only";
  }

  /** The key a reader page is saved under: path and query, without Next's _rsc marker. */
  function cacheKey(href) {
    var url = new URL(href, "http://x");
    url.searchParams.delete("_rsc");
    return url.pathname + url.search;
  }

  var SAVE = /<meta name="inkboard-offline" content="save"/;
  var NEVER = /<meta name="inkboard-offline" content="never"/;

  /** "save" | "drop" | "keep" for a page fetched without cookies (rules 3 and 4 above). */
  function verdict(status, contentType, html) {
    if (status === 404 || status === 410) return "drop";
    if (status !== 200) return "keep";
    if (String(contentType).indexOf("text/html") !== 0) return "keep";
    if (NEVER.test(html)) return "drop";
    if (SAVE.test(html)) return "save";
    return "drop";
  }

  function decode(s) {
    return s
      .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  function metaContent(html, name) {
    var m = new RegExp('<meta name="' + name + '" content="([^"]*)"').exec(html);
    return m ? decode(m[1]) : null;
  }

  /** What the offline page lists: kind, title and author, from the page's own markers. */
  function pageMeta(html) {
    return {
      kind: metaContent(html, "inkboard-offline-kind"),
      title: metaContent(html, "inkboard-offline-title"),
      author: metaContent(html, "inkboard-offline-author"),
    };
  }

  /** Same-origin hashed assets a saved page needs (scripts, styles, fonts, lazy chunks named in its payload). */
  function assetUrls(html) {
    var seen = {};
    var out = [];
    var re = /\/_next\/static\/[A-Za-z0-9_\-.~@%/]+/g;
    var m;
    while ((m = re.exec(html))) {
      var u = m[0].replace(/[.]+$/, "");
      if (!seen[u]) { seen[u] = true; out.push(u); }
    }
    return out;
  }

  /**
   * Keep the most recent CAPS[kind] pages of each kind with its own cap, and
   * CAPS.other of everything else together.
   * index: [{ url, kind, savedAt }]; returns the urls to remove.
   */
  function overCap(index) {
    var byTime = index.slice().sort(function (a, b) { return b.savedAt - a.savedAt; });
    var counts = {}, drop = [];
    for (var i = 0; i < byTime.length; i++) {
      var kind = byTime[i].kind;
      var bucket = kind !== "other" && Object.prototype.hasOwnProperty.call(CAPS, kind) ? kind : "other";
      counts[bucket] = (counts[bucket] || 0) + 1;
      if (counts[bucket] > CAPS[bucket]) drop.push(byTime[i].url);
    }
    return drop;
  }

  // ---- notifications about new poems (Phase 18) -------------------------------
  // A push is { title, author, url, tag, count } (src/lib/push-rules.ts). Every
  // push must show a notification (iOS revokes subscriptions that get silent
  // ones), so anything malformed still shows a plain one that opens the board.
  // One notification per author (tag author:<id>): count 1 is a new alert
  // (renotify: buzz even if it replaces an old one); count ≥ 2 quietly updates
  // it ("3 new from …", renotify false and silent, opening the author page).
  // Chapters (Phase 24) use the same payload; their title says "New chapter: …".
  function str(v, max) {
    return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  }
  // Where a push may lead: a poem, an author page, and (Phase 24) a chapter or
  // a novel page (a novel's own files are not pages); anything else, the board.
  function isChapterUrl(url) {
    var m = CHAPTER.exec(url);
    return Boolean(m) && NOVEL_FILES.indexOf(m[1]) === -1;
  }
  function pushTarget(url) {
    return typeof url === "string" && (POEM.test(url) || AUTHOR.test(url) || NOVEL.test(url) || isChapterUrl(url)) ? url : "/";
  }
  function notificationFor(data) {
    var d = data && typeof data === "object" ? data : {};
    var title = str(d.title, 200);
    var author = str(d.author, 100);
    var tag = typeof d.tag === "string" && /^author:[0-9a-f-]{36}$/.test(d.tag) ? d.tag : "inkboard";
    var count = typeof d.count === "number" && d.count >= 2 && d.count <= 99 ? Math.floor(d.count) : 1;
    var url = pushTarget(d.url);
    var grouped = count >= 2 && author && AUTHOR.test(url);
    var options = {
      body: grouped
        ? (title ? "Latest: " + title : "Tap to read them.")
        : !author
          ? "Tap to read it."
          // A chapter's title already says "New chapter: …".
          : isChapterUrl(url) || NOVEL.test(url) ? "By " + author : "New poem by " + author,
      icon: "/icons/192.png",
      badge: "/icons/badge-96.png",
      tag: tag,
      data: { url: url },
    };
    if (tag !== "inkboard") {
      options.renotify = !grouped;
      if (grouped) options.silent = true;
    }
    return {
      // A group can mix poems and chapters (Phase 24): "3 new from …".
      title: grouped ? count + " new from " + author : (title || "A new poem on InkBoard"),
      options: options,
    };
  }
  /** Where a tap goes: our own poem or author page (or the board), absolute on this origin. */
  function clickUrl(data, origin) {
    return origin + pushTarget(data && data.url);
  }

  return {
    readerKind: readerKind, isStatic: isStatic, strategyFor: strategyFor, cacheKey: cacheKey,
    verdict: verdict, pageMeta: pageMeta, assetUrls: assetUrls, overCap: overCap, CAPS: CAPS,
    notificationFor: notificationFor, clickUrl: clickUrl,
  };
})();
`;

export type OfflineRules = {
  readerKind(pathname: string): "board" | "poem" | "author" | "collection" | "novel" | "chapter" | "page" | null;
  isStatic(pathname: string): boolean;
  strategyFor(req: {
    method: string;
    url: string;
    origin: string;
    mode: string;
    rsc: boolean;
    prefetch: boolean;
  }): "passthrough" | "cache-first" | "reader-page" | "offline-page" | "online-only" | "rsc-navigation";
  cacheKey(href: string): string;
  verdict(status: number, contentType: string, html: string): "save" | "drop" | "keep";
  pageMeta(html: string): { kind: string | null; title: string | null; author: string | null };
  assetUrls(html: string): string[];
  overCap(index: { url: string; kind: string; savedAt: number }[]): string[];
  CAPS: { poem: number; chapter: number; novel: number; other: number };
  notificationFor(data: unknown): {
    title: string;
    options: {
      body: string;
      icon: string;
      badge: string;
      tag: string;
      data: { url: string };
      renotify?: boolean;
      silent?: boolean;
    };
  };
  clickUrl(data: unknown, origin: string): string;
};

/** For tests: evaluates the shipped source and returns its rules. */
export function loadOfflineRules(): OfflineRules {
  return new Function(`${OFFLINE_RULES_JS}; return InkboardOffline;`)() as OfflineRules;
}

/** Cache names and well-known keys, shared by the worker and the offline page. */
export const PAGES_CACHE_PREFIX = "inkboard-pages-";
export const STATIC_CACHE_PREFIX = "inkboard-static-";
export const SAVED_INDEX_KEY = "/__inkboard/saved.json";
export const SAVE_MESSAGE = "inkboard:save";
/**
 * "Save this novel for offline" (Phase 24): { type, paths } with a
 * MessagePort; the worker saves the novel page and each chapter in turn
 * through the same storage rules and posts { done, saved, total } after each,
 * then { finished: true, saved, total }.
 */
export const SAVE_NOVEL_MESSAGE = "inkboard:save-novel";
