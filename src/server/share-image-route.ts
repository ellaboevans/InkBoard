import "server-only";
import { SHARE_DESIGN_NAMES, type ShareDesign } from "@/lib/share-image/designs";
import { SHARE_FORMAT_NAMES, type ShareFormat } from "@/lib/share-image/layout";
import { parseSelection, poemLines } from "@/lib/share-image/selection";
import { shareImageFileName } from "@/lib/share-image/share-text";
import { shortPath } from "@/lib/share-image/short-code";
import type { SharePoem } from "./board";
import type { RateLimitResult } from "./rate-limit";
import type { RenderedShareImage, ShareImageRequest } from "./share-image";

/*
 * The share image routes' logic (docs/PLAN.md, Phase 21, rounds 1 to 3),
 * framework-free so tests can drive it: the route files only wire in the
 * cached loaders, the renderer, the rate limit and the client's IP bucket.
 *
 *   GET /p/<author>/<poem>/share-image[?format=chat][&design=ink|board][&lines=3-6,9]
 *   GET /p/<author>/<poem>/share-image/lines   (the picker's lines, JSON)
 *
 * The order is the guarantee:
 *   1. `format` (absent = story; story, chat) and `design` (absent = page; page,
 *      ink, board): anything else, or either one twice, is a 404, whatever the
 *      poem. They say nothing about the poem.
 *   2. The poem: a published public one, or the same 404 for private, draft,
 *      unpublished, deleted or unknown. Nothing below runs for those, so a
 *      private poem's lines are never counted or parsed: no status code or
 *      timing can tell its length (getPoem never selects its text, N1).
 *   2b. Its short link (round 3): made now if this is the poem's first picture
 *      (ensureShortCode; the picture is drawn in "use cache", which can't
 *      write), so the short address is always what gets printed.
 *   3. `lines`: checked against the public poem (selection.ts). Malformed,
 *      empty, out of range, too many or not canonical is a 400: the poem is
 *      public, so its line count is no secret, and a 400 says "your request is
 *      wrong" where a 404 would say "no such poem".
 *   4. Whole poem: from Next's cache (one render per poem, format, design and
 *      change; the short code is part of the key, so a new code is a new entry).
 *      Picked lines: not cached on the server; a matching If-None-Match is a
 *      304 straight from the ETag (computed from the inputs, no drawing), and
 *      only an actual render counts toward SHARE_RENDER_LIMIT per IP bucket.
 * Every answer is `private, no-cache` (images, with an ETag) or no-store
 * (errors), so no CDN or shared cache keeps any of it.
 */

/** Renders of picked lines per IP bucket (IPv4 address, IPv6 /64). */
export const SHARE_RENDER_LIMIT = { limit: 60, windowSeconds: 600 } as const;
export const shareRenderKey = (bucket: string) => `share:render:ip:${bucket}`;

export type ShareRouteDeps = {
  /** Cached in production (getSharePoem); null unless published and public. */
  getPoem(authorSlug: string, poemSlug: string): Promise<SharePoem | null>;
  /** Cached in production (getShareImage). */
  getWholeImage(
    authorSlug: string,
    poemSlug: string,
    format: ShareFormat,
    design: ShareDesign,
    shortCode: string,
  ): Promise<{ png: Uint8Array; etag: string } | null>;
  /** Its short link's code, made now if it has none (null: not a published public poem any more). */
  ensureShortCode(poemId: string): Promise<string | null>;
  renderPicked(poem: SharePoem, request: ShareImageRequest): Promise<RenderedShareImage>;
  etagFor(poem: SharePoem, request: ShareImageRequest): string;
  /** The rate limit, already keyed on the client's IP bucket. */
  limitRender(): Promise<RateLimitResult>;
  /** Only for tests: called when the selection is parsed (never for a missing poem). */
  onParseSelection?(): void;
};

const IMAGE_CACHE_CONTROL = "private, no-cache";
const NO_STORE = "private, no-cache, no-store, max-age=0, must-revalidate";

