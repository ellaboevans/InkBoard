import { toNfc } from "./letters";

/**
 * Text rules shared by the server and the editor's live card preview, so the
 * preview shows exactly what the board will.
 */

/** How the board's card excerpt is cut (see loadBoardSections in src/server/board.ts). */
export const EXCERPT_LINES = 5;
export const EXCERPT_CHARS = 280;

/**
 * How a poem body is stored: one Unicode form (NFC, see letters.ts), line
 * endings normalised, leading blank lines and trailing whitespace dropped.
 * Indentation inside the poem is meaningful and kept.
 */
export function normalizePoemBody(body: string): string {
  return toNfc(body).replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").trimEnd();
}

/**
 * The card excerpt for a (normalised) body. Mirrors the SQL in board.ts:
 * the first EXCERPT_LINES lines, cut to EXCERPT_CHARS characters. Like
 * Postgres, it counts characters as code points, so an emoji counts as one.
 */
export function cardExcerpt(body: string): { excerpt: string; hasMore: boolean } {
  const lines = body === "" ? [] : body.split("\n");
  const head = Array.from(lines.slice(0, EXCERPT_LINES).join("\n"));
  return {
    excerpt: head.slice(0, EXCERPT_CHARS).join(""),
    hasMore: lines.length > EXCERPT_LINES || Array.from(body).length > EXCERPT_CHARS,
  };
}
