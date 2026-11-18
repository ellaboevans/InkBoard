/*
 * "Share a passage" (docs/PLAN.md, Phase 25 round 3): the picture's layout
 * for a passage of a chapter, on the poems' frames (SHARE_FORMATS: story
 * 1080×1920 and chat 1080×1350 with their safe areas, the same 888 px
 * width), with the poems' footer (byline with the author's picture, InkBoard's
 * mark and the short address) and the same ShareImageLayout type, so the
 * poems' renderer, designs and tests draw it unchanged. Pure: it takes a
 * Measure like layout.ts.
 *
 * PROSE REFLOWS: a passage isn't verse, so its paragraphs wrap to the width
 * (no turnovers, no indents); a kept line break inside a paragraph (a letter,
 * a song) still starts a new row; paragraphs are set apart by a small gap and
 * a scene break inside the pick by a wider one; emphasis is kept, the drop
 * cap marker is already gone (parseProse).
 *
 * THE FITTING RULE:
 *   1. The whole passage at the largest of PASSAGE_SIZES (64 → 36 px) that
 *      fits. A few sentences get 56–64 px; it takes a passage near the
 *      600-character cap to go below 44. The floor is lower than the poems'
 *      48 px because a passage at the cap is about four times a short poem and
 *      reflows (a smaller size fits more words per row instead of breaking a
 *      poet's line): measured with the real fonts, 600 characters of ordinary
 *      prose need 36–38 px to fit a Status whole (12–13 CSS px on a 360 px
 *      phone, a paperback's size). A chat picture is shorter and may cut one,
 *      and so may a Status for a pick of many short paragraphs (dialogue),
 *      where every paragraph's last row is part empty.
 *   2. If it doesn't fit at 40 px, it is cut after the last whole sentence
 *      that fits, which ends with "…", and "Read the chapter on InkBoard"
 *      follows (the picture says so; the route reports the characters shown).
 *      The kept sentences then get the largest size that fits them. If even
 *      the first sentence doesn't fit, its first words that do, with "…".
 *
 * The header: the novel's title (64 → 52 px, at most three rows), and
 * "Chapter 4 · The Radio" under it (the chapter's own title when it has one).
 * No "A passage from" kicker as on a quote: it cost three rows of text, and
 * the chapter line already says where the words are from. Every text is set
 * with ogFontFamily's order, so Ghanaian letters and tone marks come from
 * Gentium Book Plus.
 */
import { needsExtendedFont, splitGraphemes } from "@/components/brand/og-type";
import {
  CONTENT_WIDTH,
  GAPS,
  SHARE_FORMATS,
  contentHeight,
  layoutFooter,
  layoutTitle,
  wrapText,
  plainStyle,
  type Measure,
  type Piece,
  type PlacedWord,
  type PoemRow,
  type ShareFormat,
  type ShareImageLayout,
  type TextStyle,
} from "./layout";

export const PASSAGE_SIZES = [64, 60, 56, 52, 48, 44, 40, 38, 36] as const;
export const PASSAGE_MIN_SIZE = PASSAGE_SIZES[PASSAGE_SIZES.length - 1];
export const PASSAGE_LINE_HEIGHT = 1.42;
/** Between two paragraphs, in rows: small, because dialogue is many short paragraphs. */
export const PARAGRAPH_GAP_ROWS = 0.3;
/** A scene break inside the pick, in rows: clearly more than a paragraph's. */
export const SCENE_GAP_ROWS = 0.9;
export const PASSAGE_TITLE_SIZES = [
  { size: 64, rows: 2 },
  { size: 56, rows: 2 },
  { size: 52, rows: 3 },
] as const;
/** "Chapter 4 · The Radio": one row, cut with "…" if it must be. */
export const PASSAGE_CHAPTER = { size: 38, lineHeight: 1.3 } as const;
export const PASSAGE_MORE_TEXT = "Read the chapter on InkBoard";

export type PassageInputSentence = { text: string; pieces: Piece[]; newLine: boolean };
export type PassageInputParagraph = { sentences: PassageInputSentence[]; sceneBreakBefore: boolean };

export type PassageImageInput = {
  novelTitle: string;
  /** "Chapter 4 · The Radio", or "Chapter 4". */
  chapterLine: string;
  /** The picked paragraphs, already trimmed to the picked sentences (src/lib/share-image/passage.ts). */
  paragraphs: PassageInputParagraph[];
  penName: string;
  language: string | null;
  host: string;
  /** /s/<code> */
  path: string;
};

type Sentence = PassageInputSentence;
type Paragraph = { sentences: Sentence[]; sceneBreakBefore: boolean };
type Laid = { rows: PoemRow[]; height: number };

/** Graphemes of the sentences, plus one for each join (passageLength's count). */
function characters(paragraphs: Paragraph[]): number {
  const sentences = paragraphs.flatMap((p) => p.sentences);
  return sentences.reduce((n, s) => n + splitGraphemes(s.text).length, 0) + Math.max(0, sentences.length - 1);
}

