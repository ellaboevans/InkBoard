import type { NextConfig } from "next";
import { buildCsp } from "./src/lib/csp";
import { WALKTHROUGH_YOUTUBE_ID } from "./src/lib/site";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy without nonces (see src/lib/csp.ts): our own origin
 * only, plus youtube-nocookie.com frames once the About page's walkthrough
 * video has an id (WALKTHROUGH_YOUTUBE_ID).
 */
const csp = buildCsp({ dev: isDev, youtubeId: WALKTHROUGH_YOUTUBE_ID });

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Older browsers' equivalent of frame-ancestors 'none'.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HTTPS only, for two years, once deployed. Not in dev (plain http://localhost).
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

/**
 * Identifies this build to the service worker (src/app/sw.js): a new id means
 * a new worker, which refreshes saved pages and drops the old build's caches.
 * Inlined at build time through `env`, so `next start` serves the id it was built with.
 */
const buildId =
  process.env.INKBOARD_BUILD_ID ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  Date.now().toString(36);

const nextConfig: NextConfig = {
  env: {
    INKBOARD_BUILD_ID: buildId,
    // Public by design (it's the push `applicationServerKey`); the private key
    // never leaves the server (src/env.ts). Empty = notifications are off.
    INKBOARD_VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? "",
  },
  experimental: {
    // Failed soft navigations, prefetches and Server Actions wait for the
    // connection instead of throwing; `useOffline()` drives the offline indicator.
    useOffline: true,
  },
  // E2E runs use a separate build dir so they don't share (or lock) the one
  // used by your own `pnpm dev` (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
