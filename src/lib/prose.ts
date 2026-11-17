import { toNfc } from "./letters";
import { parsePoemLine, type PoemNode } from "./poem-markdown";

/**
 * Chapter text (docs/PLAN.md, Phase 23; docs/research/novels.md §2). Prose
 * isn't verse: paragraphs reflow. Pure and framework-free, shared by the
 * reader (`ProseText`), the editor preview, the export and (later) feeds,
 * meta descriptions and share images.
 *
 * Rules:
 * - A blank line (one or more) starts a new paragraph.
 * - A single line break inside a paragraph is kept (letters, songs, texts).
 * - Leading spaces and tabs are dropped (CSS indents paragraphs).
 * - A line holding only `* * *` or `***` is a scene break, even without
 *   blank lines around it.
 * - Inline emphasis (`*italic*`, `**bold**`, `\*`) is the poems' light
 *   Markdown, line by line (parsePoemLine), so it never crosses a line break.
 */

export type ProseBlock = { kind: "paragraph"; lines: PoemNode[][] } | { kind: "break" };

/** A scene-break line: three asterisks, with or without single spaces between. */
export const SCENE_BREAK = /^[ \t]*(?:\*\*\*|\* \* \*)[ \t]*$/;

/**
 * How chapter text is stored: NFC (letters.ts), line endings normalised,
 * trailing whitespace on each line and blank lines at either end dropped.
 * Everything else is kept as typed; the rules above apply when it's read.
 */
export function normalizeProse(text: string): string {
  return toNfc(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}

/** The text's paragraphs and scene breaks, each paragraph line parsed for emphasis. */
export function parseProse(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length) blocks.push({ kind: "paragraph", lines: lines.map((l) => parsePoemLine(l)) });
    lines = [];
  };
  for (const raw of normalizeProse(text).split("\n")) {
    if (SCENE_BREAK.test(raw)) {
      flush();
      // Two breaks in a row (or one at the very start) say nothing more than one.
      if (blocks.length > 0 && blocks[blocks.length - 1].kind !== "break") blocks.push({ kind: "break" });
      continue;
    }
    const line = raw.replace(/^[ \t]+/, "");
    if (line === "") flush();
    else lines.push(line);
  }
  flush();
  // Nor does one at the very end.
  if (blocks[blocks.length - 1]?.kind === "break") blocks.pop();
  return blocks;
}

function plain(nodes: PoemNode[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : plain(n.children))).join("");
}

/**
 * Plain text for meta descriptions and the like: emphasis markers removed,
 * paragraphs separated by a blank line, kept line breaks as newlines, scene
 * breaks left out.
 */
export function stripProse(text: string): string {
  return parseProse(text)
    .flatMap((b) => (b.kind === "paragraph" ? [b.lines.map(plain).join("\n")] : []))
    .join("\n\n");
}

/**
 * Words, for the reading time: runs of letters (with their combining marks,
 * so Ewe tone marks stay inside a word), digits and inner apostrophes or
 * hyphens. Emphasis stars and scene breaks don't count.
 */
export function countWords(text: string): number {
  return stripProse(text).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{M}\p{N}]+)*/gu)?.length ?? 0;
}