/** A paragraph as words (pieces with no space between), with the kept line breaks as forced row breaks. */
function paragraphWords(p: Paragraph): ({ pieces: Piece[] } | "break")[] {
  const out: ({ pieces: Piece[] } | "break")[] = [];
  let current: Piece[] | null = null;
  p.sentences.forEach((s, si) => {
    if (si > 0) {
      current = null;
      if (s.newLine) out.push("break");
    }
    for (const piece of s.pieces) {
      for (const part of piece.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          current = null;
          if (part.includes("\n")) out.push("break");
          continue;
        }
        if (current) current.push({ ...piece, text: part });
        else {
          current = [{ ...piece, text: part }];
          out.push({ pieces: current });
        }
      }
    }
  });
  return out;
}

function layParagraphs(paragraphs: Paragraph[], size: number, measure: Measure, extendedFirst: boolean): Laid {
  const rowHeight = size * PASSAGE_LINE_HEIGHT;
  const regular: TextStyle = { cut: "text", italic: false, bold: false, extendedFirst };
  const space = measure(" ", regular, size);
  const pieceWidth = (p: Piece) => measure(p.text, { ...regular, italic: p.italic, bold: p.bold }, size);
  const rows: PoemRow[] = [];
  let height = 0;
  paragraphs.forEach((para, pi) => {
    if (pi > 0) {
      const scene = para.sceneBreakBefore;
      rows.push({ kind: scene ? "scene" : "gap" });
      height += rowHeight * (scene ? SCENE_GAP_ROWS : PARAGRAPH_GAP_ROWS);
    }
    let row: { kind: "row"; indent: number; words: PlacedWord[] } = { kind: "row", indent: 0, words: [] };
    let x = 0;
    const newRow = () => {
      rows.push(row);
      height += rowHeight;
      row = { kind: "row", indent: 0, words: [] };
      x = 0;
    };
    for (const word of paragraphWords(para)) {
      if (word === "break") {
        if (row.words.length) newRow();
        continue;
      }
      const w = word.pieces.reduce((n, p) => n + pieceWidth(p), 0);
      const gap = row.words.length ? space : 0;
      if (x + gap + w <= CONTENT_WIDTH) {
        row.words.push({ pieces: word.pieces, gap });
        x += gap + w;
        continue;
      }
      if (row.words.length) newRow();
      if (w <= CONTENT_WIDTH) {
        row.words.push({ pieces: word.pieces, gap: 0 });
        x = w;
        continue;
      }
      // A word wider than the picture: break it between letters, never inside one.
      let pieces: Piece[] = [];
      for (const p of word.pieces) {
        for (const g of splitGraphemes(p.text)) {
          const gw = pieceWidth({ ...p, text: g });
          if (x + gw > CONTENT_WIDTH && pieces.length) {
            row.words.push({ pieces, gap: 0 });
            pieces = [];
            newRow();
          }
          const last = pieces[pieces.length - 1];
          if (last && last.italic === p.italic && last.bold === p.bold) last.text += g;
          else pieces.push({ ...p, text: g });
          x += gw;
        }
      }
      if (pieces.length) row.words.push({ pieces, gap: 0 });
    }
    if (row.words.length) {
      rows.push(row);
      height += rowHeight;
    }
  });
  return { rows, height };
}

/** Rule 1: the largest size that fits `budget`, or null. */
function bestSize(paragraphs: Paragraph[], budget: number, measure: Measure, extendedFirst: boolean) {
  for (const size of PASSAGE_SIZES) {
    const laid = layParagraphs(paragraphs, size, measure, extendedFirst);
    if (laid.height <= budget) return { size, laid };
  }
  return null;
}

/** The first `n` sentences of the passage, in their paragraphs. */
function firstSentences(paragraphs: Paragraph[], n: number): Paragraph[] {
  const out: Paragraph[] = [];
  let left = n;
  for (const p of paragraphs) {
    if (left <= 0) break;
    out.push({ ...p, sentences: p.sentences.slice(0, left) });
    left -= p.sentences.length;
  }
  return out;
}

/** The last sentence ends with "…" (after any closing punctuation's stop is dropped). */
function withEllipsis(paragraphs: Paragraph[]): Paragraph[] {
  const copy = paragraphs.map((p) => ({ ...p, sentences: p.sentences.map((s) => ({ ...s, pieces: s.pieces.map((x) => ({ ...x })) })) }));
  const para = copy[copy.length - 1];
  const sentence = para.sentences[para.sentences.length - 1];
  const piece = sentence.pieces[sentence.pieces.length - 1];
  piece.text = `${piece.text.replace(/[\s,;:]+$/, "")} …`;
  sentence.text = `${sentence.text} …`;
  return copy;
}

