import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy without nonces. Nonces force every page to render
 * dynamically, which would disable the prerendered board (Partial
 * Prerendering). `'unsafe-inline'` scripts are needed for Next's inline RSC
 * payload; the risk is limited because no user-supplied HTML is ever
 * rendered (poems are plain text, escaped by React). Everything else is
 * locked down: no third-party origins at all, no framing, no plugins, forms
 * only post to us. `'unsafe-eval'` is dev-only (React Refresh).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Sileo and Radix inject inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  // next/font self-hosts the Google fonts.
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

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
  env: { INKBOARD_BUILD_ID: buildId },
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
