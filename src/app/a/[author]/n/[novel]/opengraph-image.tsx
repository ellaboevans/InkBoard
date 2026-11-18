import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, truncate } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { sectionHue } from "@/lib/board-layout";
import { pluralCount } from "@/lib/plural";
import { SITE_NAME } from "@/lib/site";
import { getNovelPage } from "@/server/board-cache";

export const alt = `A novel on ${SITE_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Link card for a novel (Phase 23b): the drawn cover, title, author, the
 * start of the blurb and the published chapter count. Never chapter text.
 */
export default async function Image({ params }: { params: Promise<{ author: string; novel: string }> }) {
  const { author, novel } = await params;
  const n = await getNovelPage(author, novel);
  const fonts = await ogFonts();
  if (!n) return new ImageResponse(<OgCard title="Novel not found" />, { ...size, fonts });
  return new ImageResponse(
    <OgCard
      cover={{ title: n.title, penName: n.penName, hue: sectionHue(n.editorId) }}
      kicker={`A novel by ${n.penName}`}
      title={n.title}
      quote={n.blurb ? truncate(n.blurb.replace(/\s+/g, " "), 120) : null}
      footer={`${pluralCount(n.chapterCount, "chapter")} · ${n.status} · on ${SITE_NAME}`}
    />,
    { ...size, fonts },
  );
}
