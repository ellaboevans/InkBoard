/**
 * The language a poem is written in (docs/PLAN.md, Phase 11c), chosen by the
 * editor. Optional: an untagged poem is just "not set" (mixed, or another
 * language). Shared by the editor, the server validator and reader views.
 *
 * `code` is a BCP 47 tag, rendered as the poem's `lang` attribute so screen
 * readers, hyphenation and spell-check treat the text as that language.
 * Akan covers Twi, Fante and Nzema, matching the Special letters bar
 * (a product-owner decision); Ga is `gaa` (no two-letter code exists).
 */
export const POEM_LANGUAGES = [
  { code: "ak", label: "Akan (Twi, Fante, Nzema)", short: "Akan" },
  { code: "ee", label: "Ewe", short: "Ewe" },
  { code: "gaa", label: "Ga", short: "Ga" },
  { code: "en", label: "English", short: "English" },
] as const;

export type PoemLanguage = (typeof POEM_LANGUAGES)[number]["code"];

export const POEM_LANGUAGE_CODES = POEM_LANGUAGES.map((l) => l.code) as [PoemLanguage, ...PoemLanguage[]];

/** The reader-facing name ("Ewe"), or null for an untagged poem. */
export function languageName(code: string | null | undefined): string | null {
  return POEM_LANGUAGES.find((l) => l.code === code)?.short ?? null;
}
