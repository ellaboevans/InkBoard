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

/** Where the walkthrough video is hosted (ImageKit). The CSP's `media-src` allows this origin only. */
export const VIDEO_HOST_ORIGIN = "https://ik.imagekit.io";

/** A video's encodings, both on VIDEO_HOST_ORIGIN. */
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
 * The walkthrough video on the About page, streamed from ImageKit, or null to
 * show our cover with "Video coming soon". The page renders no <video> until
 * the reader presses play, so nothing is fetched from ImageKit before that
 * (`WalkthroughVideo`); once set, next.config.ts adds `media-src` for
 * VIDEO_HOST_ORIGIN. `updatedAt` is ImageKit's cache key: bump it with the
 * file's new value after replacing the video in ImageKit.
 */
export const WALKTHROUGH_VIDEO: WalkthroughSource | null = {
  hls: `${VIDEO_HOST_ORIGIN}/kkldhhslb/inkboard-walkthrough-final.mp4/ik-master.m3u8?updatedAt=1794859127104&tr=sr-240_360_480_720_1080`,
  mp4: `${VIDEO_HOST_ORIGIN}/kkldhhslb/inkboard-walkthrough-final.mp4?updatedAt=1794859127104&tr=w-1280`,
};

/**
 * The second video on the About page, "What's new in InkBoard" (2:53, made in
 * reels-studio), shown below the walkthrough, or null to show nothing. The
 * same rules as WALKTHROUGH_VIDEO: no <video> and no request to ImageKit
 * until the reader presses play. For now a 720p MP4 we encode ourselves,
 * delivered as uploaded (no ImageKit transformation: the account's video
 * transformation quota was used up when it was added); add `hls` like the
 * walkthrough's once ImageKit can make it.
 */
export const WHATS_NEW_VIDEO: WalkthroughSource | null = {
  mp4: `${VIDEO_HOST_ORIGIN}/kkldhhslb/whats-new-walkthrough-720p.mp4`,
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
