/**
 * Atom 1.0 (RFC 4287) feeds of published poems (docs/PLAN.md, Phase 12).
 * Pure and framework-free: the loader (src/server/feeds.ts) supplies rows,
 * the cached wrapper (board-cache.ts) turns them into XML once per BOARD_TAG.
 *
 * Why Atom rather than RSS 2.0: every entry can carry its own language
 * (`xml:lang`, RSS only has one channel-wide <language>), `published` and
 * `updated` are both standard (RSS has only pubDate), the author is a name
 * rather than an email address (RSS's <author> must be an email, which we
 * never expose), and `type="html"` content is unambiguously defined.
 *
 * N1: a private entry's `body` is null (cut in SQL); it gets a fixed English
 * line instead of text. The builder never sees a private poem's words.
 */

import { languageName } from "./poem-languages";
import { parsePoem, type PoemNode } from "./poem-markdown";

export type FeedEntry = {
  id: string;
  title: string;
  /** Absolute URL of the reading page. */
  url: string;
  penName: string;
  /** Absolute URL of the author page. */
  authorUrl: string;
  visibility: "public" | "private";
  language: string | null;
  /** Full text of a public poem; always null for private ones. */
  body: string | null;
  published: Date;
  updated: Date;
};

export type Feed = {
  /** Absolute URL of this feed (its id and rel="self"). */
  selfUrl: string;
  /** Absolute URL of the matching HTML page (rel="alternate"). */
  pageUrl: string;
  title: string;
  subtitle: string;
  /** Feed-level author, for single-author feeds. */
  author?: { name: string; url: string };
  iconUrl: string;
  /** Used for <updated> when there are no entries. */
  emptyUpdated: Date;
  entries: FeedEntry[];
};

export const PRIVATE_ENTRY_TEXT = "This poem is password protected. Open it on InkBoard to read it with the password.";

// Characters XML 1.0 doesn't allow at all (C0 controls except tab, LF, CR;
// lone surrogates; U+FFFE/U+FFFF). Dropped rather than escaped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Escapes text for XML content and double-quoted attributes. */
export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const escapeHtml = escapeXml;

/**
 * Keeps indentation (spaces at the start of a line) and runs of spaces,
 * which HTML would collapse. Only the line's first text node is at its start.
 */
function keepSpaces(html: string, atLineStart: boolean): string {
  return html
    .replace(/\t/g, "    ")
    .replace(atLineStart ? /^ +| {2,}/g : / {2,}/g, (run, offset: number) =>
      atLineStart && offset === 0 ? "&#160;".repeat(run.length) : " " + "&#160;".repeat(run.length - 1),
    );
}

function nodesToHtml(nodes: PoemNode[], atLineStart: boolean): string {
  return nodes
    .map((n, i) => {
      const start = atLineStart && i === 0;
      if (typeof n === "string") return keepSpaces(escapeHtml(n), start);
      const tag = n.kind === "em" ? "em" : "strong";
      return `<${tag}>${nodesToHtml(n.children, start)}</${tag}>`;
    })
    .join("");
}

/**
 * A poem's light Markdown as HTML: <em>/<strong> only, every other
 * character escaped, line breaks as <br>, indentation as non-breaking spaces.
 */
export function poemToHtml(body: string): string {
  const lines = parsePoem(body.replace(/\r\n?/g, "\n")).map((line) => nodesToHtml(line, true));
  return `<p>${lines.join("<br>\n")}</p>`;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function entryXml(e: FeedEntry): string {
  const lang = e.language ? ` xml:lang="${escapeXml(e.language)}"` : "";
  const name = languageName(e.language);
  const content =
    e.visibility === "public" && e.body !== null
      ? `<content type="html"${lang}>${escapeXml(poemToHtml(e.body))}</content>`
      : // English UI text, even for a poem in another language.
        `<content type="text" xml:lang="en">${escapeXml(PRIVATE_ENTRY_TEXT)}</content>`;
  return [
    "  <entry>",
    `    <id>urn:uuid:${escapeXml(e.id)}</id>`,
    `    <title type="text"${lang}>${escapeXml(e.title)}</title>`,
    `    <link rel="alternate" type="text/html" href="${escapeXml(e.url)}"/>`,
    `    <author><name>${escapeXml(e.penName)}</name><uri>${escapeXml(e.authorUrl)}</uri></author>`,
    `    <published>${iso(e.published)}</published>`,
    `    <updated>${iso(e.updated)}</updated>`,
    ...(e.language && name
      ? [`    <category term="${escapeXml(e.language)}" label="${escapeXml(name)}"/>`]
      : []),
    `    ${content}`,
    "  </entry>",
  ].join("\n");
}

export function buildAtomFeed(feed: Feed): string {
  const updated = feed.entries.reduce(
    (max, e) => (e.updated > max ? e.updated : max),
    feed.entries.length ? feed.entries[0].updated : feed.emptyUpdated,
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">',
    `  <id>${escapeXml(feed.selfUrl)}</id>`,
    `  <title type="text">${escapeXml(feed.title)}</title>`,
    `  <subtitle type="text">${escapeXml(feed.subtitle)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(feed.selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(feed.pageUrl)}"/>`,
    ...(feed.author
      ? [`  <author><name>${escapeXml(feed.author.name)}</name><uri>${escapeXml(feed.author.url)}</uri></author>`]
      : []),
    `  <icon>${escapeXml(feed.iconUrl)}</icon>`,
    `  <updated>${iso(updated)}</updated>`,
    ...feed.entries.map(entryXml),
    "</feed>",
    "",
  ].join("\n");
}
