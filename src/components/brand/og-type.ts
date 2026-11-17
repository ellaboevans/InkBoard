/*
 * Which font comes first for a piece of text in Satori (next/og): the share
 * cards (og-card.tsx) and the share image (share-image.tsx). Pure, so tests
 * can check it against the font files (tests/lib/og-font-order.test.ts).
 *
 * Satori (0.29, bundled by next/og) takes each character from the first font
 * in the list that has it, and has no mark positioning across fonts. With
 * Newsreader first, "ɛ́" got its ɛ from Gentium and its tone mark from
 * Newsreader, so the mark landed beside the letter; and Newsreader's ƒ is a
 * florin sign, not the Ewe letter. So text that has anything beyond what
 * Newsreader draws well is set in Gentium Book Plus first, which has every
 * letter and mark InkBoard needs (docs/research/share-image.md, "Tone marks").
 * English (and any text within Newsreader's safe set) keeps Newsreader.
 */

/**
 * Characters Newsreader draws correctly by itself: ASCII, Latin-1, Latin
 * Extended-A (without the four it lacks: Ĳ ĳ ŉ ſ) and the typographic
 * punctuation poems use. Anything else (ƒ Ɛ ɔ ɖ ŋ́, combining tone marks, IPA,
 * Greek, Latin Extended-B and Additional…) puts Gentium first. A test checks
 * every character here against Newsreader's cmap.
 */
const NEWSREADER_SAFE =
  /^[\t\n\r\u0020-\u007E\u00A0-\u0131\u0134-\u0148\u014A-\u017E\u2013\u2014\u2018-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2030\u2032\u2033\u2039\u203A\u2044\u20AC\u2122]*$/;

/** True when Satori must set this text in Gentium Book Plus first. */
export function needsExtendedFont(text: string): boolean {
  return !NEWSREADER_SAFE.test(text);
}

/** Font names as registered with ImageResponse (og-fonts.ts). */
export const OG_FONT = {
  /** Newsreader's 72pt (display) cut: share-card text, the share image's title and byline. */
  display: "Newsreader",
  /** Newsreader's 16pt (text) cut: the share image's poem lines, like the reading page's optical size. */
  text: "Newsreader Text",
  /** Every Ghanaian letter, tone mark and IPA symbol. */
  extended: "Gentium Book Plus",
} as const;

/**
 * The `fontFamily` for a piece of text: Gentium first when the text needs it,
 * otherwise Newsreader (with Gentium after it, for safety).
 */
export function ogFontFamily(text: string, cut: "display" | "text" = "display"): string {
  return fontFamilyList(needsExtendedFont(text), cut);
}

/** The same list, when the choice was already made (the share image decides once per block). */
export function fontFamilyList(extendedFirst: boolean, cut: "display" | "text" = "display"): string {
  return extendedFirst ? `${OG_FONT.extended}, ${OG_FONT[cut]}` : `${OG_FONT[cut]}, ${OG_FONT.extended}`;
}

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Grapheme clusters: a letter and its combining tone marks stay together. */
export function splitGraphemes(text: string): string[] {
  return Array.from(graphemes.segment(text), (s) => s.segment);
}

/** `s` cut to at most `max` letters, with "…", never splitting a letter from its tone mark. */
export function truncate(s: string, max: number) {
  const g = splitGraphemes(s);
  return g.length > max ? `${g.slice(0, max - 1).join("").trimEnd()}…` : s;
}
