/*
 * The share image's layout (docs/PLAN.md, Phase 21): what goes where on the
 * "Page", at 1080×1920 (Status or Story) or 1080×1350 (chat, 4:5), and at
 * what size. Pure: it takes a Measure (the server's
 * reads the real font files, see src/server/share-image.ts; tests can pass a
 * fake one), so every rule here is tested without Satori.
 *
 * Everything is measured and broken into rows here, and each row is drawn
 * with whiteSpace "pre" (no wrapping by Satori), so the picture can never
 * outgrow the safe area: its height is the sum of heights computed below.
 *
 * THE FITTING RULE (poem lines):
 *   1. The whole poem at the largest size in POEM_SIZES (84 → 48 px) that
 *      fits, among the sizes that wrap as few of the poet's lines as the
 *      smallest size would. A poem's line breaks are the poet's, so the type
 *      shrinks before a line wraps; a line too long even at 48 px wraps, with
 *      its continuation rows indented (a turnover).
 *   2. If the poem doesn't fit at 48 px, it is cut: from the start up to the
 *      last stanza break (blank line) that fits, then "Read the whole poem on
 *      InkBoard". The kept stanzas then get the largest size that fits them
 *      (rule 1 again). If even the first stanza doesn't fit, whole lines from
 *      the start, ending on a line that ends a sentence when one is near; a
 *      single line too long for the image ends with "…".
 *   3. Picked lines (round 2, src/lib/share-image/selection.ts) are a quote:
 *      headed "Lines from", with no "Read the whole poem" line. The same rule 1
 *      sizes them; "…" stands where skipped lines were. If they can't all fit
 *      even at 48 px, rule 2 cuts them and a final "…" says so (the route
 *      reports how many were shown, and the sheet tells the reader).
 *
 * Both formats share the width (888 px between 96 px margins), so a line
 * breaks the same way in each; only the height differs, and with it how much
 * fits before rule 2 cuts.
 */
import { parsePoemLine, type PoemNode } from "@/lib/poem-markdown";
import { needsExtendedFont, splitGraphemes } from "@/components/brand/og-type";
import { SITE_NAME } from "@/lib/site";
import { pickedItems, poemLines } from "./selection";

export type ShareFrame = { width: number; height: number; safeTop: number; safeBottom: number; side: number };

/** The two pictures (docs/research/share-image.md, section 1). */
export const SHARE_FORMATS = {
  /** 9:16 for WhatsApp Status and Stories, clear of the apps' own bars. */
  story: {
    width: 1080,
    height: 1920,
    /** Progress bars, name and time across the top (≈250 px in the guides). */
    safeTop: 260,
    /** Reply bar and caption across the bottom (≈250–400 px in the guides; the cautious end). */
    safeBottom: 400,
    side: 96,
  },
  /**
   * 4:5 for a chat or a feed: no app bars sit on it, so only a margin, the
   * same 96 px as the sides (the poem gets the same width as on a Status).
   */
  chat: { width: 1080, height: 1350, safeTop: 96, safeBottom: 96, side: 96 },
} as const satisfies Record<string, ShareFrame>;

export type ShareFormat = keyof typeof SHARE_FORMATS;
export const SHARE_FORMAT_NAMES = Object.keys(SHARE_FORMATS) as ShareFormat[];

/** The 9:16 frame (Phase 21's only one). */
export const SHARE_FRAME = SHARE_FORMATS.story;

export const CONTENT_WIDTH = SHARE_FRAME.width - 2 * SHARE_FRAME.side; // 888, both formats
/** Height inside the safe area: 1260 (story) or 1158 (chat). */
export const contentHeight = (format: ShareFormat) => {
  const f: ShareFrame = SHARE_FORMATS[format];
  return f.height - f.safeTop - f.safeBottom;
};
export const CONTENT_HEIGHT = contentHeight("story"); // 1260

/**
 * Poem sizes, largest first: 84 px is about 28–31 CSS px when the image fills
 * a phone's width (360–400 px), so a short poem reads large on a Status. 48 px is the floor: 16 CSS px on a 360 px
 * phone (common in Ghana), the size of comfortable body text.
 */
