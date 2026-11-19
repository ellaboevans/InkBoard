import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { SITE_NAME } from "@/lib/site";

export const alt = `Novels on ${SITE_NAME}: serials still being written, and finished ones`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** The /novels share card (Phase 29): static, no novel's text or title. */
export default async function Image() {
  return new ImageResponse(
    <OgCard
      kicker={`Novels on ${SITE_NAME}`}
      title="Serials, chapter by chapter"
      quote="Still being written, most recently updated first"
      footer="Free to read, no account needed."
    />,
    { ...size, fonts: await ogFonts() },
  );
}
