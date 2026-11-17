/**
 * Profile photos (docs/PLAN.md, Phase 22): every number the upload, the
 * server and the UI share. Pure and client-safe.
 */

/**
 * Largest file the server accepts, in bytes. Below Vercel's 4.5 MB request
 * body limit for functions (with room for the form's other fields), so an
 * upload never fails at the platform before our own check can answer.
 * Bigger photos are made smaller in the browser first (photo-resize.ts).
 */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

/** Largest file the browser will try to shrink below PHOTO_MAX_BYTES; bigger ones are refused at once. */
export const PHOTO_SOURCE_MAX_BYTES = 40 * 1024 * 1024;

/** The longest side the browser shrinks a too-big file to (keeps a 12 MP crop sharp at our sizes). */
export const PHOTO_SHRINK_SIDE = 3000;

/** Largest width or height, read from the header before anything is decoded. */
export const PHOTO_MAX_SIDE = 12_000;

/** Largest number of pixels (width × height), read from the header first: decompression bombs. */
export const PHOTO_MAX_PIXELS = 50_000_000;

/** The crop must keep at least this many source pixels on a side (smaller is a blur at 384 px). */
export const PHOTO_MIN_SIDE = 64;

/** Uploads per editor per window (rate_limits key `photo:upload:<editorId>`). */
export const PHOTO_UPLOAD_LIMIT = 20;
export const PHOTO_UPLOAD_WINDOW_SECONDS = 60 * 60;

/**
 * The WebP copies browsers get, square, in pixels. The largest place a
 * photo shows is the author page (112 CSS px); 384 covers it at 3× DPR, 192
 * the 72 px profile card at 2–3×, 96 the 28–36 px bylines, sidebar and
 * board labels at 2–3×.
 */
export const PHOTO_WEBP_SIZES = [96, 192, 384] as const;
export type PhotoWebpSize = (typeof PHOTO_WEBP_SIZES)[number];

/**
 * The JPEG copy for Satori (share image, link cards), which can't read
 * WebP, and for the JSON download. 512 px covers the share image's byline
 * and the link cards' 120 px picture with room to spare.
 */
export const PHOTO_JPEG_SIZE = 512;

/**
 * How long a browser or shared cache may keep a served copy. Keys are new
 * for every photo, so this never shows an old photo under a new URL; it only
 * bounds how long a removed photo can still show from someone's cache.
 */
export const PHOTO_CACHE_SECONDS = 60 * 60;

/** What the picker offers (iPhone Safari turns HEIC into JPEG for this list). */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
