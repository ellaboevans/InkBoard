import "server-only";
import { COVER_CACHE_SECONDS, PHOTO_CACHE_SECONDS } from "@/lib/photo-limits";
import { COVER_KIND, isCurrentCover } from "./novel-covers";
import { describeStorageError, IMAGE_KEY, webpObjectOf, type StoredImageKind } from "./photos/stored-images";
import { isCurrentPhoto, PHOTO_KIND } from "./profile-photos";
import { photoStorage, type ObjectStorage } from "./storage";

/*
 * Serving uploaded images from our own origin (docs/PLAN.md, Phase 22;
 * novel covers too since Phase 25), not from an R2 public domain: the CSP
 * stays `img-src 'self'`, nobody learns the bucket, and a removed image stops
 * at once here, because the key must still be current (an editor's photo, a
 * novel's cover: one indexed lookup) before storage is read.
 *
 * Caching: `public, max-age=<an hour>` and nothing for the CDN (no
 * s-maxage; Vercel's CDN caches only with one). Keys are new for every
 * upload, so a change never shows an old image under a new URL; the hour only
 * bounds how long a removed one can still show from a browser's (or a shared
 * proxy's) cache. The service worker passes /photos/ and /covers/ through.
 */

const FILE = /^(\d{2,3})\.webp$/;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

async function serveStoredImage(
  kind: StoredImageKind,
  isCurrent: (key: string) => Promise<boolean>,
  cacheSeconds: number,
  key: string,
  file: string,
  storage?: ObjectStorage,
): Promise<Response> {
  const width = Number(FILE.exec(file)?.[1]);
  if (!IMAGE_KEY.test(key) || !kind.webpWidths.includes(width)) return notFound();
  if (!(await isCurrent(key))) return notFound();
  let body: Uint8Array | null;
  try {
    body = await (storage ?? photoStorage()).get(webpObjectOf(kind, key, width));
  } catch (err) {
    console.error(`[${kind.name}] serving an image failed`, describeStorageError(err));
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!body) return notFound();
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.byteLength),
      "Cache-Control": `public, max-age=${cacheSeconds}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** /photos/<key>/<96|192|384>.webp: an editor's current profile photo. */
export const servePhoto = (key: string, file: string, storage?: ObjectStorage) =>
  serveStoredImage(PHOTO_KIND, isCurrentPhoto, PHOTO_CACHE_SECONDS, key, file, storage);

/** /covers/<key>/<128|256|512>.webp: a novel's current cover (public even for a private novel). */
export const serveCover = (key: string, file: string, storage?: ObjectStorage) =>
  serveStoredImage(COVER_KIND, isCurrentCover, COVER_CACHE_SECONDS, key, file, storage);