/** Rule 2: the most whole sentences from the start that fit with "…"; else the first sentence's first words. */
function cut(paragraphs: Paragraph[], budget: number, measure: Measure, extendedFirst: boolean): Paragraph[] {
  const total = paragraphs.reduce((n, p) => n + p.sentences.length, 0);
  const fits = (ps: Paragraph[]) => layParagraphs(ps, PASSAGE_MIN_SIZE, measure, extendedFirst).height <= budget;
  // Heights grow with every sentence added, so search for the longest prefix that fits.
  let lo = 0;
  let hi = total - 1; // the whole passage didn't fit
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(withEllipsis(firstSentences(paragraphs, mid)))) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 0) return withEllipsis(firstSentences(paragraphs, lo));
  // Not even one sentence: its first words.
  const first = paragraphs[0].sentences[0];
  const words = first.text.split(/\s+/).filter(Boolean);
  for (let k = words.length - 1; k >= 1; k--) {
    const shorter = shortened(first, k);
    const ps = withEllipsis([{ sceneBreakBefore: false, sentences: [shorter] }]);
    if (fits(ps)) return ps;
  }
  return withEllipsis([{ sceneBreakBefore: false, sentences: [shortened(first, 1)] }]);
}

/** A sentence's first `words` words, keeping their emphasis. */
function shortened(s: Sentence, words: number): Sentence {
  const pieces: Piece[] = [];
  let seen = 0;
  let inWord = false;
  outer: for (const p of s.pieces) {
    let text = "";
    for (const part of p.text.split(/(\s+)/)) {
      if (!part) continue;
      const blank = /^\s+$/.test(part);
      if (!blank && !inWord) {
        if (seen === words) {
          if (text) pieces.push({ ...p, text: text.trimEnd() });
          break outer;
        }
        seen++;
      }
      inWord = !blank;
      text += part;
    }
    if (text) pieces.push({ ...p, text });
  }
  return { ...s, text: pieces.map((p) => p.text).join(""), pieces };
}

export function layoutPassageImage(input: PassageImageInput, measure: Measure, options: { format?: ShareFormat } = {}): ShareImageLayout {
  const format = options.format ?? "story";
  const title = layoutTitle(input.novelTitle, PASSAGE_TITLE_SIZES, measure);
  const chapterExtended = needsExtendedFont(input.chapterLine);
  const subtitleRows = wrapText(input.chapterLine, {
    maxWidth: CONTENT_WIDTH,
    maxRows: 1,
    width: (s) => measure(s, plainStyle("display", chapterExtended), PASSAGE_CHAPTER.size),
  }).rows;
  const subtitle = {
    size: PASSAGE_CHAPTER.size,
    lineHeight: PASSAGE_CHAPTER.size * PASSAGE_CHAPTER.lineHeight,
    rows: subtitleRows,
    extendedFirst: chapterExtended,
  };
  const { byline, address, height: footerHeight } = layoutFooter(input, measure);
  const headerHeight = title.rows.length * title.lineHeight + GAPS.titleToSubtitle + subtitle.rows.length * subtitle.lineHeight;
  const fixed = headerHeight + GAPS.titleToRule + GAPS.rule + GAPS.ruleToPoem + GAPS.beforeFooter + footerHeight;
  const moreHeight = GAPS.poemToMore + GAPS.more * GAPS.moreLineHeight;
  const budget = contentHeight(format) - fixed;

  // The passage begins its own picture: a scene break before its first paragraph isn't inside it.
  const paragraphs: Paragraph[] = input.paragraphs
    .filter((p) => p.sentences.length > 0)
    .map((p, i) => ({ sentences: p.sentences, sceneBreakBefore: i > 0 && p.sceneBreakBefore }));
  const extendedFirst = needsExtendedFont(paragraphs.flatMap((p) => p.sentences.map((s) => s.text)).join(" "));

  let shown = paragraphs;
  let best = bestSize(paragraphs, budget, measure, extendedFirst);
  let truncated = false;
  if (!best) {
    shown = cut(paragraphs, budget - moreHeight, measure, extendedFirst);
    best = bestSize(shown, budget - moreHeight, measure, extendedFirst) ?? {
      size: PASSAGE_MIN_SIZE,
      laid: layParagraphs(shown, PASSAGE_MIN_SIZE, measure, extendedFirst),
    };
    truncated = true;
  }
  const rowHeight = best.size * PASSAGE_LINE_HEIGHT;
  // The "…" a cut adds isn't the writer's: count only their characters as shown.
  const shownChars = truncated ? characters(shown) - 2 : characters(shown);
  return {
    format,
    frame: SHARE_FORMATS[format],
    quote: null,
    passage: { picked: characters(paragraphs), shown: Math.max(0, shownChars) },
    kicker: null,
    title,
    subtitle,
    more: truncated ? PASSAGE_MORE_TEXT : null,
    poem: {
      size: best.size,
      rowHeight,
      gapHeight: rowHeight * PARAGRAPH_GAP_ROWS,
      breakHeight: rowHeight * SCENE_GAP_ROWS,
      rows: best.laid.rows,
      extendedFirst,
      truncated,
      wrappedLines: 0,
      shownLines: shown.length,
      height: best.laid.height,
    },
    byline,
    address,
    height: fixed + best.laid.height + (truncated ? moreHeight : 0),
  };
}
