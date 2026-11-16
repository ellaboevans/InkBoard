/**
 * Site identity for SEO: names, copy, colours and the absolute base URL used
 * by metadata, Open Graph images, robots.txt and the sitemap.
 *
 * Not `env()`: that needs the DB and auth secrets, and metadata must also
 * work at build time. APP_URL wins; on Vercel the production domain is the
 * fallback, so shared links never point at localhost.
 */
export const SITE_NAME = "InkBoard";
export const SITE_TAGLINE = "A living board of poems, catalogued by author.";
export const SITE_DESCRIPTION =
  "InkBoard is a public board of poems, grouped by author. Wander the canvas, read new work, and follow the poets you like.";

/** Who runs InkBoard (the About and Privacy pages). */
export const SITE_OPERATOR = "Evans Elabo";
/** Where privacy questions and requests go; shown only on our own pages, as a mailto link. */
export const PRIVACY_CONTACT_EMAIL = "ellaboevans@gmail.com";

/**
 * The walkthrough video on the About page: a YouTube video id (11 characters,
 * from youtube.com/watch?v=<id>), or null until it's published. While null the
 * page shows our own cover with "Video coming soon" and the CSP allows no
 * frames at all; once set, next.config.ts allows frames from
 * youtube-nocookie.com, and the player loads only after the reader presses play.
 */
export const WALKTHROUGH_YOUTUBE_ID: string | null = null;

/** Hex versions of the "paper & ink" tokens in globals.css (ImageResponse can't read oklch/CSS vars). */
export const BRAND = {
  paper: "#fdfaf4",
  canvas: "#f5efe6",
  dot: "#d8d0c3",
  ink: "#261d17",
  muted: "#61564d",
  primary: "#852e2c",
  onPrimary: "#fdfaf3",
} as const;

/** Spread into every page's `openGraph`: Next replaces the parent's object rather than merging it. */
export const BASE_OPEN_GRAPH = { siteName: SITE_NAME, locale: "en_US" } as const;

export function siteUrl(): URL {
  const fromEnv = process.env.APP_URL;
  if (fromEnv) return new URL(fromEnv);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}