export const POEM_SIZES = [84, 78, 72, 68, 64, 60, 56, 52, 48] as const;
export const POEM_MIN_SIZE = POEM_SIZES[POEM_SIZES.length - 1];
export const POEM_LINE_HEIGHT = 1.4;
/** A blank line (stanza break) is this many rows high. */
export const STANZA_GAP_ROWS = 0.8;
/** Continuation rows of a wrapped line start this many em further in. */
export const TURNOVER_EM = 1;
/** Indentation never takes more than this share of the width. */
const MAX_INDENT = 0.35;
const TAB_SPACES = 4;

/** Title: 84 px on up to two rows, else 72 px on up to three, else 64 px cut at three rows with "…". */
export const TITLE_SIZES = [
  { size: 84, rows: 2 },
  { size: 72, rows: 3 },
  { size: 64, rows: 3 },
] as const;
export const TITLE_LINE_HEIGHT = 1.14;

/** Fixed parts, in px. */
export const GAPS = {
  titleToRule: 40,
  rule: 6,
  ruleToPoem: 48,
  poemToMore: 40,
  more: 40,
  moreLineHeight: 1.3,
  /** At least this much between the poem and the byline. */
  beforeFooter: 64,
  footerGap: 40,
  divider: 2,
  /** "Lines from", above the title of a quote. */
  linesFrom: 40,
  linesFromLineHeight: 1.3,
  linesFromToTitle: 12,
} as const;

/** Byline and address: no smaller than 32 px (about 11 CSS px on a phone), so the address can be read and typed. */
export const BYLINE = { avatar: 96, name: 46, nameLineHeight: 1.2, language: 32, languageLineHeight: 1.3, gap: 26 } as const;
export const ADDRESS = { logo: 72, gap: 24, host: 36, hostLineHeight: 1.25, path: 34, pathLineHeight: 1.3, pathRows: 3 } as const;

export const MORE_TEXT = "Read the whole poem on InkBoard";
export const LINES_FROM_TEXT = "Lines from";
export const OMISSION_TEXT = "…";

export type TextStyle = {
  /** Newsreader's display (72pt) or text (16pt) cut; Gentium has one. */
  cut: "display" | "text";
  italic: boolean;
  bold: boolean;
  /** Gentium Book Plus first (og-type.ts). */
  extendedFirst: boolean;
};
/** Width in px of `text` in `style` at `fontSize`. */
export type Measure = (text: string, style: TextStyle, fontSize: number) => number;

export type Piece = { text: string; italic: boolean; bold: boolean };
/** A word (one or more styled pieces with no space between) and the space before it, in px. */
export type PlacedWord = { pieces: Piece[]; gap: number };
/** A row of words, a stanza break, or "…" where a quote skips lines. */
export type PoemRow = { kind: "row"; indent: number; words: PlacedWord[] } | { kind: "gap" } | { kind: "omission" };

export type ShareImageInput = {
  title: string;
  /** The public poem's text, light Markdown (src/lib/poem-markdown.ts). */
  body: string;
  penName: string;
  /** "Ewe", or null for an untagged poem. */
  language: string | null;
  /** tryinkboard.elabo.me */
  host: string;
  /** /p/<author>/<poem> */
  path: string;
};

export type ShareImageOptions = {
  format?: ShareFormat;
  /** Picked line numbers (selection.ts), already validated; absent = the whole poem. */
  picked?: readonly number[];
};

export type ShareImageLayout = {
  format: ShareFormat;
  frame: ShareFrame;
  /** Picked lines: how many were picked and how many fit (rule 3); null for the whole poem. */
  quote: { picked: number; shown: number } | null;
  title: { size: number; lineHeight: number; rows: string[]; extendedFirst: boolean };
  poem: {
    size: number;
    rowHeight: number;
    gapHeight: number;
    rows: PoemRow[];
    extendedFirst: boolean;
    /** Not the whole poem: "Read the whole poem on InkBoard" follows. */
    truncated: boolean;
    /** How many of the poet's lines wrap onto a second row. */
    wrappedLines: number;
    /** How many of the poem's lines are shown (blank lines included). */
    shownLines: number;
    height: number;
  };
  byline: { penName: string; language: string | null; extendedFirst: boolean; height: number };
  /** "InkBoard · host" on one row, then the path on at most three. */
  address: { host: string; hostExtended: boolean; pathRows: string[]; pathExtended: boolean; height: number };
  /** The sum of every block's height and gap; never more than the format's content height. */
  height: number;
};

