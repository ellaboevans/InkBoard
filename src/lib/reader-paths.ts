/**
 * The reader routes whose existence depends on the database (docs/PLAN.md,
 * Phase 19): an author page, a poem page, a collection page, and (Phase 23b)
 * a novel page and a chapter page. Pure, so the proxy (src/proxy.ts) and the
 * tests share one parser.
 *
 * Only exact shapes match: /a/x/feed.xml, /p/x/y/opengraph-image and the
 * like are other routes and never come back from here.
 */
export type ReaderPath =
  | { kind: "author"; author: string }
  | { kind: "poem"; author: string; poem: string }
  | { kind: "collection"; author: string; collection: string }
  | { kind: "novel"; author: string; novel: string }
  | { kind: "chapter"; author: string; novel: string; chapter: string };

const AUTHOR = /^\/a\/([^/]+)\/?$/;
const COLLECTION = /^\/a\/([^/]+)\/c\/([^/]+)\/?$/;
const POEM = /^\/p\/([^/]+)\/([^/]+)\/?$/;
const NOVEL = /^\/a\/([^/]+)\/n\/([^/]+)\/?$/;
const CHAPTER = /^\/a\/([^/]+)\/n\/([^/]+)\/([^/]+)\/?$/;

/**
 * Files a novel's folder will hold next to its chapters (link cards and a
 * feed come in a later round). Never read as a chapter, so the proxy can't
 * turn those routes into 404s once they exist.
 */
const NOVEL_FILES = new Set(["opengraph-image", "twitter-image", "feed.xml"]);

/** A path segment as Next hands it to the page (decoded), or null if it can't be decoded. */
function segment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** The reader page a pathname names, or null for anything else (or an undecodable segment). */
export function readerPathFromPathname(pathname: string): ReaderPath | null {
  let m = POEM.exec(pathname);
  if (m) {
    const [author, poem] = [segment(m[1]), segment(m[2])];
    return author !== null && poem !== null ? { kind: "poem", author, poem } : null;
  }
  m = COLLECTION.exec(pathname);
  if (m) {
    const [author, collection] = [segment(m[1]), segment(m[2])];
    return author !== null && collection !== null ? { kind: "collection", author, collection } : null;
  }
  m = NOVEL.exec(pathname);
  if (m) {
    const [author, novel] = [segment(m[1]), segment(m[2])];
    return author !== null && novel !== null ? { kind: "novel", author, novel } : null;
  }
  m = CHAPTER.exec(pathname);
  if (m) {
    const [author, novel, chapter] = [segment(m[1]), segment(m[2]), segment(m[3])];
    if (author === null || novel === null || chapter === null || NOVEL_FILES.has(chapter)) return null;
    return { kind: "chapter", author, novel, chapter };
  }
  m = AUTHOR.exec(pathname);
  if (m) {
    const author = segment(m[1]);
    return author !== null ? { kind: "author", author } : null;
  }
  return null;
}

/**
 * A full page load (or a HEAD for one): the only requests whose HTTP status
 * anyone reads. Soft navigations, prefetches (the overlay included) and Server
 * Actions (POST) are left alone, so instant navigation and the overlay never
 * wait on the check. Next strips the RSC headers and `_rsc` before calling the
 * proxy, so there the proxy matcher's `missing` does the RSC part; the checks
 * here cover the method, and the headers wherever they do arrive.
 */
export function isDocumentRequest(req: { method: string; headers: Headers; url: string }): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (req.headers.has("rsc") || req.headers.has("next-router-prefetch") || req.headers.has("next-router-state-tree")) {
    return false;
  }
  return !new URL(req.url).searchParams.has("_rsc");
}
