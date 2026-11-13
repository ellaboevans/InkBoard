import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Default share card for every page without its own (board, sign-in, …). */
export default async function Image() {
  return new ImageResponse(
    <OgCard kicker="Poems, catalogued by author" title={SITE_TAGLINE} footer="Wander the board. Read the poets." />,
    { ...size, fonts: await ogFonts() },
  );
}
