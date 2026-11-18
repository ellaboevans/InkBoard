import { describe, expect, it } from "vitest";
import {
  encodePassage,
  PASSAGE_MAX_CHARS,
  passageLength,
  passageOutline,
  passageParagraphs,
  parsePassage,
  type PassagePick,
} from "@/lib/share-image/passage";

/*
 * "Share a passage" (docs/PLAN.md, Phase 25 round 3): the units (paragraphs
 * and their sentences, read as the chapter page reads them), the one
 * canonical string per pick, and the 600-character cap.
 */

const CHAPTER = [
  "^^The ferry came late. Akua waited at the landing! Was he coming?",
  "",
  "*Kwabena* did not come back. The radio stayed on the shelf, “talking to nobody.” She turned it off.",
  "",
  "* * *",
  "",
  "Dear Akua,",
  "the lake is wide. I am well.",
  "",
  "No stop at the end of this one",
].join("\n");

const outline = () => passageOutline(passageParagraphs(CHAPTER));
const pick = (a: number, s: number, b: number, t: number): PassagePick => ({ from: { p: a, s }, to: { p: b, s: t } });

describe("the units: paragraphs and their sentences", () => {
  it("reads paragraphs like the chapter page: the drop-cap marker dropped, scene breaks between, kept line breaks", () => {
    const { paragraphs, breaks } = outline();
    expect(paragraphs).toEqual([
      ["The ferry came late.", "Akua waited at the landing!", "Was he coming?"],
      ["Kwabena did not come back.", "The radio stayed on the shelf, “talking to nobody.”", "She turned it off."],
      ["Dear Akua,\nthe lake is wide.", "I am well."],
      ["No stop at the end of this one"],
    ]);
    // The scene break stands before paragraph 3.
    expect(breaks).toEqual([3]);
  });

  it("keeps emphasis on the sentence it belongs to, and marks a sentence that starts on a kept line break", () => {
    const paras = passageParagraphs("*Go.* Now **stay**.\nThen leave.");
    expect(paras[0].sentences.map((s) => s.pieces)).toEqual([
      [{ text: "Go.", italic: true, bold: false }],
      [
        { text: "Now ", italic: false, bold: false },
        { text: "stay", italic: false, bold: true },
        { text: ".", italic: false, bold: false },
      ],
      [{ text: "Then leave.", italic: false, bold: false }],
    ]);
    expect(paras[0].sentences.map((s) => s.newLine)).toEqual([false, false, true]);
  });
});

describe("the canonical form", () => {
  const counts = () => outline().paragraphs.map((p) => p.length);

  it("round-trips: one whole paragraph, whole paragraphs, a trimmed start or end, one sentence", () => {
    const cases: [PassagePick, string][] = [
      [pick(2, 1, 2, 3), "2"],
      [pick(1, 1, 2, 3), "1-2"],
      [pick(1, 2, 2, 3), "1.2-2"],
      [pick(1, 1, 2, 1), "1-2.1"],
      [pick(1, 3, 3, 1), "1.3-3.1"],
      [pick(2, 2, 2, 2), "2.2-2.2"],
      [pick(2, 1, 2, 2), "2-2.2"],
      [pick(2, 2, 2, 3), "2.2-2"],
      [pick(4, 1, 4, 1), "4"],
    ];
    for (const [p, code] of cases) {
      expect(encodePassage(p, counts()), code).toBe(code);
      const parsed = parsePassage(code, outline().paragraphs);
      expect(parsed, code).toMatchObject({ ok: true, pick: p, code });
    }
  });

  it("refuses every other spelling of a pick: leading zeros, sentence 1 written out, a-a, whole-paragraph ends written out", () => {
    for (const raw of ["02", "2.1", "2-2", "1.1-2", "1-2.3", "2.2-2.3", "1-02"]) {
      expect(parsePassage(raw, outline().paragraphs), raw).toEqual({ ok: false, reason: raw === "02" || raw === "1-02" ? "form" : "not_canonical" });
    }
  });

  it("refuses picks outside the chapter, backwards ones and junk", () => {
    const p = outline().paragraphs;
    for (const raw of ["5", "1-5", "1.4-2", "2.4-2", "3-1", "2.3-2.1", "0", "1.0", "", "-", "1-", "1--2", "a", "1,2", "1.2.3", " 1", "1-2 ", "9".repeat(30), "1e3"]) {
      expect(parsePassage(raw, p).ok, JSON.stringify(raw)).toBe(false);
    }
  });
});

describe("the cap: 600 characters, counted as readers see them", () => {
  it("counts the sentences' characters plus one for each join", () => {
    const p = outline().paragraphs;
    // "The ferry came late." (20) + "Akua waited at the landing!" (27) + 1 join
    expect(passageLength(p, pick(1, 1, 1, 2))).toBe(48);
    // Across a paragraph break: one join too.
    expect(passageLength(p, pick(1, 3, 2, 1))).toBe("Was he coming?".length + 1 + "Kwabena did not come back.".length);
  });

  it("counts a letter with a tone mark as one character, though it's two code points", () => {
    const ewe = "Ɛ́ ɛ́ ɔ̃ ŋ́.".normalize("NFC");
    expect([...ewe].length).toBeGreaterThan(9);
    expect(passageLength([[ewe]], pick(1, 1, 1, 1))).toBe(8); // 4 letters, 3 spaces, a stop
  });

  it(`refuses a pick over ${PASSAGE_MAX_CHARS} characters, and takes one at exactly the cap`, () => {
    const sentence = (n: number) => `${"a".repeat(n - 1)}.`;
    // Two sentences of 299 characters and one join: 599; then one more of 1 char and a join: 601.
    const body = `${sentence(299)} ${sentence(300)}\n\n${sentence(10)}`;
    const p = passageOutline(passageParagraphs(body)).paragraphs;
    expect(passageLength(p, pick(1, 1, 1, 2))).toBe(600);
    expect(parsePassage("1", p)).toMatchObject({ ok: true, length: 600 });
    expect(parsePassage("1-2", p)).toEqual({ ok: false, reason: "too_long" });
    // Trimmed to fit again.
    expect(parsePassage("1.2-2", p)).toMatchObject({ ok: true, length: 300 + 1 + 10 });
  });
});
