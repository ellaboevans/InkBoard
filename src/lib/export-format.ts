import { parsePoemLine, type PoemNode } from "./poem-markdown";
import { languageName } from "./poem-languages";
import { parseProse } from "./prose";

/*
 * The two download formats (docs/PLAN.md, Phase 17). Pure, so they're unit-
 * tested without a server. Text is written exactly as stored (NFC, Ghanaian
 * letters, IPA and Ewe tone marks included); the output is NFC-normalised as
 * a last step, which changes nothing for stored text and guards the rest.
 *
 * Markdown: one file to read in any text editor, which also renders properly
 * in a Markdown viewer (see poemTextToMarkdown). JSON: the complete backup,
 * with the text exactly as stored and a format version so a future import can
 * read it.
 */

/**
 * 2: poems carry `shareVisits` (Phase 21 round 3).
 * 3: `profile.photo`, the profile photo itself (Phase 22).
 * 4: `novels`, each with its chapters in order and their versions (Phase 23).
 * 5: novels carry `visibility` (Phase 25; never a password hash or version).
 * 6: novels carry `cover`, the uploaded cover itself (Phase 25), or null.
 * 7: chapters carry `shareVisits` (Phase 25, "Share a passage").
 * 8: chapters carry `scheduledFor`, and a scheduled chapter's `status` is "scheduled" (Phase 28).
 * 9: `profile`, poems and novels carry `hiddenAt`: when InkBoard's owner hid it from readers, or null (Phase 32 round 2).
 */
export const EXPORT_FORMAT_VERSION = 9;

/**
 * The profile photo inside the JSON download (Phase 22): our processed
 * 512 px JPEG copy (no metadata), base64-encoded, so the backup is complete
 * on its own and survives the account. Null when there's no photo.
 */
export type ExportedPhoto = { type: "image/jpeg"; width: number; height: number; base64: string };

export type ExportedPoem = {
  id: string;
  title: string;
  slug: string;
  /** As written: light Markdown (*italic*, **bold**), line breaks and indentation kept. */
  text: string;
  language: string | null;
  visibility: "public" | "private";
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  collection: { id: string; title: string; position: number } | null;
  /** Visits through the short link printed on its shared pictures (0 if never shared as a picture). */
  shareVisits: number;
  /** When InkBoard's owner hid it from readers (Phase 32 round 2), or null: shown. */
  hiddenAt: string | null;
  /** Saved versions, oldest first (the newest matches the poem). */
  revisions: { savedAt: string; title: string; text: string; language: string | null }[];
};

export type ExportedChapter = {
  id: string;
  /** May be empty: readers see "Chapter n". */
  title: string;
  slug: string;
  /** 1..n over all the novel's chapters, drafts included. */
  position: number;
  /** "scheduled": published with its release still ahead (Phase 28); readers see nothing of it yet. */
  status: "draft" | "published" | "scheduled";
  /** First release; null for a draft and for a chapter that hasn't been out yet. */
  publishedAt: string | null;
  /** When a scheduled chapter goes live (UTC), else null. */
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  /** Visits through the short link printed on its passage pictures (Phase 25; 0 if never shared). */
  shareVisits: number;
  /** As written: prose (paragraphs, kept line breaks, `* * *` scene breaks, light Markdown). */
  text: string;
  /** Saved versions, oldest first (the newest matches the chapter). */
  revisions: { savedAt: string; title: string; text: string }[];
};

export type ExportedNovel = {
  id: string;
  title: string;
  slug: string;
  blurb: string | null;
  language: string | null;
  status: "ongoing" | "complete";
  /** Private: readers need the novel's password (or the shared one), which isn't in the file. */
  visibility: "public" | "private";
  /** The uploaded cover: our processed 2:3 JPEG copy (no metadata), base64; null for a drawn cover. */
  cover: ExportedPhoto | null;
  /** When InkBoard's owner hid it (and its chapters) from readers (Phase 32 round 2), or null: shown. */
  hiddenAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** In reading order, drafts included. */
  chapters: ExportedChapter[];
};

export type EditorExport = {
  format: "inkboard-export";
  version: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  /** Where the account lived, e.g. https://inkboard.example */
  site: string;
  profile: {
    penName: string;
    slug: string;
    tagline: string | null;
    bio: string | null;
    links: string[];
    avatar: string | null;
    photo: ExportedPhoto | null;
    pinnedPoemId: string | null;
    joinedAt: string;
    /** When InkBoard's owner hid the author page and everything on it from readers (Phase 32 round 2), or null. */
    hiddenAt: string | null;
  };
  /** In the order of the editor's Collections page; poemIds in reading order. */
  collections: {
    id: string;
    title: string;
    slug: string;
    intro: string | null;
    createdAt: string;
    updatedAt: string;
    poemIds: string[];
  }[];
  /** Oldest first: drafts and private poems included, with their text. */
  poems: ExportedPoem[];
  /** Oldest first, every chapter with its text (Phase 23). */
  novels: ExportedNovel[];
};

