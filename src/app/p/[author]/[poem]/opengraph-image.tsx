import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, ogQuote } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { pictureDataUri } from "@/server/author-picture";
import { SITE_NAME } from "@/lib/site";
import { getReaderPoem } from "@/server/board-cache";

export const alt = `A poem on ${SITE_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Share card for a poem. Private poems show only title and author: their
 * body is null in ReaderPoem (N1), so no protected text can leak here.
 */
export default async function Image({ params }: { params: Promise<{ author: string; poem: string }> }) {
  const { author, poem } = await params;
  const p = await getReaderPoem(author, poem);
  const fonts = await ogFonts();
  if (!p) return new ImageResponse(<OgCard title="Poem not found" />, { ...size, fonts });
  const picture = await pictureDataUri(p.picture);
  return new ImageResponse(
    <OgCard
      picture={picture}
      kicker={`by ${p.penName}`}
      title={p.title}
      quote={p.visibility === "public" ? ogQuote(p.body) : "This poem is password protected."}
    />,
    { ...size, fonts },
  );
}
