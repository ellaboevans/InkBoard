/**
 * What the "Special letters" bar offers (docs/PLAN.md, Phase 11b). Pure data,
 * shared by the component and its tests.
 *
 * Akan covers Twi, Fante and Nzema, which use the same letters (decided with
 * the product owner). Tone marks are offered for Ewe and Ga only, until we
 * know which Akan writers use.
 */

export type LetterKey = {
  /** What gets inserted: one letter, or one combining mark. */
  char: string;
  /** Spoken name ("Insert open o"); also what IPA search matches. */
  name: string;
  /** A combining mark: attaches to the letter before the cursor. */
  combining?: boolean;
};

export type LanguageSet = {
  id: "akan" | "ewe" | "ga";
  label: string;
  /** Lowercase; the Capitals toggle upper-cases them. */
  letters: LetterKey[];
  tones: boolean;
};

const L = (char: string, name: string): LetterKey => ({ char, name });
const M = (char: string, name: string): LetterKey => ({ char, name, combining: true });

const OPEN_E = L("ɛ", "open e");
const OPEN_O = L("ɔ", "open o");
const ENG = L("ŋ", "eng");

export const LANGUAGE_SETS: LanguageSet[] = [
  { id: "akan", label: "Akan", letters: [OPEN_E, OPEN_O], tones: false },
  {
    id: "ewe",
    label: "Ewe",
    letters: [L("ɖ", "African d"), OPEN_E, L("ƒ", "Ewe f"), L("ɣ", "gamma"), ENG, OPEN_O, L("ʋ", "Ewe v")],
    tones: true,
  },
  { id: "ga", label: "Ga", letters: [OPEN_E, ENG, OPEN_O], tones: true },
];

/** Tone marks for Ewe and Ga (combining, so they work on ɛ and ɔ too). */
export const TONE_MARKS: (LetterKey & { short: string })[] = [
  { ...M("́", "high tone"), short: "high" },
  { ...M("̀", "low tone"), short: "low" },
  { ...M("̃", "nasal"), short: "nasal" },
  { ...M("̌", "rising tone"), short: "rising" },
  { ...M("̂", "falling tone"), short: "falling" },
  { ...M("̄", "mid tone"), short: "mid" },
];

