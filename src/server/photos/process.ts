import "server-only";
import sharp from "sharp";
import { cropRectToPixels, type PhotoCrop } from "@/lib/photo-crop";
import {
  COVER_ASPECT,
  COVER_JPEG_WIDTH,
  COVER_MIN_WIDTH,
  COVER_WEBP_WIDTHS,
  type CoverWebpWidth,
  PHOTO_JPEG_SIZE,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PIXELS,
  PHOTO_MAX_SIDE,
  PHOTO_MIN_SIDE,
  PHOTO_WEBP_SIZES,
  type PhotoWebpSize,
} from "@/lib/photo-limits";
import { isAcceptedType, sniffImageType, type SniffedType } from "@/lib/photo-sniff";

/*
 * Image processing for profile photos (docs/PLAN.md, Phase 22: square) and
 * novel covers (Phase 25: 2:3), framework-free. One pipeline, two specs
 * (PHOTO_SPEC, COVER_SPEC): only the crop's shape and the output sizes differ.
 *
 * Order matters, and each step refuses before the next costs anything:
 * 1. byte size (PHOTO_MAX_BYTES);
 * 2. the real type, from the bytes (photo-sniff.ts), never the name or MIME type;
 * 3. the header only (sharp's metadata() decodes no pixels): width, height,
 *    their product (PHOTO_MAX_SIDE, PHOTO_MAX_PIXELS: decompression bombs),
 *    and the format agreeing with the sniffed type;
 * 4. the crop, checked against the oriented size;
 * 5. decode (with limitInputPixels as a second guard), EXIF orientation applied,
 *    crop, conversion to sRGB, resize, encode. sharp writes no metadata unless
 *    asked (we never call keepMetadata/withMetadata/keepIccProfile), so the
 *    copies carry no EXIF, GPS, XMP, IPTC or ICC profile: the photo's colours
 *    are converted to sRGB first, which is what a browser assumes without one.
 */

/** Paper, behind transparent PNG/WebP pixels (the avatars' tile, --secondary). */
const TILE = { r: 0xf3, g: 0xee, b: 0xe6 };

/** What one kind of image is cut and encoded to. */
export type ImageSpec<W extends number = number> = {
  /** The crop's width / height (1 = square). */
  aspect: number;
  /** The WebP copies' widths (each `width / aspect` tall). */
  webpWidths: readonly W[];
  /** The JPEG copy's width (Satori, the JSON download). */
  jpegWidth: number;
  /** The crop must keep at least this many source pixels across. */
  minWidth: number;
};

export const PHOTO_SPEC: ImageSpec<PhotoWebpSize> = {
  aspect: 1,
  webpWidths: PHOTO_WEBP_SIZES,
  jpegWidth: PHOTO_JPEG_SIZE,
  minWidth: PHOTO_MIN_SIDE,
};

export const COVER_SPEC: ImageSpec<CoverWebpWidth> = {
  aspect: COVER_ASPECT,
  webpWidths: COVER_WEBP_WIDTHS,
  jpegWidth: COVER_JPEG_WIDTH,
  minWidth: COVER_MIN_WIDTH,
};

export type ProcessedImage<W extends number = number> = {
  webp: Record<W, Uint8Array>;
  jpeg: Uint8Array;
  /** Of the picture as seen (after orientation), before cropping. */
  source: { type: "jpeg" | "png" | "webp"; width: number; height: number };
};
export type ProcessedPhoto = ProcessedImage<PhotoWebpSize>;
export type ProcessedCover = ProcessedImage<CoverWebpWidth>;

export type PhotoError =
  | { error: "too_large" }
  | { error: "empty" }
  | { error: "type"; type: SniffedType }
  | { error: "dimensions" }
  | { error: "crop" }
  | { error: "unreadable" };

const SHARP_OPTIONS = {
  limitInputPixels: PHOTO_MAX_PIXELS,
  // Truncated or corrupt data is an error, not a half-grey picture.
  failOn: "warning",
  // Animated WebP/PNG: the first frame only.
  pages: 1,
} as const;

/** The header only: no pixels are decoded here. */
export async function readPhotoHeader(bytes: Uint8Array): Promise<
  { ok: true; type: "jpeg" | "png" | "webp"; width: number; height: number; orientedWidth: number; orientedHeight: number } | ({ ok: false } & PhotoError)
> {
  if (bytes.byteLength === 0) return { ok: false, error: "empty" };
  if (bytes.byteLength > PHOTO_MAX_BYTES) return { ok: false, error: "too_large" };
  const type = sniffImageType(bytes);
  if (!isAcceptedType(type)) return { ok: false, error: "type", type };
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    // Header only, so the pixel limit is ours to check (and name) below.
    meta = await sharp(bytes, { ...SHARP_OPTIONS, limitInputPixels: false }).metadata();
  } catch {
    return { ok: false, error: "unreadable" };
  }
  if (meta.format !== type) return { ok: false, error: "unreadable" };
  const { width, height } = meta;
  if (!width || !height) return { ok: false, error: "unreadable" };
  if (width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE || width * height > PHOTO_MAX_PIXELS) {
    return { ok: false, error: "dimensions" };
  }
  // EXIF orientations 5–8 turn the picture a quarter: width and height swap.
  const turned = (meta.orientation ?? 1) >= 5;
  return {
    ok: true,
    type,
    width,
    height,
    orientedWidth: turned ? height : width,
    orientedHeight: turned ? width : height,
  };
}

/** A square profile photo (Phase 22). */
export const processPhoto = (bytes: Uint8Array, crop: PhotoCrop) => processImage(bytes, crop, PHOTO_SPEC);

/** A 2:3 novel cover (Phase 25): the same checks and steps, a book's shape. */
export const processCover = (bytes: Uint8Array, crop: PhotoCrop) => processImage(bytes, crop, COVER_SPEC);

export async function processImage<W extends number>(
  bytes: Uint8Array,
  crop: PhotoCrop,
  spec: ImageSpec<W>,
): Promise<({ ok: true } & ProcessedImage<W>) | ({ ok: false } & PhotoError)> {
  const header = await readPhotoHeader(bytes);
  if (!header.ok) return header;
  const { orientedWidth: w, orientedHeight: h } = header;
  // A picture smaller than the minimum can still be used whole.
  const minWidth = Math.min(spec.minWidth, Math.floor(Math.min(w, h * spec.aspect)));
  const box = cropRectToPixels(crop, w, h, minWidth, spec.aspect);
  if (!box) return { ok: false, error: "crop" };

  try {
    const base = sharp(bytes, SHARP_OPTIONS)
      .autoOrient()
      .extract(box)
      .toColourspace("srgb")
      // Transparent pixels on paper, in every copy: the avatar (or drawn cover) sits behind as its fallback.
      .flatten({ background: TILE });
    const sized = (width: number) => base.clone().resize(width, Math.round(width / spec.aspect), { fit: "fill" });
    const webps = await Promise.all(
      spec.webpWidths.map((width) => sized(width).webp({ quality: 82, effort: 4 }).toBuffer()),
    );
    const jpeg = await sized(spec.jpegWidth).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    const webp = Object.fromEntries(spec.webpWidths.map((width, i) => [width, new Uint8Array(webps[i])])) as Record<W, Uint8Array>;
    return {
      ok: true,
      webp,
      jpeg: new Uint8Array(jpeg),
      source: { type: header.type, width: w, height: h },
    };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}