function plain(status: number, body: string, extra: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE, "X-Robots-Tag": "noindex", ...extra },
  });
}
export const notFound = () => plain(404, "Not found");
const badRequest = () => plain(400, "Bad selection");

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch === "*" || ifNoneMatch.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

function oneOf<T extends string>(query: URLSearchParams, key: string, allowed: readonly T[], fallback: T): T | null {
  const values = query.getAll(key);
  if (values.length === 0) return fallback;
  if (values.length > 1) return null;
  return (allowed as readonly string[]).includes(values[0]) ? (values[0] as T) : null;
}

/** `format` from the query: the format, or null for anything unknown (a 404). */
export function parseFormat(query: URLSearchParams): ShareFormat | null {
  return oneOf(query, "format", SHARE_FORMAT_NAMES, "story");
}

/** `design` from the query: absent = page; null for anything unknown or repeated (a 404). */
export function parseDesign(query: URLSearchParams): ShareDesign | null {
  return oneOf(query, "design", SHARE_DESIGN_NAMES, "page");
}

function imageResponse(request: Request, png: Uint8Array | null, etag: string, fileName: string, extra: Record<string, string> = {}) {
  const headers = {
    "Content-Type": "image/png",
    "Cache-Control": IMAGE_CACHE_CONTROL,
    ETag: etag,
    "Content-Disposition": `inline; filename="${fileName}"`,
    "X-Robots-Tag": "noindex",
    ...extra,
  };
  if (png === null || matches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }), { headers });
}

export async function handleShareImage(
  request: Request,
  { author, poem: slug }: { author: string; poem: string },
  deps: ShareRouteDeps,
): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const format = parseFormat(query);
  const design = parseDesign(query);
  if (!format || !design) return notFound();

  const found = await deps.getPoem(author, slug);
  if (!found) return notFound();
  const shortCode = found.shortCode ?? (await deps.ensureShortCode(found.id));
  if (!shortCode) return notFound();
  const poem: SharePoem = { ...found, shortCode };

  const rawLines = query.getAll("lines");
  if (rawLines.length === 0) {
    const image = await deps.getWholeImage(author, slug, format, design, shortCode);
    if (!image) return notFound();
    return imageResponse(request, image.png, image.etag, shareImageFileName(slug, { format, design }), {
      // The address printed on it (a public poem's short link), so clients and tests can show or check it.
      "X-Share-Address": shortPath(shortCode),
    });
  }

  deps.onParseSelection?.();
  if (rawLines.length > 1) return badRequest();
  const selection = parseSelection(rawLines[0], poemLines(poem.body));
  if (!selection.ok) return badRequest();

  const pick: ShareImageRequest = { format, design, picked: selection.picked };
  const fileName = shareImageFileName(slug, { format, design, lines: true });
  const etag = deps.etagFor(poem, pick);
  // Revalidation of a picture this browser already has: no drawing, no count.
  if (matches(request.headers.get("if-none-match"), etag)) return imageResponse(request, null, etag, fileName);

  const limit = await deps.limitRender();
  if (!limit.allowed) {
    return plain(429, "Too many images made from this network. Try again in a few minutes.", {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const image = await deps.renderPicked(poem, pick);
  return imageResponse(request, image.png, image.etag, fileName, {
    "X-Share-Address": shortPath(shortCode),
    "X-Share-Lines-Picked": String(image.quote?.picked ?? selection.picked.length),
    "X-Share-Lines-Shown": String(image.quote?.shown ?? selection.picked.length),
  });
}

/** The picker's lines: the public poem's text as numbered lines, its language tag. Same 404 as the image. */
export async function handleShareLines(
  { author, poem: slug }: { author: string; poem: string },
  getPoem: ShareRouteDeps["getPoem"],
): Promise<Response> {
  const poem = await getPoem(author, slug);
  if (!poem) return notFound();
  return Response.json(
    { language: poem.language, lines: poemLines(poem.body) },
    { headers: { "Cache-Control": IMAGE_CACHE_CONTROL, "X-Robots-Tag": "noindex" } },
  );
}
