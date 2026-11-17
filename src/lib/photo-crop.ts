/**
 * Profile photo crop maths (docs/PLAN.md, Phase 22). Pure and client-safe:
 * the crop step in the browser and the server share these functions.
 *
 * A crop is a square inside the photo *as it is seen* (after EXIF
 * orientation), written as fractions so it means the same thing on the
 * original file and on a copy the browser shrank:
 *   x, y  the square's top-left corner, as fractions of the width and height
 *   size  its side, as a fraction of the shorter side (1 = as big as it can be)
 *
 * The crop step's view is a zoom (1 = the whole short side) and the centre
 * of the square, also as fractions.
 */

export type PhotoCrop = { x: number; y: number; size: number };
export type CropView = { zoom: number; cx: number; cy: number };

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The square's side as fractions of the width and the height. */
function sideFractions(width: number, height: number, zoom: number) {
  const side = Math.min(width, height) / zoom;
  return { fw: side / width, fh: side / height };
}

/** Keep the zoom in range and the square inside the photo. */
export function clampView(view: CropView, width: number, height: number): CropView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 1, CROP_ZOOM_MIN, CROP_ZOOM_MAX);
  const { fw, fh } = sideFractions(width, height, zoom);
  return {
    zoom,
    cx: clamp(Number.isFinite(view.cx) ? view.cx : 0.5, fw / 2, 1 - fw / 2),
    cy: clamp(Number.isFinite(view.cy) ? view.cy : 0.5, fh / 2, 1 - fh / 2),
  };
}

/** Start: the largest square, centred. */
export const initialView = (): CropView => ({ zoom: 1, cx: 0.5, cy: 0.5 });

export function cropFromView(view: CropView, width: number, height: number): PhotoCrop {
  const v = clampView(view, width, height);
  const { fw, fh } = sideFractions(width, height, v.zoom);
  return { x: v.cx - fw / 2, y: v.cy - fh / 2, size: 1 / v.zoom };
}

/** Move the square by a drag of (dx, dy) on screen, where the square is `boxPx` wide. */
export function panView(view: CropView, dxPx: number, dyPx: number, boxPx: number, width: number, height: number): CropView {
  const { fw, fh } = sideFractions(width, height, view.zoom);
  // Dragging the photo right shows more of its left: the centre moves the other way.
  return clampView({ ...view, cx: view.cx - (dxPx / boxPx) * fw, cy: view.cy - (dyPx / boxPx) * fh }, width, height);
}

/** How far the centre can move on each axis (0 when the photo is already that narrow). */
export function panRange(view: CropView, width: number, height: number) {
  const { fw, fh } = sideFractions(width, height, clampView(view, width, height).zoom);
  return { x: [fw / 2, 1 - fw / 2] as const, y: [fh / 2, 1 - fh / 2] as const };
}

const NUM = /^(?:0|1|0?\.\d{1,8}|1\.0{1,8})$/;
const EPS = 1e-6;

/** Six decimals: plenty for 12,000 px, and a short form field. */
export function encodeCrop(crop: PhotoCrop): string {
  const f = (n: number) => String(Math.round(clamp(n, 0, 1) * 1e6) / 1e6);
  return `${f(crop.x)},${f(crop.y)},${f(crop.size)}`;
}

/**
 * The crop field as posted: "x,y,size", each a plain decimal in [0, 1].
 * Anything else is null. Whether it fits the photo is checked against the
 * real dimensions in cropToPixels.
 */
export function parseCrop(raw: unknown): PhotoCrop | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const parts = raw.split(",");
  if (parts.length !== 3 || !parts.every((p) => NUM.test(p))) return null;
  const [x, y, size] = parts.map(Number);
  if (size <= 0) return null;
  return { x, y, size };
}

/**
 * The crop in whole pixels of a width × height photo, or null when it
 * doesn't fit inside it (beyond rounding) or is too small to be a picture.
 */
export function cropToPixels(crop: PhotoCrop, width: number, height: number, minSide = 1) {
  const short = Math.min(width, height);
  const sideExact = crop.size * short;
  if (crop.x * width + sideExact > width * (1 + EPS) + 0.5) return null;
  if (crop.y * height + sideExact > height * (1 + EPS) + 0.5) return null;
  const side = clamp(Math.round(sideExact), 1, short);
  if (side < minSide) return null;
  const left = clamp(Math.round(crop.x * width), 0, width - side);
  const top = clamp(Math.round(crop.y * height), 0, height - side);
  return { left, top, side };
}
