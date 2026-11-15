import { ImageResponse } from "next/og";
import { FEATHER_PATHS, LogoMark } from "./og-card";
import { BRAND } from "@/lib/site";

/**
 * PNG app icons for the web manifest (src/app/manifest.ts), drawn like
 * src/app/apple-icon.tsx from the logo mark. Served by GET route handlers
 * under /icons/, which Cache Components prerender at build time.
 *
 * - "any": the rounded Feather tile, as in icon.svg, on transparency.
 * - "maskable": full-bleed ink red; the Feather stays inside the central 80%
 *   safe zone (a circle of radius 40%), since the OS crops to its own shape.
 */
export function appIconResponse(size: number, purpose: "any" | "maskable") {
  const body =
    purpose === "any" ? (
      <LogoMark size={size} />
    ) : (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.primary,
        }}
      >
        {/* 46% of the side: the glyph's corners stay well inside the 40%-radius safe circle. */}
        <svg
          width={size * 0.46}
          height={size * 0.46}
          viewBox="0 0 24 24"
          fill="none"
          stroke={BRAND.onPrimary}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {FEATHER_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    );
  return new ImageResponse(body, { width: size, height: size });
}
