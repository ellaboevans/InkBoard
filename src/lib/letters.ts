/**
 * Letters beyond A–Z: Ghanaian languages (Ewe, Twi/Akan, Nzema, Ga) and IPA
 * (docs/PLAN.md, Phase 11). Shared by the server and the editor.
 */

/**
 * One stored form for text people type. A tone-marked vowel can arrive
 * precomposed (é) or as a letter plus a combining mark (e + U+0301),
 * depending on the keyboard; NFC makes them the same string, so search,
 * slugs and length limits agree. Letters with no precomposed form (ɔ̃, ɛ́)
 * stay as letter + mark, which is correct.
 */
export function toNfc(value: string): string {
  return value.normalize("NFC");
}

/**
 * Letters that Unicode decomposition can't reduce to ASCII, with the plain
 * Latin spelling a reader would type in a URL. Upper and lower case.
 * Used for slugs only; search has its own one-letter fold (SEARCH_FOLD).
 */
const SLUG_LETTERS: Record<string, string> = {
  // Ghanaian alphabets
  Ɛ: "e", ɛ: "e", Ɔ: "o", ɔ: "o", Ɖ: "d", ɖ: "d", Ƒ: "f", ƒ: "f", Ɣ: "g", ɣ: "g",
  Ŋ: "ng", ŋ: "ng", Ʋ: "v", ʋ: "v", Ʒ: "z", ʒ: "z", Ɩ: "i", ɩ: "i", Ʊ: "u", ʊ: "u",
  // Common IPA letters
  ə: "e", ɐ: "a", ɑ: "a", ɒ: "o", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", ø: "o", Ø: "o",
  ɓ: "b", ɗ: "d", ɠ: "g", ɦ: "h", ɨ: "i", ɪ: "i", ʉ: "u", ɯ: "u", ɲ: "ny", ɳ: "n",
  ɾ: "r", ɹ: "r", ʃ: "sh", θ: "th", ð: "dh", Ð: "dh", þ: "th", Þ: "th", β: "b",
  χ: "x", ɟ: "j", ʔ: "", ʕ: "", ß: "ss", đ: "d", Đ: "d", ł: "l", Ł: "l",
};
const SLUG_LETTER_RE = new RegExp(`[${Object.keys(SLUG_LETTERS).join("")}]`, "g");

/** Spell special letters in plain lower-case Latin (for slugs): Ɔdɔ → odo, Ŋutɔ → nguto. */
export function transliterate(value: string): string {
  return value.replace(SLUG_LETTER_RE, (c) => SLUG_LETTERS[c]);
}

/**
 * search_normalize() folds these one-for-one (SQL translate()), after
 * unaccent and before lower(), so "odo" finds ɔdɔ and ɔdɔ still finds
 * itself. Keep in sync with the latest search migration (a DB test checks).
 * ŋ folds to n here (search matches letter for letter; slugs use "ng").
 */
export const SEARCH_FOLD = {
  from: "ƐɛƆɔƉɖƑƒƔɣŊŋƲʋƷʒƖɩƱʊəɪ",
  to: "eeooddffggnnvvzziiuuei",
} as const;
