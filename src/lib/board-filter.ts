/**
 * Browsing the board by language (docs/PLAN.md, Phase 11c). Pure helpers: the
 * board data stays one cached, unfiltered list (prerendered with `/`), and the
 * client narrows it here, then lays the result out again with layoutBoard.
 */

import type { BoardSection } from "./board-types";
import { POEM_LANGUAGES, type PoemLanguage } from "./poem-languages";

/** URL search param holding the chosen language (`/?lang=ee`). */
export const LANG_PARAM = "lang";

export type LanguageOption = { code: PoemLanguage; name: string; count: number };

/** Languages used by at least one poem on the board, in POEM_LANGUAGES order. */
export function boardLanguages(sections: BoardSection[]): LanguageOption[] {
  const counts = new Map<string, number>();
  for (const s of sections) {
    for (const p of s.poems) {
      if (p.language) counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
    }
  }
  return POEM_LANGUAGES.filter((l) => counts.has(l.code)).map((l) => ({
    code: l.code,
    name: l.short,
    count: counts.get(l.code)!,
  }));
}

/**
 * The active filter for a raw `?lang=` value: a language that has poems on
 * this board, otherwise null (All). Unknown or empty values mean All.
 */
export function parseLanguageFilter(
  raw: string | null | undefined,
  options: LanguageOption[],
): PoemLanguage | null {
  return options.find((o) => o.code === raw)?.code ?? null;
}

/** Only `language`'s poems; authors left with none drop out. Null = everything. */
export function filterSectionsByLanguage(
  sections: BoardSection[],
  language: string | null,
): BoardSection[] {
  if (!language) return sections;
  return sections.flatMap((s) => {
    const poems = s.poems.filter((p) => p.language === language);
    return poems.length ? [{ ...s, poems }] : [];
  });
}

/** `search` with the language param set (or removed for All), keeping others. */
export function withLanguageParam(search: string, language: string | null): string {
  const params = new URLSearchParams(search);
  if (language) params.set(LANG_PARAM, language);
  else params.delete(LANG_PARAM);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