/** IPA for linguists, grouped like the IPA chart. Names follow the chart's wording. */
export const IPA_GROUPS: { label: string; keys: LetterKey[] }[] = [
  {
    label: "Vowels",
    keys: [
      L("i", "close front unrounded"), L("y", "close front rounded"), L("ɨ", "close central unrounded"),
      L("ʉ", "close central rounded"), L("ɯ", "close back unrounded"), L("u", "close back rounded"),
      L("ɪ", "near-close front unrounded"), L("ʏ", "near-close front rounded"), L("ʊ", "near-close back rounded"),
      L("e", "close-mid front unrounded"), L("ø", "close-mid front rounded"), L("ɘ", "close-mid central unrounded"),
      L("ɵ", "close-mid central rounded"), L("ɤ", "close-mid back unrounded"), L("o", "close-mid back rounded"),
      L("ə", "schwa mid central"), L("ɛ", "open-mid front unrounded"), L("œ", "open-mid front rounded"),
      L("ɜ", "open-mid central unrounded"), L("ɞ", "open-mid central rounded"), L("ʌ", "open-mid back unrounded"),
      L("ɔ", "open-mid back rounded"), L("æ", "near-open front unrounded"), L("ɐ", "near-open central"),
      L("a", "open front unrounded"), L("ɶ", "open front rounded"), L("ɑ", "open back unrounded"),
      L("ɒ", "open back rounded"),
    ],
  },
  {
    label: "Consonants",
    keys: [
      L("ɸ", "voiceless bilabial fricative"), L("β", "voiced bilabial fricative"), L("ʋ", "labiodental approximant"),
      L("ɱ", "labiodental nasal"), L("θ", "voiceless dental fricative"), L("ð", "voiced dental fricative"),
      L("ɾ", "alveolar tap flap"), L("ɹ", "alveolar approximant"), L("ɬ", "voiceless alveolar lateral fricative"),
      L("ɮ", "voiced alveolar lateral fricative"), L("ʃ", "voiceless postalveolar fricative esh"),
      L("ʒ", "voiced postalveolar fricative ezh"), L("ʈ", "voiceless retroflex plosive"),
      L("ɖ", "voiced retroflex plosive"), L("ɳ", "retroflex nasal"), L("ʂ", "voiceless retroflex fricative"),
      L("ʐ", "voiced retroflex fricative"), L("ɻ", "retroflex approximant"), L("ɭ", "retroflex lateral approximant"),
      L("ɽ", "retroflex flap"), L("c", "voiceless palatal plosive"), L("ɟ", "voiced palatal plosive"),
      L("ɲ", "palatal nasal"), L("ç", "voiceless palatal fricative"), L("ʝ", "voiced palatal fricative"),
      L("ʎ", "palatal lateral approximant"), L("ɡ", "voiced velar plosive"), L("ŋ", "velar nasal eng"),
      L("ɣ", "voiced velar fricative gamma"), L("ɰ", "velar approximant"), L("ʟ", "velar lateral approximant"),
      L("χ", "voiceless uvular fricative"), L("ʁ", "voiced uvular fricative"), L("ʀ", "uvular trill"),
      L("ɴ", "uvular nasal"), L("ɢ", "voiced uvular plosive"), L("ħ", "voiceless pharyngeal fricative"),
      L("ʕ", "voiced pharyngeal fricative"), L("ʔ", "glottal stop"), L("ɦ", "voiced glottal fricative"),
      L("ʍ", "voiceless labial-velar fricative"), L("ɥ", "labial-palatal approximant"), L("ɧ", "sj sound"),
    ],
  },
  {
    label: "Implosives, clicks, ejective",
    keys: [
      L("ɓ", "bilabial implosive"), L("ɗ", "alveolar implosive"), L("ʄ", "palatal implosive"),
      L("ɠ", "velar implosive"), L("ʛ", "uvular implosive"), L("ʘ", "bilabial click"), L("ǀ", "dental click"),
      L("ǃ", "alveolar click"), L("ǂ", "palatoalveolar click"), L("ǁ", "alveolar lateral click"),
      L("ʼ", "ejective"),
    ],
  },
  {
    label: "Stress, length, tone letters",
    keys: [
      L("ˈ", "primary stress"), L("ˌ", "secondary stress"), L("ː", "long"), L("ˑ", "half-long"),
      M("̆", "extra-short"), L("|", "minor group"), L("‖", "major group"), L("‿", "linking"),
      L("˥", "extra high tone letter"), L("˦", "high tone letter"), L("˧", "mid tone letter"),
      L("˨", "low tone letter"), L("˩", "extra low tone letter"), L("↗", "global rise"), L("↘", "global fall"),
    ],
  },
  {
    label: "Diacritics",
    keys: [
      M("̥", "voiceless ring below"), M("̬", "voiced caron below"), L("ʰ", "aspirated"),
      L("ʷ", "labialized"), L("ʲ", "palatalized"), L("ˠ", "velarized"), L("ˤ", "pharyngealized"),
      M("̃", "nasalized tilde"), M("̩", "syllabic"), M("̯", "non-syllabic"),
      M("̪", "dental"), M("̚", "no audible release"), M("̈", "centralized"),
      M("͡", "tie bar"), M("́", "high tone acute"), M("̀", "low tone grave"),
    ],
  },
];

/**
 * IPA keys matching a search: every word of the query appears in the name,
 * or the query is the symbol itself. Empty query: everything.
 */
export function searchIpa(query: string): { label: string; keys: LetterKey[] }[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  return IPA_GROUPS.map((g) => ({
    label: g.label,
    keys: g.keys.filter((k) => !q || k.char === query.trim() || words.every((w) => k.name.includes(w))),
  })).filter((g) => g.keys.length > 0);
}

/** What a key shows: combining marks on a dotted circle (◌́), as on the IPA chart. */
export function keyFace(key: LetterKey): string {
  return key.combining ? `◌${key.char}` : key.char;
}
