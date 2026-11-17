import "server-only";
import sharp from "sharp";
import { cropToPixels, type PhotoCrop } from "@/lib/photo-crop";
import {
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
 * Profile photo processing (docs/PLAN.md, Phase 22), framework-free.
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

export type ProcessedPhoto = {
  webp: Record<PhotoWebpSize, Uint8Array>;
  jpeg: Uint8Array;
  /** Of the photo as seen (after orientation), before cropping. */
  source: { type: "jpeg" | "png" | "webp"; width: number; height: number };
};

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

export async function processPhoto(
  bytes: Uint8Array,
  crop: PhotoCrop,
): Promise<({ ok: true } & ProcessedPhoto) | ({ ok: false } & PhotoError)> {
  const header = await readPhotoHeader(bytes);
  if (!header.ok) return header;
  const box = cropToPixels(crop, header.orientedWidth, header.orientedHeight, Math.min(PHOTO_MIN_SIDE, header.orientedWidth, header.orientedHeight));
  if (!box) return { ok: false, error: "crop" };

  try {
    const base = sharp(bytes, SHARP_OPTIONS)
      .autoOrient()
      .extract({ left: box.left, top: box.top, width: box.side, height: box.side })
      .toColourspace("srgb")
      // Transparent pixels on paper, in every copy: the avatar sits behind a photo as its fallback.
      .flatten({ background: TILE });
    const square = (size: number) => base.clone().resize(size, size, { fit: "fill" });
    const webps = await Promise.all(
      PHOTO_WEBP_SIZES.map((size) => square(size).webp({ quality: 82, effort: 4 }).toBuffer()),
    );
    const jpeg = await square(PHOTO_JPEG_SIZE).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    const webp = Object.fromEntries(PHOTO_WEBP_SIZES.map((s, i) => [s, new Uint8Array(webps[i])])) as Record<PhotoWebpSize, Uint8Array>;
    return {
      ok: true,
      webp,
      jpeg: new Uint8Array(jpeg),
      source: { type: header.type, width: header.orientedWidth, height: header.orientedHeight },
    };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}
