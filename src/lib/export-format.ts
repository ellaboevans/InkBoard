import { languageName } from "./poem-languages";

/*
 * The two download formats (docs/PLAN.md, Phase 17). Pure, so they're unit-
 * tested without a server. Text is written exactly as stored (NFC, Ghanaian
 * letters, IPA and Ewe tone marks included); the output is NFC-normalised as
 * a last step, which changes nothing for stored text and guards the rest.
 *
 * Markdown: one file to read in any text editor. JSON: the complete backup,
 * with a format version so a future import can read it.
 */

export const EXPORT_FORMAT_VERSION = 1;

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
  /** Saved versions, oldest first (the newest matches the poem). */
  revisions: { savedAt: string; title: string; text: string; language: string | null }[];
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
    pinnedPoemId: string | null;
    joinedAt: string;
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

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
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
  return [`### ${p.title}`, "", ...meta, "", p.text.replace(/\s+$/, ""), ""].join("\n");
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
  if (profile.bio) out.push(profile.bio, "");
  if (profile.links.length) out.push("Links:", ...profile.links.map((l) => `- ${l}`), "");
  out.push(
    `Author page: ${new URL(`/a/${profile.slug}`, data.site).href}`,
    `Exported from InkBoard on ${day(data.exportedAt)}: ${count(data.poems.length, "poem")} (${count(drafts, "draft")}, ${count(privates, "private poem")}), ${count(data.collections.length, "collection")}.`,
    "",
  );

  const byId = new Map(data.poems.map((p) => [p.id, p]));
  for (const c of data.collections) {
    out.push("---", "", `## ${c.title}`, "");
    if (c.intro) out.push(c.intro, "");
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
  // No whitespace clean-up here: blank lines inside a poem are part of it.
  return out.join("\n").normalize("NFC");
}