export type ExportFormat = "markdown" | "json";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/** e.g. inkboard-ama-serwaa-2026-11-15.md (slugs are ASCII, so no escaping needed). */
export function exportFileName(slug: string, format: ExportFormat, at: Date): string {
  const safe = slug.replace(/[^a-z0-9-]/g, "") || "poems";
  return `inkboard-${safe}-${at.toISOString().slice(0, 10)}.${format === "markdown" ? "md" : "json"}`;
}

export function exportToJson(data: EditorExport): string {
  return `${JSON.stringify(data, null, 2)}\n`.normalize("NFC");
}

/*
 * Poem text in the Markdown file (docs/PLAN.md, Phase 19). In Markdown a
 * single newline doesn't break a line, leading spaces are dropped (or, four or
 * more, start a code block), and lines like "- …", "# …", "1. …" or "---"
 * become lists, headings and rules. So each poem is written so that it reads
 * the same as plain text and renders the same as on InkBoard:
 *
 * - Lines inside a stanza end with two spaces (a CommonMark hard line break,
 *   invisible as plain text). Blank lines stay blank, so stanzas are paragraphs.
 * - Leading indentation becomes no-break spaces (U+00A0; a tab counts as four),
 *   which look like spaces and which Markdown keeps.
 * - The poem's own light Markdown (*italic*, **bold**) is written back as such;
 *   everything else that Markdown or GitHub would read as syntax gets a
 *   backslash, only where it would be read that way.
 *
 * The text is still the poem as written (letters, tone marks, NFC); only
 * whitespace and those escapes differ. The JSON file keeps it exactly.
 */
const NBSP = "\u00a0";
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const isEdgeOrSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Backslash-escapes the characters of literal text that CommonMark (or GFM) would treat as syntax. */
function escapeInline(text: string, atLineStart: boolean, atLineEnd: boolean): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = i === 0 ? (atLineStart ? undefined : "x") : text[i - 1];
    const next = i === text.length - 1 ? (atLineEnd ? undefined : "x") : text[i + 1];
    const alone = isEdgeOrSpace(prev) && isEdgeOrSpace(next);
    let escape = false;
    if (c === "\\") escape = next === undefined || ASCII_PUNCT.test(next);
    else if (c === "*" || c === "~") escape = !alone; // emphasis, GFM strikethrough
    else if (c === "_") escape = !alone && !(isWordChar(prev) && isWordChar(next)); // intraword _ is never emphasis
    else if (c === "`" || c === "[" || c === "|") escape = true; // code, links and images, GFM tables
    else if (c === "<") escape = /[A-Za-z/!?]/.test(next ?? ""); // HTML and autolinks
    else if (c === "&") escape = /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(text.slice(i)); // entities
    out += escape ? `\\${c}` : c;
  }
  return out;
}

/** A backslash for an unindented line that Markdown would read as a heading, quote, list, rule or setext underline. */
function escapeBlockStart(line: string): string {
  if (/^(#{1,6}(\s|$)|>|[-+*](\s|$)|[-=_*]{2,}\s*$|(-\s*){3,}$|(\*\s*){3,}$|(_\s*){3,}$|=+\s*$)/.test(line)) {
    return `\\${line}`;
  }
  return line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
}

function nodesToMarkdown(nodes: PoemNode[], nested = false): string {
  return nodes
    .map((n, i) => {
      if (typeof n === "string") return escapeInline(n, !nested && i === 0, !nested && i === nodes.length - 1);
      const mark = n.kind === "strong" ? "**" : "*";
      return `${mark}${nodesToMarkdown(n.children, true)}${mark}`;
    })
    .join("");
}

/** Poem text (light Markdown, as stored) as Markdown that keeps every line, stanza and indent. */
export function poemTextToMarkdown(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return "";
      const indent = /^[ \t]*/.exec(line)![0];
      const rest = line.slice(indent.length).replace(/[ \t]+$/, "");
      const body = nodesToMarkdown(parsePoemLine(rest));
      // An indented line starts with no-break spaces, which no block syntax follows.
      return indent ? indent.replace(/\t/g, "    ").replace(/ /g, NBSP) + body : escapeBlockStart(body);
    });
  // Every line that another line follows in the same stanza ends with a hard break.
  return lines.map((l, i) => (l && lines[i + 1] ? `${l}  ` : l)).join("\n");
}

/** Plain text (a bio, a collection's intro) the same way: line breaks kept, nothing read as Markdown. */
export function plainTextToMarkdown(text: string): string {
  return poemTextToMarkdown(text.replace(/\*/g, "\\*"));
}

/**
 * Chapter prose (src/lib/prose.ts) as Markdown that renders the way readers
 * see it: paragraphs separated by a blank line, kept line breaks as hard
 * breaks (two spaces), leading spaces dropped (as the reader drops them),
 * scene breaks as `* * *` (a thematic break), the light Markdown written back
 * and everything else escaped exactly as for poems. Words are unchanged.
 */
