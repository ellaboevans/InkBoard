import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, truncate } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { pluralCount } from "@/lib/plural";
import { SITE_NAME } from "@/lib/site";
import { getCollectionPage } from "@/server/board-cache";

export const alt = `A collection of poems on ${SITE_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Share card for a collection: title, author, intro, poem count. Never a poem's text (N1). */
export default async function Image({ params }: { params: Promise<{ author: string; collection: string }> }) {
  const { author, collection } = await params;
  const c = await getCollectionPage(author, collection);
  const fonts = await ogFonts();
  if (!c) return new ImageResponse(<OgCard title="Collection not found" />, { ...size, fonts });
  return new ImageResponse(
    <OgCard
      kicker={`A collection by ${c.penName}`}
      title={c.title}
      quote={c.intro ? truncate(c.intro.replace(/\s+/g, " "), 140) : null}
      footer={`${pluralCount(c.poems.length, "poem")} on ${SITE_NAME}`}
    />,
    { ...size, fonts },
  );
}
