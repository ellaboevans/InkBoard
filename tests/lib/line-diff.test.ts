import { describe, expect, it } from "vitest";
import { diffLines, firstAddedLine, linesChanged, MAX_DIFF_CELLS } from "@/lib/line-diff";

/** Compact form: " x" same, "+x" added, "-x" removed. */
const compact = (from: string, to: string) =>
  diffLines(from, to)!.map((d) => (d.kind === "same" ? " " : d.kind === "added" ? "+" : "-") + d.text);

/** Applying the diff must give back both sides. */
const sides = (from: string, to: string) => {
  const d = diffLines(from, to)!;
  return {
    from: d.filter((l) => l.kind !== "added").map((l) => l.text).join("\n"),
    to: d.filter((l) => l.kind !== "removed").map((l) => l.text).join("\n"),
  };
};

describe("diffLines", () => {
  it("marks nothing for identical text", () => {
    expect(compact("a\nb", "a\nb")).toEqual([" a", " b"]);
    expect(linesChanged(diffLines("a\nb", "a\nb")!)).toBe(0);
  });

  it("finds added, removed and changed lines", () => {
    expect(compact("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
    expect(compact("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
    // A changed line: the old one first, then its replacement.
    expect(compact("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
    expect(linesChanged(diffLines("a\nb\nc", "a\nB\nc")!)).toBe(2);
  });

  it("treats indentation and blank lines as content", () => {
    expect(compact("one\n  two", "one\ntwo")).toEqual([" one", "-  two", "+two"]);
    expect(compact("a\n\nb", "a\nb")).toEqual([" a", "-", " b"]);
  });

  it("handles empty sides", () => {
    expect(compact("", "x")).toEqual(["-", "+x"]);
    expect(compact("x", "x\ny")).toEqual([" x", "+y"]);
  });

  it.each([
    ["Season of mists\nand mellow\nfruitfulness", "Season of mist\nand mellow\nfruitfulness\nClose bosom-friend"],
    ["a\nb\nc\nd\ne", "e\nd\nc\nb\na"],
    ["x\nx\nx\ny", "y\nx\nx"],
  ])("round-trips both sides (%#)", (from, to) => {
    expect(sides(from, to)).toEqual({ from, to });
  });

  it("finds the first line a version added, for history previews", () => {
    expect(firstAddedLine("a\nb\nc", "a\nB\nc")).toBe("B");
    expect(firstAddedLine("a\nb", "a\nb\n\n  new end")).toBe("new end");
    expect(firstAddedLine("a\nb\nc", "a\nc")).toBeNull();
    expect(firstAddedLine("same", "same")).toBeNull();
  });

  it("gives up on huge, completely different texts", () => {
    const n = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const a = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(a, b)).toBeNull();
    // ...but a long poem with a small edit is still compared (prefix/suffix trimming).
    expect(linesChanged(diffLines(a, a.replace("a5\n", "A5\n"))!)).toBe(2);
  });
});
