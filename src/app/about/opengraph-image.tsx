import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { SITE_NAME } from "@/lib/site";

export const alt = `About ${SITE_NAME}: a home for poetry in Ghanaian languages and English`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** The About page's share card: what InkBoard is, in the brand's own letters. */
export default async function Image() {
  return new ImageResponse(
    <OgCard
      kicker={`About ${SITE_NAME}`}
      title="A home for poetry in Ghanaian languages and English"
      quote="Ewe · Twi · Fante · Ga · Nzema · English"
      footer="Free to read, no account needed. A quiet place to write."
    />,
    { ...size, fonts: await ogFonts() },
  );
}
