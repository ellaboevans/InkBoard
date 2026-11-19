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

/** Where the About page's videos are hosted. The CSP's `media-src` allows this origin only. */
export const VIDEO_HOST_ORIGIN = "https://pub-9d452c824f9f47fab650797037d4e05f.r2.dev";
/** The video host's name, as the Privacy page and the video captions show it. */
export const VIDEO_HOST_NAME = "Cloudflare R2";

/** A video's encodings on VIDEO_HOST_ORIGIN. */
export type WalkthroughSource = {
  /**
   * Adaptive HLS (240p–1080p), played natively by Safari, iOS and Android.
   * Optional: without it every browser plays the MP4.
   */
  hls?: string;
  /** A 720p MP4 for browsers without HLS (desktop Chrome, Firefox), and for everyone when there's no HLS. */
  mp4: string;
};

/**
 * The walkthrough video on the About page (6:01), or null to show our cover
 * with "Video coming soon". The page renders no <video> until the reader
 * presses play, so nothing is fetched from the host before that
 * (`WalkthroughVideo`); while either video is set, next.config.ts adds
 * `media-src` for VIDEO_HOST_ORIGIN. Hosted in the public Cloudflare R2
 * bucket `videos` (its r2.dev address; not the photos bucket, which must stay
 * private), as the 1080p MP4 itself: R2 makes no other encodings, so there's
 * no HLS. The file starts with its index (faststart), so it plays while it
 * downloads, and R2 answers range requests for seeking. To replace a video,
 * upload it under a new name and change the path here (browsers may cache the
 * old file under the old name).
 */
export const WALKTHROUGH_VIDEO: WalkthroughSource | null = {
  mp4: `${VIDEO_HOST_ORIGIN}/about/inkboard-walkthrough-final.mp4`,
};

/**
 * The second video on the About page, "What's new in InkBoard" (2:53, made in
 * reels-studio), shown below the walkthrough, or null to show nothing. Same
 * rules and host as WALKTHROUGH_VIDEO.
 */
export const WHATS_NEW_VIDEO: WalkthroughSource | null = {
  mp4: `${VIDEO_HOST_ORIGIN}/about/whats-new-walkthrough.mp4`,
};

/** Whether the About page streams any video from VIDEO_HOST_ORIGIN (the CSP and the Privacy page follow it). */
export const HOSTED_VIDEO = WALKTHROUGH_VIDEO !== null || WHATS_NEW_VIDEO !== null;

/** The walkthrough's music, whose licence (CC BY 4.0) requires this credit wherever the video is shown. */
export const WALKTHROUGH_MUSIC_CREDIT = {
  title: "Inspired",
  artist: "Kevin MacLeod",
  artistUrl: "https://incompetech.com",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;

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
