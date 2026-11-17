/*
 * What goes with the shared picture (docs/PLAN.md, Phase 21). Pure, shared
 * by the reading view (server) and the share sheet (client).
 */
import { SITE_NAME } from "@/lib/site";

/** A poem's reading page. Slugs are plain ASCII (src/lib/slug.ts); encoded anyway. */
export function poemPath(authorSlug: string, poemSlug: string): string {
  return `/p/${encodeURIComponent(authorSlug)}/${encodeURIComponent(poemSlug)}`;
}

/** The image route (src/app/p/[author]/[poem]/share-image/route.ts). */
export function shareImagePath(authorSlug: string, poemSlug: string): string {
  return `${poemPath(authorSlug, poemSlug)}/share-image`;
}

/** The file's name in the share sheet, the gallery or Downloads: inkboard-<slug>[-chat][-ink|-board][-lines].png (Page has no suffix). */
export function shareImageFileName(
  poemSlug: string,
  { format = "story", design = "page", lines = false }: { format?: string; design?: string; lines?: boolean } = {},
): string {
  const base = poemSlug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "poem";
  const designPart = design === "ink" || design === "board" ? `-${design}` : "";
  return `inkboard-${base}${format === "chat" ? "-chat" : ""}${designPart}${lines ? "-lines" : ""}.png`;
}

/**
 * The image route's query for a format, a design and a pick (canonical,
 * selection.ts): "" for the whole poem on a Status in the Page design, else
 * e.g. "?format=chat&design=ink&lines=3-6,9". The default picture keeps
 * Phase 21's bare address.
 */
export function shareImageQuery(format: string, selection: string | null, design = "page"): string {
  const q = new URLSearchParams();
  if (format !== "story") q.set("format", format);
  if (design !== "page") q.set("design", design);
  if (selection) q.set("lines", selection);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The poem's lines for the picker (src/app/p/[author]/[poem]/share-image/lines/route.ts). */
export function shareLinesPath(authorSlug: string, poemSlug: string): string {
  return `${shareImagePath(authorSlug, poemSlug)}/lines`;
}

/**
 * The text sent with the image (a decision of the owner's):
 * “Title” by Pen Name, on InkBoard: https://…/p/author/poem
 * WhatsApp shows no alt text, so this is also what a screen reader user hears.
 */
export function shareText({ title, penName, url }: { title: string; penName: string; url: string }): string {
  return `“${title.trim()}” by ${penName.trim()}, on ${SITE_NAME}: ${url}`;
}

/** WhatsApp's click-to-chat link with that text: opens a contact picker, then the link gets its usual preview. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
