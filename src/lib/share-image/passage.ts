/*
 * "Share a passage" (docs/PLAN.md, Phase 25 round 3): which part of a public
 * chapter a reader picked for a picture, and the one string that carries the
 * pick to the route (`?passage=3.2-4`). Pure, shared by the sheet (client)
 * and the route (server), so both count and check exactly alike.
 *
 * THE UNITS: the chapter's paragraphs, as parseProse (src/lib/prose.ts) reads
 * them (scene breaks aren't paragraphs; the drop-cap marker is dropped and
 * emphasis kept), numbered 1..n; and each paragraph's sentences, numbered
 * 1..k: a sentence ends at . ! ? or … (with any closing quotes or brackets
 * after it) followed by a space or a line break. Sentences are only where a
 * pick may start or end; a paragraph with no such stop is one sentence.
 *
 * THE MODEL: consecutive paragraphs a..b, starting at sentence s of a and
 * ending after sentence t of b (whole paragraphs in between), at most
 * PASSAGE_MAX_CHARS characters. No whole chapter (an owner's decision).
 *
 * THE COUNT: user-perceived characters (grapheme clusters: "ɛ́" is one, though
 * it's two code points), emphasis markers excluded, plus one for each join
 * between two picked sentences (a space, a kept line break or a paragraph
 * break). The sheet shows it live against the cap; the route refuses more.
 *
 * THE FORM: `a[.s]-b[.t]`, 1-based, no leading zeros: `.s` only when the pick
 * starts after the first sentence of a, `.t` only when it ends before the last
 * sentence of b; one whole paragraph is just `a` (never `a-a`). Exactly one
 * string per pick, and the route accepts only that one (it re-encodes and
 * compares): out of range, backwards, junk, over the cap, all a 400.
 */
import { splitGraphemes } from "@/components/brand/og-type";
import type { PoemNode } from "@/lib/poem-markdown";
import { parseProse } from "@/lib/prose";

/** About two-thirds of a page: room for a few sentences that land, short enough to read on a Status. */
export const PASSAGE_MAX_CHARS = 600;
/** Longer than any valid form (`9999.9999-9999.9999`); refused before parsing. */
const MAX_FORM_LENGTH = 24;
const FORM = /^([1-9]\d{0,3})(?:\.([1-9]\d{0,3}))?(?:-([1-9]\d{0,3})(?:\.([1-9]\d{0,3}))?)?$/;

export type PassagePiece = { text: string; italic: boolean; bold: boolean };
export type PassageSentence = {
  /** Plain text (emphasis markers removed); a kept line break inside it is "\n". */
  text: string;
  /** The same text with its emphasis, for drawing. */
  pieces: PassagePiece[];
  /** A kept line break (not a space) stands before it in its paragraph. */
  newLine: boolean;
};
export type PassageParagraph = { sentences: PassageSentence[]; sceneBreakBefore: boolean };

