import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { ShareImage } from "@/components/brand/share-image";
import { OG_FONT } from "@/components/brand/og-type";
import { avatarIdFor } from "@/lib/avatars";
import { languageName } from "@/lib/poem-languages";
import { measureWith, readFontMetrics, type FontMetrics } from "@/lib/share-image/font-metrics";
import { layoutShareImage, SHARE_FRAME, type Measure, type ShareImageInput, type ShareImageLayout } from "@/lib/share-image/layout";
import { poemPath } from "@/lib/share-image/share-text";
import { siteUrl } from "@/lib/site";
import { renderAvatarSvg } from "./avatar-svg";
import type { SharePoem } from "./board";

/*
 * Renders the "Share as image" PNG for a public poem (docs/PLAN.md, Phase 21).
 * Framework-light (next/og only), so tests can render it too; the cached,
 * tagged wrapper is share-image-cache.ts and the route is
 * src/app/p/[author]/[poem]/share-image/route.ts.
 *
 * Fonts (static TTFs, src/assets/fonts; Satori can't read variable fonts or woff2):
 * - Newsreader 72pt (display) regular + italic: title, byline, address;
 * - Newsreader 16pt (text) in four styles: the poem, like the reading page's
 *   optical size at body sizes, so **bold** and *italic* stay as written;
 * - Gentium Book Plus in four styles: every Ghanaian letter and tone mark.
 * The layout measures with the same files, so what it computes is what Satori draws.
 */

type Style = "normal" | "italic";
type Weight = 400 | 700;
type Face = { name: string; file: string; style: Style; weight: Weight };

const FACES: Face[] = [
  { name: OG_FONT.display, file: "Newsreader.ttf", style: "normal", weight: 400 },
  { name: OG_FONT.display, file: "Newsreader-Italic.ttf", style: "italic", weight: 400 },
  { name: OG_FONT.text, file: "NewsreaderText-Regular.ttf", style: "normal", weight: 400 },
  { name: OG_FONT.text, file: "NewsreaderText-Italic.ttf", style: "italic", weight: 400 },
  { name: OG_FONT.text, file: "NewsreaderText-Bold.ttf", style: "normal", weight: 700 },
  { name: OG_FONT.text, file: "NewsreaderText-BoldItalic.ttf", style: "italic", weight: 700 },
  { name: OG_FONT.extended, file: "GentiumBookPlus-Regular.ttf", style: "normal", weight: 400 },
  { name: OG_FONT.extended, file: "GentiumBookPlus-Italic.ttf", style: "italic", weight: 400 },
  { name: OG_FONT.extended, file: "GentiumBookPlus-Bold.ttf", style: "normal", weight: 700 },
  { name: OG_FONT.extended, file: "GentiumBookPlus-BoldItalic.ttf", style: "italic", weight: 700 },
];

type LoadedFonts = {
  fonts: { name: string; data: Buffer; style: Style; weight: Weight }[];
  measure: Measure;
};

let loaded: Promise<LoadedFonts> | null = null;

/** The font files, read once per process, and a Measure that picks faces the way Satori does. */
export function shareImageFonts(): Promise<LoadedFonts> {
  loaded ??= (async () => {
    const dir = join(process.cwd(), "src/assets/fonts");
    const datas = await Promise.all(FACES.map((f) => readFile(join(dir, f.file))));
    const metrics = new Map<string, FontMetrics>();
    FACES.forEach((f, i) => metrics.set(`${f.name}|${f.style}|${f.weight}`, readFontMetrics(datas[i])));
    // Satori picks the registered face of a family closest to the asked style and weight.
    const face = (name: string, italic: boolean, bold: boolean) =>
      metrics.get(`${name}|${italic ? "italic" : "normal"}|${bold ? 700 : 400}`) ??
      metrics.get(`${name}|${italic ? "italic" : "normal"}|400`)!;
    const measure: Measure = (text, style, size) => {
      const newsreader = face(OG_FONT[style.cut], style.italic, style.bold);
      const gentium = face(OG_FONT.extended, style.italic, style.bold);
      return measureWith(style.extendedFirst ? [gentium, newsreader] : [newsreader, gentium], text, size);
    };
    return {
      fonts: FACES.map((f, i) => ({ name: f.name, data: datas[i], style: f.style, weight: f.weight })),
      measure,
    };
  })().catch((error) => {
    loaded = null;
    throw error;
  });
  return loaded;
}

/** What goes on the image, from a poem the share loader returned (public and published). */
export function shareImageInput(poem: SharePoem): ShareImageInput {
  return {
    title: poem.title,
    body: poem.body,
    penName: poem.penName,
    language: languageName(poem.language),
    host: siteUrl().host,
    path: poemPath(poem.authorSlug, poem.slug),
  };
}

export async function shareImageLayout(poem: SharePoem): Promise<ShareImageLayout> {
  const { measure } = await shareImageFonts();
  return layoutShareImage(shareImageInput(poem), measure);
}

/** The PNG and its ETag (a hash of the bytes: same picture, same tag). */
export async function renderShareImage(poem: SharePoem): Promise<{ png: Uint8Array; etag: string }> {
  const { fonts, measure } = await shareImageFonts();
  const layout = layoutShareImage(shareImageInput(poem), measure);
  const svg = renderAvatarSvg(avatarIdFor({ id: poem.editorId, avatar: poem.avatar }));
  const avatar = svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` : null;
  const response = new ImageResponse(<ShareImage layout={layout} avatar={avatar} />, {
    width: SHARE_FRAME.width,
    height: SHARE_FRAME.height,
    fonts,
  });
  const png = new Uint8Array(await response.arrayBuffer());
  const etag = `"${createHash("sha256").update(png).digest("base64url").slice(0, 32)}"`;
  return { png, etag };
}
