import { describe, expect, it } from "vitest";
import { encodeSelection, MAX_PICKED_LINES, parseSelection, pickedItems, poemLines } from "@/lib/share-image/selection";

/*
 * "Choose lines" (docs/PLAN.md, Phase 21 round 2; the rules are in the header
 * of src/lib/share-image/selection.ts): any lines in the poem's order, at most
 * 12, carried as one canonical string the route accepts and nothing else.
 */

// 1 one · 2 two · 3 three · 4 (blank) · 5 five · 6 six · 7 (blank) · 8 eight … 20 twenty
const LINES = poemLines(
  ["one", "two", "three", "", "five", "six", "", ...Array.from({ length: 13 }, (_, i) => `line ${i + 8}`)].join("\n"),
);

describe("encodeSelection: one string per pick", () => {
  it("runs of picked lines; a run carries on across blank lines only", () => {
    expect(encodeSelection([1, 2, 3], LINES)).toBe("1-3");
    expect(encodeSelection([3, 5], LINES)).toBe("3-5"); // only the blank line 4 between them
    expect(encodeSelection([2, 5], LINES)).toBe("2,5"); // line 3 skipped
    expect(encodeSelection([1, 3], LINES)).toBe("1,3");
    expect(encodeSelection([6, 8, 9], LINES)).toBe("6-9");
  });

  it("ignores order, duplicates, blank lines and numbers outside the poem", () => {
    expect(encodeSelection([5, 3, 3, 4, 0, 99, 2.5], LINES)).toBe("3-5");
    expect(encodeSelection([], LINES)).toBe("");
    expect(encodeSelection([4, 7], LINES)).toBe("");
  });
});

describe("parseSelection: the canonical string or nothing", () => {
  it("accepts good picks and returns the picked lines", () => {
    expect(parseSelection("1-3", LINES)).toEqual({ ok: true, picked: [1, 2, 3], code: "1-3" });
    expect(parseSelection("3-5", LINES)).toEqual({ ok: true, picked: [3, 5], code: "3-5" });
    expect(parseSelection("2,5,8-10", LINES)).toEqual({ ok: true, picked: [2, 5, 8, 9, 10], code: "2,5,8-10" });
    expect(parseSelection("20", LINES)).toEqual({ ok: true, picked: [20], code: "20" });
  });

  it("refuses an empty pick, or one of blank lines only", () => {
    for (const raw of ["", "4", "7", "4-4"]) expect(parseSelection(raw, LINES), raw).toEqual({ ok: false });
  });

  it(`refuses more than ${MAX_PICKED_LINES} lines, and allows exactly ${MAX_PICKED_LINES}`, () => {
    expect(parseSelection("8-19", LINES).ok).toBe(true); // 12 lines
    expect(parseSelection("8-20", LINES)).toEqual({ ok: false }); // 13
    expect(parseSelection("1-3,5-6,8-15", LINES)).toEqual({ ok: false }); // 5 + 8
  });

  it("refuses numbers outside the poem", () => {
    for (const raw of ["0", "21", "19-21", "0-2"]) expect(parseSelection(raw, LINES), raw).toEqual({ ok: false });
  });

  it("refuses anything malformed", () => {
    for (const raw of ["a", "1-", "-3", "1--3", "1,,2", "1,", ",1", " 1", "1 ", "1;2", "01", "1-03", "1.5", "+1", "1-2-3", "１", "99999999"]) {
      expect(parseSelection(raw, LINES), raw).toEqual({ ok: false });
    }
    expect(parseSelection("1,".repeat(100) + "1", LINES)).toEqual({ ok: false });
  });

  it("refuses duplicates, wrong order, overlaps and runs that should be one", () => {
    for (const raw of ["2,2", "3,1", "5,2", "1-3,2", "1-3,3-5", "1,2", "1-2,3", "3,5", "3-3", "2-1"]) {
      expect(parseSelection(raw, LINES), raw).toEqual({ ok: false });
    }
  });

  it("refuses a run that starts or ends on a blank line", () => {
    for (const raw of ["4-5", "3-4", "4-6"]) expect(parseSelection(raw, LINES), raw).toEqual({ ok: false });
  });

  it("every pick round-trips", () => {
    for (const pick of [[1], [1, 2, 3], [3, 5], [2, 5, 6, 8], [6, 8, 9, 11, 13, 20]]) {
      const code = encodeSelection(pick, LINES);
      expect(parseSelection(code, LINES), code).toEqual({ ok: true, picked: pick, code });
    }
  });
});

describe("pickedItems: what the image shows", () => {
  it("keeps a stanza break only when both sides are picked", () => {
    expect(pickedItems(LINES, [3, 5])).toEqual([
      { kind: "line", text: "three" },
      { kind: "line", text: "" },
      { kind: "line", text: "five" },
    ]);
  });

  it("marks skipped lines with … and never shows a break whose side wasn't picked", () => {
    expect(pickedItems(LINES, [2, 5])).toEqual([
      { kind: "line", text: "two" },
      { kind: "omission" },
      { kind: "line", text: "five" },
    ]);
    expect(pickedItems(LINES, [1, 3])).toEqual([{ kind: "line", text: "one" }, { kind: "omission" }, { kind: "line", text: "three" }]);
  });

  it("keeps the poem's order whatever order the lines were picked in", () => {
    expect(pickedItems(LINES, [9, 8])).toEqual([
      { kind: "line", text: "line 8" },
      { kind: "line", text: "line 9" },
    ]);
  });

  it("keeps tone marks and Markdown exactly as written", () => {
    const ewe = poemLines("Nùnyá, àdìdòé,\nàsí mètúnɛ́ ò.\n\n*Ƒè ɖèká* mèɖɔ̀a ŋkɔ́ ò,".normalize("NFC"));
    expect(pickedItems(ewe, [2, 4]).map((i) => (i.kind === "line" ? i.text : "…"))).toEqual(
      ["àsí mètúnɛ́ ò.", "", "*Ƒè ɖèká* mèɖɔ̀a ŋkɔ́ ò,"].map((t) => t.normalize("NFC")),
    );
  });
});
