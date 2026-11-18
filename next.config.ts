import type { NextConfig } from "next";
// Next's default list of HTML-limited bots: `htmlLimitedBots` replaces it, so ours extends it.
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { htmlLimitedBots } from "./src/lib/html-limited-bots";
import { buildCsp } from "./src/lib/csp";
import { PHOTO_MAX_BYTES } from "./src/lib/photo-limits";
import { VIDEO_HOST_ORIGIN, WALKTHROUGH_VIDEO } from "./src/lib/site";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy without nonces (see src/lib/csp.ts): our own origin
 * only, plus media from ImageKit while the About page has a walkthrough video
 * (WALKTHROUGH_VIDEO).
 */
const csp = buildCsp({ dev: isDev, videoOrigin: WALKTHROUGH_VIDEO ? VIDEO_HOST_ORIGIN : null });

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
    // Profile photos and novel covers are posted to Server Actions (docs/PLAN.md, Phases 22, 25):
    // the largest file plus room for the multipart overhead and the crop field.
    // PHOTO_MAX_BYTES stays below Vercel's 4.5 MB function body limit.
    serverActions: { bodySizeLimit: PHOTO_MAX_BYTES + 64 * 1024 },
  },
  // E2E runs use a separate build dir so they don't share (or lock) the one
  // used by your own `pnpm dev` (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // Feed readers get reader pages' metadata (their feed links) in the <head>, like Next's
  // bots; browsers keep streamed metadata and the prerendered shell (src/lib/html-limited-bots.ts).
  htmlLimitedBots: htmlLimitedBots(HTML_LIMITED_BOT_UA_RE),
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
