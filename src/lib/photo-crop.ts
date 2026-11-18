/**
 * Crop maths for profile photos (docs/PLAN.md, Phase 22: a square) and
 * novel covers (Phase 25: a book's 2:3). Pure and client-safe: the crop step
 * in the browser and the server share these functions.
 *
 * A crop is a rectangle of a fixed `aspect` (width / height; 1, the default,
 * is the photos' square) inside the picture *as it is seen* (after EXIF
 * orientation), written as fractions so it means the same thing on the
 * original file and on a copy the browser shrank:
 *   x, y  its top-left corner, as fractions of the width and height
 *   size  its width, as a fraction of the widest crop that fits (1 = as big
 *         as it can be; for a square, the shorter side)
 *
 * The crop step's view is a zoom (1 = the widest crop) and the centre of the
 * crop, also as fractions.
 */

export type PhotoCrop = { x: number; y: number; size: number };
export type CropView = { zoom: number; cx: number; cy: number };

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The widest crop of this aspect that fits a width × height picture, in pixels. */
const widestCrop = (width: number, height: number, aspect: number) => Math.min(width, height * aspect);

/** The crop's width and height as fractions of the picture's width and height. */
function sideFractions(width: number, height: number, zoom: number, aspect = 1) {
  const w = widestCrop(width, height, aspect) / zoom;
  return { fw: w / width, fh: w / aspect / height };
}

/** Keep the zoom in range and the crop inside the picture. */
export function clampView(view: CropView, width: number, height: number, aspect = 1): CropView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 1, CROP_ZOOM_MIN, CROP_ZOOM_MAX);
  const { fw, fh } = sideFractions(width, height, zoom, aspect);
  return {
    zoom,
    cx: clamp(Number.isFinite(view.cx) ? view.cx : 0.5, fw / 2, 1 - fw / 2),
    cy: clamp(Number.isFinite(view.cy) ? view.cy : 0.5, fh / 2, 1 - fh / 2),
  };
}

/** Start: the largest square, centred. */
export const initialView = (): CropView => ({ zoom: 1, cx: 0.5, cy: 0.5 });

export function cropFromView(view: CropView, width: number, height: number, aspect = 1): PhotoCrop {
  const v = clampView(view, width, height, aspect);
  const { fw, fh } = sideFractions(width, height, v.zoom, aspect);
  return { x: v.cx - fw / 2, y: v.cy - fh / 2, size: 1 / v.zoom };
}

/** Move the crop by a drag of (dx, dy) on screen, where the crop is `boxPx` wide. */
export function panView(
  view: CropView,
  dxPx: number,
  dyPx: number,
  boxPx: number,
  width: number,
  height: number,
  aspect = 1,
): CropView {
  const { fw, fh } = sideFractions(width, height, view.zoom, aspect);
  const boxHeight = boxPx / aspect;
  // Dragging the photo right shows more of its left: the centre moves the other way.
  return clampView({ ...view, cx: view.cx - (dxPx / boxPx) * fw, cy: view.cy - (dyPx / boxHeight) * fh }, width, height, aspect);
}

/** How far the centre can move on each axis (0 when the picture is already that narrow). */
export function panRange(view: CropView, width: number, height: number, aspect = 1) {
  const { fw, fh } = sideFractions(width, height, clampView(view, width, height, aspect).zoom, aspect);
  return { x: [fw / 2, 1 - fw / 2] as const, y: [fh / 2, 1 - fh / 2] as const };
}

/**
 * Where the picture sits so the crop fills a box of the crop's aspect: CSS
 * percentages of the box, so any box size works (the crop step and its previews).
 */
export function cropPlacement(view: CropView, width: number, height: number, aspect = 1) {
  const crop = cropFromView(view, width, height, aspect);
  const cropW = widestCrop(width, height, aspect) * crop.size;
  const cropH = cropW / aspect;
  return {
    width: `${(width / cropW) * 100}%`,
    height: `${(height / cropH) * 100}%`,
    left: `${((-crop.x * width) / cropW) * 100}%`,
    top: `${((-crop.y * height) / cropH) * 100}%`,
  };
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
 * The crop in whole pixels of a width × height picture, or null when it
 * doesn't fit inside it (beyond rounding) or is narrower than `minWidth`.
 */
export function cropRectToPixels(crop: PhotoCrop, width: number, height: number, minWidth = 1, aspect = 1) {
  const widest = widestCrop(width, height, aspect);
  const wExact = crop.size * widest;
  const hExact = wExact / aspect;
  if (crop.x * width + wExact > width * (1 + EPS) + 0.5) return null;
  if (crop.y * height + hExact > height * (1 + EPS) + 0.5) return null;
  const w = clamp(Math.round(wExact), 1, Math.max(1, Math.floor(widest + 1e-9)));
  if (w < minWidth) return null;
  const h = clamp(Math.round(w / aspect), 1, height);
  const left = clamp(Math.round(crop.x * width), 0, width - w);
  const top = clamp(Math.round(crop.y * height), 0, height - h);
  return { left, top, width: w, height: h };
}

/** The square crop (profile photos) in whole pixels: its corner and side, or null (see cropRectToPixels). */
export function cropToPixels(crop: PhotoCrop, width: number, height: number, minSide = 1) {
  const r = cropRectToPixels(crop, width, height, minSide, 1);
  return r && { left: r.left, top: r.top, side: r.width };
}
