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

/** The file's name in the share sheet, the gallery or Downloads. */
export function shareImageFileName(poemSlug: string): string {
  return `inkboard-${poemSlug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "poem"}.png`;
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
