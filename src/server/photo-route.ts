import "server-only";
import { PHOTO_CACHE_SECONDS, PHOTO_WEBP_SIZES, type PhotoWebpSize } from "@/lib/photo-limits";
import { describeStorageError, isCurrentPhoto, PHOTO_KEY, webpObject } from "./profile-photos";
import { photoStorage, type ObjectStorage } from "./storage";

/*
 * Serving photos from our own origin (docs/PLAN.md, Phase 22), not from an
 * R2 public domain: the CSP stays `img-src 'self'`, nobody learns the bucket,
 * and a removed photo stops at once here, because the key must still be an
 * editor's current photo (one indexed lookup) before storage is read.
 *
 * Caching: `public, max-age=PHOTO_CACHE_SECONDS` (an hour) and nothing for
 * the CDN (no s-maxage; Vercel's CDN caches only with one). Keys are new for
 * every photo, so a change never shows an old photo under a new URL; the
 * hour only bounds how long a removed one can still show from a browser's
 * (or a shared proxy's) cache. The service worker passes /photos/ through.
 */

const FILE = /^(\d{2,3})\.webp$/;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function servePhoto(key: string, file: string, storage?: ObjectStorage): Promise<Response> {
  const size = Number(FILE.exec(file)?.[1]);
  if (!PHOTO_KEY.test(key) || !(PHOTO_WEBP_SIZES as readonly number[]).includes(size)) return notFound();
  if (!(await isCurrentPhoto(key))) return notFound();
  let body: Uint8Array | null;
  try {
    body = await (storage ?? photoStorage()).get(webpObject(key, size as PhotoWebpSize));
  } catch (err) {
    console.error("[photos] serving a photo failed", describeStorageError(err));
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!body) return notFound();
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.byteLength),
      "Cache-Control": `public, max-age=${PHOTO_CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
