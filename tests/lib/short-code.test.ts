import { describe, expect, it } from "vitest";
import { newShortCode, parseShortCode, SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, shortCodeFromBytes, shortPath } from "@/lib/share-image/short-code";

/* Short codes (docs/PLAN.md, Phase 21 round 3; rules in src/lib/share-image/short-code.ts). */

describe("the alphabet", () => {
  it("is 27 lowercase symbols with nothing that reads two ways and no vowels", () => {
    expect(SHORT_CODE_ALPHABET).toHaveLength(27);
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(27);
    expect(SHORT_CODE_ALPHABET).toBe(SHORT_CODE_ALPHABET.toLowerCase());
    for (const c of "01oOlIi") expect(SHORT_CODE_ALPHABET, c).not.toContain(c);
    for (const c of "aeiouy") expect(SHORT_CODE_ALPHABET, c).not.toContain(c);
  });
});

describe("newShortCode", () => {
  it("is 6 symbols from the alphabet", () => {
    for (let i = 0; i < 200; i++) expect(newShortCode()).toMatch(new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`));
  });

  it("is random: 2000 draws, no repeats", () => {
    const seen = new Set(Array.from({ length: 2000 }, newShortCode));
    expect(seen.size).toBe(2000);
  });

  it("gives every symbol an equal chance (bytes past the last whole round of 27 are thrown away)", () => {
    // 243 = 9 × 27: bytes from 243 up are skipped (else the first 13 symbols would come up more often).
    const bytes = [0, 26, 27, 243, 255, 242, 1, 5];
    let i = 0;
    const next = () => (i < bytes.length ? bytes[i++] : 0); // never runs dry
    expect(shortCodeFromBytes(next)).toBe([0, 26, 0, 26, 1, 5].map((n) => SHORT_CODE_ALPHABET[n]).join(""));
    const counts = new Map<string, number>();
    for (let k = 0; k < 4000; k++) for (const c of newShortCode()) counts.set(c, (counts.get(c) ?? 0) + 1);
    const expected = (4000 * 6) / 27;
    for (const c of SHORT_CODE_ALPHABET) expect(Math.abs((counts.get(c) ?? 0) - expected) / expected, c).toBeLessThan(0.15);
  });
});

describe("parseShortCode", () => {
  it("accepts a code, and the same code with capitals (phones capitalise the first letter)", () => {
    expect(parseShortCode("k3x9qm")).toBe("k3x9qm");
    expect(parseShortCode("K3x9qm")).toBe("k3x9qm");
    expect(parseShortCode("K3X9QM")).toBe("k3x9qm");
  });

  it("refuses anything that can't be a code", () => {
    for (const raw of ["", "k3x9q", "k3x9qmm", "k3x9q0", "k3x9qo", "k3x9ql", "k3x9qi", "k3x9qa", "k3 9qm", "k3x9q-", "ķ3x9qm", "../abc", "k3x9qm/"]) {
      expect(parseShortCode(raw), raw).toBeNull();
    }
  });

  it("prints as /s/<code>", () => expect(shortPath("k3x9qm")).toBe("/s/k3x9qm"));
});
