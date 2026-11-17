import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, truncate } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { pictureDataUri } from "@/server/author-picture";
import { SITE_NAME } from "@/lib/site";
import { getAuthorPage } from "@/server/board-cache";
import { pluralCount } from "@/lib/plural";

export const alt = `An author on ${SITE_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Share card for an author page: pen name, tagline, poem count. Never the email. */
export default async function Image({ params }: { params: Promise<{ author: string }> }) {
  const { author } = await params;
  const a = await getAuthorPage(author);
  const fonts = await ogFonts();
  if (!a) return new ImageResponse(<OgCard title="Author not found" />, { ...size, fonts });
  const n = a.poems.length;
  const picture = await pictureDataUri(a.picture);
  return new ImageResponse(
    <OgCard
      picture={picture}
      kicker="Poems by"
      title={a.penName}
      quote={a.tagline ? truncate(a.tagline, 140) : null}
      footer={`${pluralCount(n, "poem")} on ${SITE_NAME}`}
    />,
    { ...size, fonts },
  );
}
