import { shareImageFileName } from "@/lib/share-image/share-text";
import { getShareImage } from "@/server/share-image-cache";

/*
 * GET /p/<author>/<poem>/share-image: the "Share as image" PNG of a published
 * public poem (docs/PLAN.md, Phase 21).
 *
 * - A private, draft, unpublished, deleted or unknown poem is one plain 404,
 *   never cached, and its text is never rendered (loadSharePoem selects public
 *   poems only). A route handler sets its own status, so the proxy's real-404
 *   check (src/proxy.ts) isn't needed here and doesn't match this path.
 * - The PNG comes from Next's cache (share-image-cache.ts, invalidated by the
 *   board's tags). Browsers may keep a copy but must ask again every time
 *   (`no-cache` + ETag, a cheap 304 when nothing changed); `private` keeps it
 *   out of the CDN and other shared caches, so a poem that changed, went
 *   private or was deleted never comes back from one.
 * - The service worker passes it through and never stores it (src/lib/offline/rules.ts).
 */

const SHARE_IMAGE_CACHE_CONTROL = "private, no-cache";
const NOT_FOUND_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch === "*" || ifNoneMatch.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

export async function GET(request: Request, { params }: RouteContext<"/p/[author]/[poem]/share-image">) {
  const { author, poem } = await params;
  const image = await getShareImage(author, poem);
  if (!image) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": NOT_FOUND_CACHE_CONTROL,
        "X-Robots-Tag": "noindex",
      },
    });
  }
  const headers = {
    "Content-Type": "image/png",
    "Cache-Control": SHARE_IMAGE_CACHE_CONTROL,
    ETag: image.etag,
    "Content-Disposition": `inline; filename="${shareImageFileName(poem)}"`,
    "X-Robots-Tag": "noindex",
  };
  if (matches(request.headers.get("if-none-match"), image.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Blob([image.png as Uint8Array<ArrayBuffer>], { type: "image/png" }), { headers });
}
