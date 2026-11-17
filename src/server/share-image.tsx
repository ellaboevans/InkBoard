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
import {
  layoutShareImage,
  type Measure,
  type ShareFormat,
  type ShareImageInput,
  type ShareImageLayout,
} from "@/lib/share-image/layout";
import { SHARE_DESIGNS, type ShareDesign } from "@/lib/share-image/designs";
import { encodeSelection, poemLines } from "@/lib/share-image/selection";
import { shortPath } from "@/lib/share-image/short-code";
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
    // The short link once the poem has one (always, by the time the route draws it).
    path: poem.shortCode ? shortPath(poem.shortCode) : poemPath(poem.authorSlug, poem.slug),
  };
}

/** What to draw: a format, and picked lines (validated by parseSelection) or the whole poem. */
export type ShareImageRequest = { format: ShareFormat; design?: ShareDesign; picked?: readonly number[] };

export async function shareImageLayout(poem: SharePoem, request: ShareImageRequest = { format: "story" }): Promise<ShareImageLayout> {
  const { measure } = await shareImageFonts();
  return layoutShareImage(shareImageInput(poem), measure, request);
}

/**
 * Bumped by hand when the picture changes for the same inputs within one
 * build id (in practice never: every deploy has a new INKBOARD_BUILD_ID).
 */
const RENDER_VERSION = 3;

/**
 * The ETag: a hash of everything the picture is drawn from (the poem's
 * fields, the author's avatar, the address with its short code, the format,
 * the design, the pick) and the
 * build. Rendering is deterministic, so the same inputs give the same bytes;
 * and the route can answer a revalidation with 304 without drawing anything,
 * which matters for picked lines, whose pictures aren't cached.
 */
export function shareImageEtag(poem: SharePoem, request: ShareImageRequest): string {
  const inputs = JSON.stringify([
    RENDER_VERSION,
    process.env.INKBOARD_BUILD_ID ?? "dev",
    shareImageInput(poem),
    avatarIdFor({ id: poem.editorId, avatar: poem.avatar }),
    request.format,
    request.design ?? "page",
    request.picked ? encodeSelection(request.picked, poemLines(poem.body)) : null,
  ]);
  return `"${createHash("sha256").update(inputs).digest("base64url").slice(0, 32)}"`;
}

export type RenderedShareImage = {
  png: Uint8Array;
  etag: string;
  /** Picked lines: how many were picked and how many fit; null for the whole poem. */
  quote: { picked: number; shown: number } | null;
};

/** Draws the PNG (Satori + resvg, about 40–150 ms). */
export async function renderShareImage(poem: SharePoem, request: ShareImageRequest = { format: "story" }): Promise<RenderedShareImage> {
  const { fonts, measure } = await shareImageFonts();
  const layout = layoutShareImage(shareImageInput(poem), measure, request);
  const svg = renderAvatarSvg(avatarIdFor({ id: poem.editorId, avatar: poem.avatar }));
  const avatar = svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` : null;
  const response = new ImageResponse(<ShareImage layout={layout} avatar={avatar} design={request.design && request.design in SHARE_DESIGNS ? request.design : "page"} />, {
    width: layout.frame.width,
    height: layout.frame.height,
    fonts,
  });
  const png = new Uint8Array(await response.arrayBuffer());
  return { png, etag: shareImageEtag(poem, request), quote: layout.quote };
}
