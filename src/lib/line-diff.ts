/**
 * Line-by-line diff for the poem history view (docs/PLAN.md, Phase 13):
 * which lines restoring a version would bring back or remove. A plain
 * longest-common-subsequence over lines, which is plenty for poems; whitespace
 * is significant (indentation is part of a poem). Pure, shared by client and tests.
 */

export type DiffLine = {
  /** "same": in both; "added": only in `to`; "removed": only in `from`. */
  kind: "same" | "added" | "removed";
  text: string;
};

/** Above this many line pairs, skip the diff (memory) and say so instead. */
export const MAX_DIFF_CELLS = 4_000_000;

/** Diff from `from` (e.g. the editor's text) to `to` (a version); null if too long to compare. */
export function diffLines(from: string, to: string): DiffLine[] | null {
  const a = from.split("\n");
  const b = to.split("\n");
  // Common prefix and suffix first: most edits touch a few lines.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_DIFF_CELLS) return null;

  // lcs[i][j] = LCS length of midA[i:] and midB[j:].
  const n = midA.length;
  const m = midB.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      out.push({ kind: "same", text: midA[i] });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // In a changed block, the old lines come first, then their replacements.
      out.push({ kind: "removed", text: midA[i++] });
    } else {
      out.push({ kind: "added", text: midB[j++] });
    }
  }
  for (const text of a.slice(endA)) out.push({ kind: "same", text });
  return out;
}

/** The first line `to` has that `from` doesn't, or null (only removals, or the same). */
export function firstAddedLine(from: string, to: string): string | null {
  return diffLines(from, to)?.find((d) => d.kind === "added" && d.text.trim() !== "")?.text.trim() ?? null;
}

/** How many lines a diff marks as added or removed. */
export const linesChanged = (diff: DiffLine[]) => diff.filter((d) => d.kind !== "same").length;
