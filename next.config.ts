import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E runs use a separate build dir so they don't share (or lock) the one
  // used by your own `pnpm dev` (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
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