// ---- small helpers ------------------------------------------------------------

const plainStyle = (cut: TextStyle["cut"], extendedFirst: boolean): TextStyle => ({
  cut,
  italic: false,
  bold: false,
  extendedFirst,
});

/** Greedy rows of `tokens` (joined with `joiner`), breaking a token too long for a row by letters. */
function fillRows(tokens: string[], joiner: string, maxWidth: number, width: (s: string) => number): string[] {
  const rows: string[] = [];
  let row = "";
  const place = (token: string) => {
    const next = row ? row + joiner + token : token;
    if (width(next) <= maxWidth) {
      row = next;
      return;
    }
    if (row) rows.push(row);
    row = "";
    if (width(token) <= maxWidth) {
      row = token;
      return;
    }
    for (const g of splitGraphemes(token)) {
      if (row && width(row + g) > maxWidth) {
        rows.push(row);
        row = "";
      }
      row += g;
    }
  };
  for (const t of tokens) place(t);
  if (row) rows.push(row);
  return rows;
}

/** `row` shortened until `row…` fits, at a word boundary when there is one in its second half. */
function ellipsize(row: string, maxWidth: number, width: (s: string) => number): string {
  const g = splitGraphemes(row);
  const full = g.length;
  while (g.length > 0 && width(`${g.join("").trimEnd()}…`) > maxWidth) g.pop();
  let kept = g.join("");
  const midWord = g.length < full && !/\s/.test(splitGraphemes(row)[g.length] ?? " ") && !/\s$/.test(kept);
  const lastSpace = kept.lastIndexOf(" ");
  if (midWord && lastSpace > kept.length / 2) kept = kept.slice(0, lastSpace);
  return `${kept.trimEnd().replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** Rows of `text` at most `maxRows` long; the last kept row ends with "…" if anything was cut. */
export function wrapText(
  text: string,
  { maxWidth, maxRows, width, breakAfter }: { maxWidth: number; maxRows: number; width: (s: string) => number; breakAfter?: RegExp },
): { rows: string[]; truncated: boolean } {
  const tokens = breakAfter ? text.split(breakAfter).filter(Boolean) : text.split(/\s+/).filter(Boolean);
  const rows = fillRows(tokens, breakAfter ? "" : " ", maxWidth, width);
  if (rows.length <= maxRows) return { rows, truncated: false };
  const kept = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows - 1).join(breakAfter ? "" : " ");
  kept[maxRows - 1] = ellipsize(rest, maxWidth, width);
  return { rows: kept, truncated: true };
}

// ---- the poem -----------------------------------------------------------------

type SourceWord = { pieces: Piece[]; space: string };
type SourceLine =
  | { blank: true; omission?: boolean }
  | { blank: false; indentSpaces: number; words: SourceWord[]; text: string };

const OMISSION: SourceLine = { blank: true, omission: true };

function flatten(nodes: PoemNode[], italic = false, bold = false, out: Piece[] = []): Piece[] {
  for (const n of nodes) {
    if (typeof n === "string") out.push({ text: n, italic, bold });
    else flatten(n.children, italic || n.kind === "em", bold || n.kind === "strong", out);
  }
  return out;
}

/** One poem line → its indentation and words, each word's pieces keeping their emphasis. */
function sourceLine(line: string): SourceLine {
  if (!line.trim()) return { blank: true };
  const lead = /^[ \t\u00A0\u3000]*/.exec(line)![0];
  const indentSpaces = [...lead].reduce((n, c) => n + (c === "\t" ? TAB_SPACES : 1), 0);
  const content = line.slice(lead.length).trimEnd();
  const words: SourceWord[] = [];
  let pending = "";
  let current: Piece[] | null = null;
  for (const piece of flatten(parsePoemLine(content))) {
    for (const part of piece.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        current = null;
        pending += part.replace(/\t/g, " ".repeat(TAB_SPACES));
        continue;
      }
      if (current) {
        current.push({ ...piece, text: part });
      } else {
        current = [{ ...piece, text: part }];
        words.push({ pieces: current, space: words.length ? pending : "" });
        pending = "";
      }
    }
  }
  return { blank: false, indentSpaces, words, text: content };
}

/** The poem's lines, without leading or trailing blank lines. */
function sourceLines(body: string): SourceLine[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n").map(sourceLine);
  while (lines.length && lines[0].blank) lines.shift();
  while (lines.length && lines[lines.length - 1].blank) lines.pop();
  return lines;
}

type Laid = { rows: PoemRow[]; height: number; wrapped: number };

function layLines(lines: SourceLine[], size: number, measure: Measure, extendedFirst: boolean): Laid {
  const rowHeight = size * POEM_LINE_HEIGHT;
  const regular: TextStyle = { cut: "text", italic: false, bold: false, extendedFirst };
  const spaceWidth = measure(" ", regular, size);
  const pieceWidth = (p: Piece) => measure(p.text, { ...regular, italic: p.italic, bold: p.bold }, size);
  const wordWidth = (pieces: Piece[]) => pieces.reduce((w, p) => w + pieceWidth(p), 0);

  const rows: PoemRow[] = [];
  let height = 0;
  let wrapped = 0;
  for (const line of lines) {
    if (line.blank) {
      rows.push({ kind: line.omission ? "omission" : "gap" });
      height += rowHeight * STANZA_GAP_ROWS;
      continue;
    }
    const indent = Math.min(line.indentSpaces * spaceWidth, CONTENT_WIDTH * MAX_INDENT);
    const turnover = Math.min(indent + size * TURNOVER_EM, CONTENT_WIDTH * MAX_INDENT);
    let row: { kind: "row"; indent: number; words: PlacedWord[] } = { kind: "row", indent, words: [] };
    let x = indent;
    let rowsOfLine = 1;
    const newRow = () => {
      rows.push(row);
      row = { kind: "row", indent: turnover, words: [] };
      x = turnover;
      rowsOfLine++;
    };
    for (const word of line.words) {
      const gap = row.words.length ? measure(word.space, regular, size) : 0;
      const w = wordWidth(word.pieces);
      if (x + gap + w <= CONTENT_WIDTH) {
        row.words.push({ pieces: word.pieces, gap });
        x += gap + w;
        continue;
      }
      if (row.words.length) newRow();
      if (x + w <= CONTENT_WIDTH) {
        row.words.push({ pieces: word.pieces, gap: 0 });
        x += w;
        continue;
      }
      // A word longer than a row: break it between letters (never inside one).
      let pieces: Piece[] = [];
      const flush = () => {
        if (pieces.length) row.words.push({ pieces, gap: 0 });
        pieces = [];
      };
      for (const p of word.pieces) {
        for (const g of splitGraphemes(p.text)) {
          const gw = pieceWidth({ ...p, text: g });
          if (x + gw > CONTENT_WIDTH && (pieces.length || row.words.length)) {
            flush();
            newRow();
          }
          const last = pieces[pieces.length - 1];
          if (last && last.italic === p.italic && last.bold === p.bold) last.text += g;
          else pieces.push({ ...p, text: g });
          x += gw;
        }
      }
      flush();
    }
    rows.push(row);
    avoidLoneWord(rows, rowsOfLine, line, measure, regular, size, wordWidth);
    height += rowsOfLine * rowHeight;
    if (rowsOfLine > 1) wrapped++;
  }
  return { rows, height, wrapped };
}

/**
 * A turnover holding one word ("sand,") reads like a stray line: take one
 * more word down from the row above when that row keeps at least two and the
 * turnover still fits.
 */
function avoidLoneWord(
  rows: PoemRow[],
  rowsOfLine: number,
  line: Extract<SourceLine, { blank: false }>,
  measure: Measure,
  regular: TextStyle,
  size: number,
  wordWidth: (pieces: Piece[]) => number,
) {
  if (rowsOfLine < 2) return;
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  if (last.kind !== "row" || before.kind !== "row" || last.words.length !== 1 || before.words.length < 3) return;
  const moved = before.words[before.words.length - 1];
  const lone = last.words[0];
  // The space that stood before the lone word in the poem.
  const sourceWord = line.words.find((w) => w.pieces === lone.pieces);
  const gap = sourceWord ? measure(sourceWord.space, regular, size) : measure(" ", regular, size);
  if (last.indent + wordWidth(moved.pieces) + gap + wordWidth(lone.pieces) > CONTENT_WIDTH) return;
  before.words.pop();
  last.words = [{ pieces: moved.pieces, gap: 0 }, { pieces: lone.pieces, gap }];
}

/** Rule 1: the largest size that fits, among those wrapping as few lines as the smallest size. */
function bestSize(lines: SourceLine[], budget: number, measure: Measure, extendedFirst: boolean) {
  const fitting = POEM_SIZES.map((size) => ({ size, laid: layLines(lines, size, measure, extendedFirst) })).filter(
    (c) => c.laid.height <= budget,
  );
  if (!fitting.length) return null;
  const fewest = Math.min(...fitting.map((c) => c.laid.wrapped));
  return fitting.find((c) => c.laid.wrapped === fewest)!;
}

const ENDS_SENTENCE = /[.!?;:…—–"”’)]$/;

/** Rule 2: what to keep when the whole poem doesn't fit at the smallest size. */
function cut(lines: SourceLine[], budget: number, measure: Measure, extendedFirst: boolean): SourceLine[] {
  // Lines are laid out independently, so a prefix's height is a running sum.
  const heights = lines.map((l) => layLines([l], POEM_MIN_SIZE, measure, extendedFirst).height);
  let fitting = 0; // how many lines from the start fit
  for (let total = 0; fitting < lines.length && total + heights[fitting] <= budget; fitting++) total += heights[fitting];
  // Up to the last stanza break that fits.
  for (let i = fitting; i > 0; i--) {
    if (i < lines.length && lines[i].blank && !lines[i - 1].blank) return lines.slice(0, i);
  }
  // The first stanza alone is too long: whole lines, ending a sentence if one is near.
  let n = fitting;
  while (n > 0 && lines[n - 1].blank) n--;
  if (n > 0) {
    for (let k = n; k >= Math.ceil(n * 0.6); k--) {
      const l = lines[k - 1];
      if (!l.blank && ENDS_SENTENCE.test(l.text)) return lines.slice(0, k);
    }
    return lines.slice(0, n);
  }
  // Not even the first line fits: keep its first words, ending with "…".
  const first = lines[0];
  if (!first || first.blank) return [];
  const fits = (l: SourceLine) => layLines([l], POEM_MIN_SIZE, measure, extendedFirst).height <= budget;
  const words = [...first.words];
  while (words.length > 1) {
    words.pop();
    const shortened = withEllipsis({ ...first, words });
    if (fits(shortened)) return [shortened];
  }
  return [withEllipsis({ ...first, words: words.slice(0, 1) })];
}

function withEllipsis(line: Extract<SourceLine, { blank: false }>): SourceLine {
  const words = line.words.map((w) => ({ ...w, pieces: w.pieces.map((p) => ({ ...p })) }));
  const last = words[words.length - 1];
  const piece = last.pieces[last.pieces.length - 1];
  piece.text = `${piece.text.replace(/[,;:.\-–—]+$/, "")}…`;
  return { ...line, words };
}

// ---- the whole page -------------------------------------------------------------

export function layoutShareImage(input: ShareImageInput, measure: Measure, options: ShareImageOptions = {}): ShareImageLayout {
  const format = options.format ?? "story";
  const picked = options.picked ?? null;
  // Title.
  const titleExtended = needsExtendedFont(input.title);
  const titleStyle = plainStyle("display", titleExtended);
  let title: ShareImageLayout["title"] | null = null;
  for (const t of TITLE_SIZES) {
    const width = (s: string) => measure(s, titleStyle, t.size);
    const wrapped = wrapText(input.title.trim(), { maxWidth: CONTENT_WIDTH, maxRows: t.rows, width });
    const last = t === TITLE_SIZES[TITLE_SIZES.length - 1];
    if (!wrapped.truncated || last) {
      title = { size: t.size, lineHeight: t.size * TITLE_LINE_HEIGHT, rows: wrapped.rows, extendedFirst: titleExtended };
      break;
    }
  }
  const titleHeight = title!.rows.length * title!.lineHeight;

  // Byline: avatar, pen name on one row (cut with "…" if it must be), language.
  const nameExtended = needsExtendedFont(input.penName);
  const nameWidth = CONTENT_WIDTH - BYLINE.avatar - BYLINE.gap;
  const nameRows = wrapText(input.penName.trim(), {
    maxWidth: nameWidth,
    maxRows: 1,
    width: (s) => measure(s, plainStyle("display", nameExtended), BYLINE.name),
  }).rows;
  const bylineText = BYLINE.name * BYLINE.nameLineHeight + (input.language ? BYLINE.language * BYLINE.languageLineHeight : 0);
  const byline = {
    penName: nameRows[0] ?? "",
    language: input.language,
    extendedFirst: nameExtended,
    height: Math.max(BYLINE.avatar, bylineText),
  };

  // Address: the host on one row; the path wraps after "/" and "-" (never off the image).
  const addressWidth = CONTENT_WIDTH - ADDRESS.logo - ADDRESS.gap;
  const pathExtended = needsExtendedFont(input.path);
  const pathStyle = plainStyle("display", pathExtended);
  const pathRows = wrapText(input.path, {
    maxWidth: addressWidth,
    maxRows: ADDRESS.pathRows,
    width: (s) => measure(s, pathStyle, ADDRESS.path),
    breakAfter: /(?<=[/-])/,
  }).rows;
  const hostLine = `${SITE_NAME} · ${input.host}`;
  const hostExtended = needsExtendedFont(hostLine);
  const hostStyle = plainStyle("display", hostExtended);
  const host = wrapText(hostLine, {
    maxWidth: addressWidth,
    maxRows: 1,
    width: (s) => measure(s, hostStyle, ADDRESS.host),
    breakAfter: /(?<=[.])/,
  }).rows[0];
  const address = {
    host,
    hostExtended,
    pathRows,
    pathExtended,
    height: Math.max(ADDRESS.logo, ADDRESS.host * ADDRESS.hostLineHeight + pathRows.length * ADDRESS.path * ADDRESS.pathLineHeight),
  };

  const footerHeight = byline.height + GAPS.footerGap + GAPS.divider + GAPS.footerGap + address.height;
  const linesFromHeight = picked ? GAPS.linesFrom * GAPS.linesFromLineHeight + GAPS.linesFromToTitle : 0;
  const fixed = linesFromHeight + titleHeight + GAPS.titleToRule + GAPS.rule + GAPS.ruleToPoem + GAPS.beforeFooter + footerHeight;
  const moreHeight = GAPS.poemToMore + GAPS.more * GAPS.moreLineHeight;
  const budget = contentHeight(format) - fixed;

  // The poem, or the picked lines (rule 3).
  const poemExtended = needsExtendedFont(input.body);
  const lines = picked
    ? pickedItems(poemLines(input.body), picked).map((it) => (it.kind === "omission" ? OMISSION : sourceLine(it.text)))
    : sourceLines(input.body);
  let shown = lines;
  let best = bestSize(lines, budget, measure, poemExtended);
  let truncated = false;
  let extra = 0;
  if (!best) {
    // A cut quote ends with "…" (one stanza gap high); a cut poem with "Read the whole poem".
    const ending = picked ? POEM_MIN_SIZE * POEM_LINE_HEIGHT * STANZA_GAP_ROWS : moreHeight;
    const kept = cut(lines, budget - ending, measure, poemExtended);
    shown = picked ? [...kept, OMISSION] : kept;
    best = bestSize(shown, budget - (picked ? 0 : moreHeight), measure, poemExtended) ?? {
      size: POEM_MIN_SIZE,
      laid: layLines(shown, POEM_MIN_SIZE, measure, poemExtended),
    };
    truncated = !picked;
    extra = picked ? 0 : moreHeight;
  }
  const countLines = (ls: SourceLine[]) => ls.filter((l) => !l.blank).length;
  const poem = {
    size: best.size,
    rowHeight: best.size * POEM_LINE_HEIGHT,
    gapHeight: best.size * POEM_LINE_HEIGHT * STANZA_GAP_ROWS,
    rows: best.laid.rows,
    extendedFirst: poemExtended,
    truncated,
    wrappedLines: best.laid.wrapped,
    shownLines: shown.length,
    height: best.laid.height,
  };

  return {
    format,
    frame: SHARE_FORMATS[format],
    quote: picked ? { picked: countLines(lines), shown: countLines(shown) } : null,
    title: title!,
    poem,
    byline,
    address,
    height: fixed + poem.height + extra,
  };
}
