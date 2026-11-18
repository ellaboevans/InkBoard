import { toNfc } from "./letters";
import { parsePoemLine, type PoemNode, type TextEdit } from "./poem-markdown";

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
 * - A paragraph whose first line starts with `^^` straight before its text
 *   (`^^The stranger did not…`) opens with a drop cap (Phase 24). The
 *   writer decides: it's never automatic, so text without the marker looks
 *   as it always has. The marker is removed from the paragraph wherever the
 *   text is read (page, feeds, plain text, Markdown); only the stored text
 *   and the JSON download keep it. Anywhere else (a later line of a
 *   paragraph, mid-line, `^^` alone or before a space, `^^^`) it's ordinary
 *   text, so a "^^" smiley in a text message stays one.
 */

export type ProseBlock = { kind: "paragraph"; lines: PoemNode[][]; dropCap?: true } | { kind: "break" };

/** What the writer types (or the editor's button inserts) at a paragraph's start for a drop cap. */
export const DROP_CAP_MARKER = "^^";
/** The marker, then the paragraph's first character, which must not be a space or another caret. */
const DROP_CAP = /^\^\^(?=[^\s^])/;

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
    if (lines.length) {
      const dropCap = DROP_CAP.test(lines[0]);
      if (dropCap) lines[0] = lines[0].slice(DROP_CAP_MARKER.length);
      blocks.push({ kind: "paragraph", lines: lines.map((l) => parsePoemLine(l)), ...(dropCap && { dropCap: true as const }) });
    }
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
 * Plain text for meta descriptions and the like: emphasis markers and drop
 * cap markers removed, paragraphs separated by a blank line, kept line breaks
 * as newlines, scene breaks left out.
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

/**
 * The editor's "Drop cap" button: adds the marker at the start of the
 * paragraph holding the selection's start (after any leading spaces), or
 * removes it if that paragraph has one. Null when that's a blank line or a
 * scene break (no paragraph to mark). Offsets are UTF-16, like a textarea's
 * selectionStart/End; the selection moves with the edit.
 */
export function toggleDropCap(text: string, selStart: number, selEnd = selStart): TextEdit | null {
  const lines = text.split("\n");
  let offset = 0;
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const end = offset + lines[i].length;
    if (selStart >= offset && selStart <= end) {
      at = i;
      break;
    }
    offset = end + 1;
  }
  if (at < 0) return null;
  const blank = (l: string) => l.trim() === "" || SCENE_BREAK.test(l);
  if (blank(lines[at])) return null;
  let start = at;
  while (start > 0 && !blank(lines[start - 1])) start--;
  const lineStart = lines.slice(0, start).reduce((n, l) => n + l.length + 1, 0);
  const pos = lineStart + /^[ \t]*/.exec(lines[start])![0].length;
  const n = DROP_CAP_MARKER.length;
  if (text.startsWith(DROP_CAP_MARKER, pos)) {
    const back = (o: number) => (o >= pos + n ? o - n : Math.min(o, pos));
    return { from: pos, to: pos + n, insert: "", selStart: back(selStart), selEnd: back(selEnd) };
  }
  const on = (o: number) => (o >= pos ? o + n : o);
  return { from: pos, to: pos, insert: DROP_CAP_MARKER, selStart: on(selStart), selEnd: on(selEnd) };
}
