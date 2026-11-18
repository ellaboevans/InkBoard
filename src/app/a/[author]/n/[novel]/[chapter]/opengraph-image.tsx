import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/brand/og-card";
import { ogFonts } from "@/components/brand/og-fonts";
import { sectionHue } from "@/lib/board-layout";
import { SITE_NAME } from "@/lib/site";
import { getReaderChapter } from "@/server/board-cache";

export const alt = `A chapter of a novel on ${SITE_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Link card for a chapter (Phase 23b): the novel's drawn cover, "Chapter n",
 * the chapter's title and the novel's. Never a word of the chapter's text.
 */
export default async function Image({ params }: { params: Promise<{ author: string; novel: string; chapter: string }> }) {
  const { author, novel, chapter } = await params;
  const c = await getReaderChapter(author, novel, chapter);
  const fonts = await ogFonts();
  if (!c) return new ImageResponse(<OgCard title="Chapter not found" />, { ...size, fonts });
  const titled = c.title.trim() !== "";
  return new ImageResponse(
    <OgCard
      cover={{ title: c.novel.title, penName: c.penName, hue: sectionHue(c.editorId) }}
      kicker={titled ? `Chapter ${c.number}` : c.novel.title}
      title={c.displayTitle}
      quote={titled ? c.novel.title : null}
      footer={`A novel by ${c.penName} on ${SITE_NAME}`}
    />,
    { ...size, fonts },
  );
}