export function proseToMarkdown(text: string): string {
  return parseProse(text)
    .map((block) =>
      block.kind === "break"
        ? "* * *"
        : block.lines.map((line) => escapeBlockStart(nodesToMarkdown(line))).join("  \n"),
    )
    .join("\n\n");
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
/** "2026-11-21 18:00" from an ISO instant (UTC). */
const minuteUtc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
const count = (n: number, one: string, other = `${one}s`) => `${n} ${n === 1 ? one : other}`;

function poemSection(p: ExportedPoem): string {
  const language = p.language ? `${languageName(p.language) ?? p.language} (${p.language})` : "Not set";
  const meta = [
    `- Language: ${language}`,
    `- Visibility: ${p.visibility === "public" ? "Public" : "Private (readers need a password; the password isn't in this file)"}${p.status === "draft" ? " once published" : ""}`,
    `- Status: ${p.status === "published" ? `Published ${day(p.publishedAt) ?? ""}`.trim() : "Draft"}`,
    ...(p.collection ? [`- Collection: ${p.collection.title}, part ${p.collection.position}`] : []),
    `- Created ${day(p.createdAt)} · last edited ${day(p.updatedAt)}`,
  ];
  return [`### ${p.title}`, "", ...meta, "", poemTextToMarkdown(p.text), ""].join("\n");
}

function novelSection(n: ExportedNovel): string {
  const language = n.language ? `${languageName(n.language) ?? n.language} (${n.language})` : "Not set";
  const published = n.chapters.filter((c) => c.status === "published").length;
  const scheduled = n.chapters.filter((c) => c.status === "scheduled").length;
  const out = [
    `## ${n.title}`,
    "",
    `- Novel, ${n.status === "complete" ? "complete" : "ongoing"}: ${count(n.chapters.length, "chapter")} (${published} published${scheduled ? `, ${scheduled} scheduled` : ""})`,
    `- Language: ${language}`,
    `- Visibility: ${n.visibility === "public" ? "Public" : "Private (readers need a password; the password isn't in this file)"}`,
    ...(n.cover ? [`- Cover: an uploaded picture, in the JSON download (novels[].cover)`] : []),
    `- Created ${day(n.createdAt)} · last edited ${day(n.updatedAt)}`,
    "",
  ];
  if (n.blurb) out.push(plainTextToMarkdown(n.blurb), "");
  if (n.chapters.length === 0) out.push("*No chapters yet.*", "");
  for (const c of n.chapters) {
    const status =
      c.status === "scheduled" && c.scheduledFor
        ? `Scheduled for ${minuteUtc(c.scheduledFor)} UTC`
        : c.status === "published"
          ? `Published ${day(c.publishedAt) ?? ""}`.trim()
          : "Draft";
    out.push(
      `### Chapter ${c.position}${c.title ? ` · ${c.title}` : ""}`,
      "",
      `- ${status} · ${count(c.wordCount, "word")}`,
      "",
      ...(c.text ? [proseToMarkdown(c.text), ""] : ["*Empty draft.*", ""]),
    );
  }
  return out.join("\n");
}

/**
 * One readable file: the profile at the top, then each collection with its
 * poems in order, then the poems not in a collection, oldest first. Each poem:
 * its title as a heading, its details, then the text as written.
 */
export function exportToMarkdown(data: EditorExport): string {
  const { profile } = data;
  const drafts = data.poems.filter((p) => p.status === "draft").length;
  const privates = data.poems.filter((p) => p.visibility === "private").length;
  const out: string[] = [`# ${profile.penName}`, ""];
  if (profile.tagline) out.push(`*${profile.tagline}*`, "");
  if (profile.bio) out.push(plainTextToMarkdown(profile.bio), "");
  if (profile.links.length) out.push("Links:", ...profile.links.map((l) => `- ${l}`), "");
  if (profile.photo) out.push("Your profile photo is in the JSON download (profile.photo).", "");
  out.push(
    `Author page: ${new URL(`/a/${profile.slug}`, data.site).href}`,
    `Exported from InkBoard on ${day(data.exportedAt)}: ${count(data.poems.length, "poem")} (${count(drafts, "draft")}, ${count(privates, "private poem")}), ${count(data.collections.length, "collection")}${data.novels.length ? `, ${count(data.novels.length, "novel")}` : ""}.`,
    "",
  );

  const byId = new Map(data.poems.map((p) => [p.id, p]));
  for (const c of data.collections) {
    out.push("---", "", `## ${c.title}`, "");
    if (c.intro) out.push(plainTextToMarkdown(c.intro), "");
    if (c.poemIds.length === 0) out.push("*No poems in this collection yet.*", "");
    for (const id of c.poemIds) {
      const poem = byId.get(id);
      if (poem) out.push(poemSection(poem));
    }
  }
  const loose = data.poems.filter((p) => !p.collection);
  if (loose.length) {
    out.push("---", "", data.collections.length ? "## Poems not in a collection" : "## Poems", "");
    for (const p of loose) out.push(poemSection(p));
  }
  if (data.poems.length === 0) out.push("---", "", "*No poems yet.*", "");
  // Novels after the poems, each with its chapters in order (Phase 23).
  for (const n of data.novels) out.push("---", "", novelSection(n));
  // Poem text went through poemTextToMarkdown: its lines, blank lines and indents are all kept.
  return out.join("\n").normalize("NFC");
}