/** Where a sentence ends and the next begins: a stop, its closers, then spaces. */
const SENTENCE_GAP = /(?<=[.!?…][”’"'»)\]]*)\s+(?=\S)/gu;

function flatten(nodes: PoemNode[], italic = false, bold = false, out: PassagePiece[] = []): PassagePiece[] {
  for (const n of nodes) {
    if (typeof n === "string") out.push({ text: n, italic, bold });
    else flatten(n.children, italic || n.kind === "em", bold || n.kind === "strong", out);
  }
  return out;
}

function slicePieces(pieces: PassagePiece[], from: number, to: number): PassagePiece[] {
  const out: PassagePiece[] = [];
  let at = 0;
  for (const p of pieces) {
    const end = at + p.text.length;
    const a = Math.max(from, at);
    const b = Math.min(to, end);
    if (a < b) out.push({ ...p, text: p.text.slice(a - at, b - at) });
    at = end;
  }
  return out;
}

/** The chapter's paragraphs and their sentences, in reading order. */
export function passageParagraphs(body: string): PassageParagraph[] {
  const out: PassageParagraph[] = [];
  let pendingBreak = false;
  for (const block of parseProse(body)) {
    if (block.kind === "break") {
      pendingBreak = out.length > 0;
      continue;
    }
    // The paragraph's lines, joined by their kept line breaks.
    const pieces: PassagePiece[] = [];
    block.lines.forEach((line, i) => {
      if (i > 0) pieces.push({ text: "\n", italic: false, bold: false });
      pieces.push(...flatten(line));
    });
    const plain = pieces.map((p) => p.text).join("");
    const sentences: PassageSentence[] = [];
    let start = 0;
    let newLine = false;
    for (const gap of plain.matchAll(SENTENCE_GAP)) {
      const end = gap.index!;
      if (end > start) sentences.push({ text: plain.slice(start, end), pieces: slicePieces(pieces, start, end), newLine });
      newLine = gap[0].includes("\n");
      start = end + gap[0].length;
    }
    if (start < plain.length) sentences.push({ text: plain.slice(start), pieces: slicePieces(pieces, start, plain.length), newLine });
    if (sentences.length) out.push({ sentences, sceneBreakBefore: pendingBreak });
    pendingBreak = false;
  }
  return out;
}

/** What the sheet gets: each paragraph's sentences as plain text, and which paragraphs follow a scene break. */
export function passageOutline(paragraphs: PassageParagraph[]): { paragraphs: string[][]; breaks: number[] } {
  return {
    paragraphs: paragraphs.map((p) => p.sentences.map((s) => s.text)),
    breaks: paragraphs.flatMap((p, i) => (p.sceneBreakBefore ? [i + 1] : [])),
  };
}

export type PassagePick = { from: { p: number; s: number }; to: { p: number; s: number } };

/** The picked sentences, paragraph by paragraph: [paragraph number, first sentence, last sentence]. */
export function pickedRanges(pick: PassagePick, sentenceCounts: readonly number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let p = pick.from.p; p <= pick.to.p; p++) {
    const first = p === pick.from.p ? pick.from.s : 1;
    const last = p === pick.to.p ? pick.to.s : sentenceCounts[p - 1];
    out.push([p, first, last]);
  }
  return out;
}

const graphemes = (s: string) => splitGraphemes(s).length;

/** The pick's length in characters (see THE COUNT above). Both the sheet and the route use this. */
export function passageLength(paragraphs: readonly (readonly string[])[], pick: PassagePick): number {
  let chars = 0;
  let sentences = 0;
  for (const [p, first, last] of pickedRanges(pick, paragraphs.map((x) => x.length))) {
    for (let s = first; s <= last; s++) {
      chars += graphemes(paragraphs[p - 1][s - 1]);
      sentences++;
    }
  }
  return chars + Math.max(0, sentences - 1);
}

/** Whether the pick lies inside the chapter: paragraphs and sentences in range, in order, not empty. */
export function pickInRange(pick: PassagePick, sentenceCounts: readonly number[]): boolean {
  const { from, to } = pick;
  const ok = (x: { p: number; s: number }) =>
    Number.isInteger(x.p) && Number.isInteger(x.s) && x.p >= 1 && x.p <= sentenceCounts.length && x.s >= 1 && x.s <= sentenceCounts[x.p - 1];
  if (!ok(from) || !ok(to)) return false;
  return from.p < to.p || (from.p === to.p && from.s <= to.s);
}

/** The pick's one canonical string (see THE FORM above); "" if it isn't a pick inside the chapter. */
export function encodePassage(pick: PassagePick, sentenceCounts: readonly number[]): string {
  if (!pickInRange(pick, sentenceCounts)) return "";
  const { from, to } = pick;
  const lastOfTo = sentenceCounts[to.p - 1];
  if (from.p === to.p && from.s === 1 && to.s === lastOfTo) return `${from.p}`;
  const start = from.s > 1 ? `${from.p}.${from.s}` : `${from.p}`;
  const end = to.s < lastOfTo ? `${to.p}.${to.s}` : `${to.p}`;
  return `${start}-${end}`;
}

export type ParsedPassage =
  | { ok: true; pick: PassagePick; code: string; length: number }
  | { ok: false; reason: "form" | "range" | "too_long" | "not_canonical" };

/** Checks `raw` against the chapter: the canonical form of a pick of at most PASSAGE_MAX_CHARS, or a reason it isn't. */
export function parsePassage(raw: string, paragraphs: readonly (readonly string[])[]): ParsedPassage {
  if (raw.length === 0 || raw.length > MAX_FORM_LENGTH) return { ok: false, reason: "form" };
  const m = FORM.exec(raw);
  if (!m) return { ok: false, reason: "form" };
  const counts = paragraphs.map((p) => p.length);
  const a = Number(m[1]);
  const b = m[3] ? Number(m[3]) : a;
  const s = m[2] ? Number(m[2]) : 1;
  // No end sentence: through the end paragraph's last one (when it exists).
  const t = m[4] ? Number(m[4]) : (counts[b - 1] ?? 0);
  const pick: PassagePick = { from: { p: a, s }, to: { p: b, s: t } };
  if (!pickInRange(pick, counts)) return { ok: false, reason: "range" };
  const code = encodePassage(pick, counts);
  if (code !== raw) return { ok: false, reason: "not_canonical" };
  const length = passageLength(paragraphs, pick);
  if (length > PASSAGE_MAX_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, pick, code, length };
}
