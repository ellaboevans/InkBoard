import { describe, expect, it } from "vitest";
import { IPA_GROUPS, keyFace, LANGUAGE_SETS, searchIpa, TONE_MARKS } from "@/lib/letter-sets";

// The Special letters bar (docs/PLAN.md, Phase 11b).
const all = [...LANGUAGE_SETS.flatMap((l) => l.letters), ...TONE_MARKS, ...IPA_GROUPS.flatMap((g) => g.keys)];

describe("letter sets", () => {
  it("has the agreed tabs: Akan (incl. Twi, Fante, Nzema), Ewe, Ga", () => {
    expect(LANGUAGE_SETS.map((l) => l.label)).toEqual(["Akan", "Ewe", "Ga"]);
    const letters = Object.fromEntries(LANGUAGE_SETS.map((l) => [l.id, l.letters.map((k) => k.char).join(" ")]));
    expect(letters).toEqual({ akan: "ɛ ɔ", ewe: "ɖ ɛ ƒ ɣ ŋ ɔ ʋ", ga: "ɛ ŋ ɔ" });
    expect(LANGUAGE_SETS.filter((l) => l.tones).map((l) => l.id)).toEqual(["ewe", "ga"]);
  });

  it("marks exactly the combining marks as combining, one code point each", () => {
    for (const k of all) {
      expect([...k.char], k.name).toHaveLength(1);
      expect(/^\p{M}$/u.test(k.char), k.name).toBe(Boolean(k.combining));
      expect(k.name.trim(), k.char).not.toBe("");
    }
  });

  it("every language letter has a capital form (for the Capitals toggle)", () => {
    for (const k of LANGUAGE_SETS.flatMap((l) => l.letters)) expect(k.char.toUpperCase(), k.name).not.toBe(k.char);
  });

  it("has no duplicate keys within a tab or IPA group", () => {
    for (const g of [...LANGUAGE_SETS.map((l) => l.letters), TONE_MARKS, ...IPA_GROUPS.map((g) => g.keys)]) {
      const chars = g.map((k) => k.char);
      expect(new Set(chars).size).toBe(chars.length);
    }
  });

  it("shows combining marks on a dotted circle", () => {
    expect(keyFace(TONE_MARKS[2])).toBe("◌̃");
    expect(keyFace(LANGUAGE_SETS[0].letters[0])).toBe("ɛ");
  });
});

describe("IPA search", () => {
  const chars = (q: string) => searchIpa(q).flatMap((g) => g.keys.map((k) => k.char));

  it("matches every word of the query against the chart names", () => {
    expect(chars("open-mid back")).toEqual(["ʌ", "ɔ"]);
    expect(chars("CLICK")).toEqual(["ʘ", "ǀ", "ǃ", "ǂ", "ǁ"]);
    expect(chars("glottal stop")).toEqual(["ʔ"]);
  });

  it("finds a symbol by itself, and shows everything for an empty query", () => {
    expect(chars("ɛ")).toEqual(["ɛ"]);
    expect(searchIpa("  ")).toHaveLength(IPA_GROUPS.length);
  });

  it("returns nothing for no match (the bar says so)", () => {
    expect(searchIpa("zzz")).toEqual([]);
  });
});
