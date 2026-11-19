/** InkBoard's "paper & ink" palette (src/lib/site.ts BRAND in the app) plus the reel's blueprint. */
export const C = {
  paper: "#fdfaf4",
  card: "#fcfaf4",
  canvas: "#f5efe6",
  dot: "#d8d0c3",
  ink: "#261d17",
  muted: "#61564d",
  red: "#852e2c",
  onRed: "#fdfaf3",
  blueprint: "#132235",
  blueprintLine: "rgba(150, 190, 235, 0.16)",
  blueprintFine: "rgba(150, 190, 235, 0.07)",
  blueprintInk: "#cfe2f7",
} as const;

export const W = 1080;
export const H = 1920;
export const FPS = 60;

/** Font stacks as the app builds them: main font, then the SIL font for Ghanaian letters and IPA. */
export const SANS = '"Geist", "AndikaExt", system-ui, sans-serif';
export const SERIF = '"Newsreader", "GentiumExt", Georgia, serif';
export const MONO = '"Geist Mono", "AndikaExt", ui-monospace, monospace';

/** Every zoom and camera move (the owner's decision). */
export const CAMERA_SPRING = { damping: 14, stiffness: 180 } as const;

/** Where captions sit: centre at 72% of the height (safe zone 62–78%). */
export const CAPTION_Y = Math.round(H * 0.72);
/** Nothing important right of this (the platforms' buttons). */
export const SAFE_RIGHT = Math.round(W * 0.85);
