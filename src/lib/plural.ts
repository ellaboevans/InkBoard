/**
 * English plurals for counts shown next to a noun ("1 poem", "0 poems",
 * "3 poems"). The UI is English only; Intl.PluralRules picks the form, so 0
 * and fractions take the plural like English expects. Use these instead of
 * hand-written `n === 1 ? … : …` ternaries.
 *
 * Numbers are printed as-is (no thousands separators), matching the rest of
 * the UI. Never pass user-written text (pen names, titles) as the noun.
 */

const rules = new Intl.PluralRules("en");

/** The noun alone, in the form `count` needs: plural(1, "poem") → "poem". */
export function plural(count: number, one: string, other = `${one}s`): string {
  return rules.select(count) === "one" ? one : other;
}

/** The count and its noun: pluralCount(3, "poem") → "3 poems". */
export function pluralCount(count: number, one: string, other?: string): string {
  return `${count} ${plural(count, one, other)}`;
}
