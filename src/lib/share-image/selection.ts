/*
 * "Choose lines" for the share image (docs/PLAN.md, Phase 21 round 2): which
 * of a public poem's lines a reader picked, and the compact form that carries
 * the pick to the route (`?lines=3-6,9`). Pure, shared by the sheet (client)
 * and the route (server), so both agree on every rule.
 *
 * THE MODEL: any of the poem's lines, kept in the poem's order, at most
 * MAX_PICKED_LINES (12) of them. Blank lines (stanza breaks) can't be picked;
 * one is shown only when the lines on both sides of it are picked. Where
 * picked lines are separated by lines that weren't, the image marks the gap
 * with "…", so a quote never silently joins lines the poet kept apart.
 *
 * THE FORM: 1-based line numbers of the stored poem text (`body.split("\n")`),
 * as comma-separated runs `a` or `a-b`. A run covers picked lines with nothing
 * between them but blank lines, so "4-6" with line 5 blank picks 4 and 6 and
 * keeps the stanza break. Exactly one string encodes each pick (ascending,
 * runs as long as possible, no leading zeros, ends on picked lines), and the
 * route accepts only that string: duplicates, overlaps, wrong order, runs
 * that should have been merged, out-of-range or blank-line ends, too many
 * lines and anything malformed are all refused. One pick, one URL.
 */

export const MAX_PICKED_LINES = 12;
/** Far longer than any valid selection (12 runs of two 5-digit numbers); refused before parsing. */
const MAX_SELECTION_LENGTH = 160;
const FORM = /^[1-9]\d{0,4}(-[1-9]\d{0,4})?(,[1-9]\d{0,4}(-[1-9]\d{0,4})?)*$/;

/** The poem's lines as the selection numbers them. */
export function poemLines(body: string): string[] {
  return body.replace(/\r\n?/g, "\n").split("\n");
}

const isBlank = (line: string | undefined) => line === undefined || line.trim() === "";

/** The canonical form of a pick (line numbers of non-blank lines), or "" for none. */
export function encodeSelection(picked: Iterable<number>, lines: readonly string[]): string {
  const set = [...new Set(picked)].filter((n) => Number.isInteger(n) && !isBlank(lines[n - 1])).sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const n of set) {
    const run = runs[runs.length - 1];
    // Continue the run if nothing but blank lines lies between its end and n.
    if (run && lines.slice(run[1], n - 1).every((l) => isBlank(l))) run[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",");
}

export type ParsedSelection = { ok: true; picked: number[]; code: string } | { ok: false };

/**
 * Checks `raw` against the poem's lines: the canonical form of 1 to
 * MAX_PICKED_LINES of its non-blank lines, or `{ ok: false }`.
 */
export function parseSelection(raw: string, lines: readonly string[]): ParsedSelection {
  if (raw.length === 0 || raw.length > MAX_SELECTION_LENGTH || !FORM.test(raw)) return { ok: false };
  const picked: number[] = [];
  for (const item of raw.split(",")) {
    const [a, b = a] = item.split("-").map(Number);
    if (a > b || b > lines.length) return { ok: false };
    for (let n = a; n <= b; n++) {
      if (!isBlank(lines[n - 1])) picked.push(n);
      if (picked.length > MAX_PICKED_LINES) return { ok: false };
    }
  }
  if (picked.length === 0) return { ok: false };
  // Anything but the one canonical string (duplicates, order, unmerged runs, blank ends) is refused.
  if (encodeSelection(picked, lines) !== raw || new Set(picked).size !== picked.length) return { ok: false };
  return { ok: true, picked, code: raw };
}

/** What a pick shows, in order: picked lines, the stanza breaks between them, and "…" where lines were skipped. */
export type PickedItem = { kind: "line"; text: string } | { kind: "omission" };

export function pickedItems(lines: readonly string[], picked: readonly number[]): PickedItem[] {
  const code = encodeSelection(picked, lines);
  if (!code) return [];
  const items: PickedItem[] = [];
  code.split(",").forEach((run, i) => {
    const [a, b = a] = run.split("-").map(Number);
    if (i > 0) items.push({ kind: "omission" });
    // Inside a run, the blank lines are kept: both their sides are picked.
    for (let n = a; n <= b; n++) items.push({ kind: "line", text: lines[n - 1] });
  });
  return items;
}
