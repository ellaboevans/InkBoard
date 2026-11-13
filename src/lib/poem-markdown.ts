/**
 * Light Markdown for poems: `*italic*`, `**bold**`, `***both***`, and `\*`
 * for a literal asterisk. Nothing else is special, so line breaks,
 * indentation, `#`, `-`, `>` and so on stay exactly as typed.
 *
 * Rules (a simplified CommonMark delimiter algorithm):
 * - Emphasis never crosses a line break, so one stray `*` can't italicise
 *   the rest of a poem.
 * - A run of `*` can open if the next character isn't whitespace, and close
 *   if the previous one isn't. So `* * *` (a stanza break) and `2 * 3` stay
 *   literal without escaping.
 * - Anything left unmatched is shown as typed.
 *
 * Pure and framework-free: used by the reader, the board cards, the editor
 * preview, and to strip formatting for meta descriptions, JSON-LD and share
 * cards.
 */

export type EmphasisKind = "em" | "strong";
export type PoemNode = string | { kind: EmphasisKind; children: PoemNode[] };

type Run = {
  type: "run";
  remaining: number;
  canOpen: boolean;
  canClose: boolean;
  /** Pairs this run closes, innermost first. */
  closes: EmphasisKind[];
  /** Pairs this run opens, innermost first. */
  opens: EmphasisKind[];
};
type Token = { type: "text"; text: string } | Run;

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    if (text) tokens.push({ type: "text", text });
    text = "";
  };
  for (let i = 0; i < line.length; ) {
    if (line[i] === "\\" && line[i + 1] === "*") {
      text += "*";
      i += 2;
    } else if (line[i] === "*") {
      let j = i;
      while (line[j] === "*") j++;
      flush();
      tokens.push({
        type: "run",
        remaining: j - i,
        canOpen: !isSpace(line[j]),
        canClose: !isSpace(line[i - 1]),
        closes: [],
        opens: [],
      });
      i = j;
    } else {
      text += line[i++];
    }
  }
  flush();
  return tokens;
}

/** Parses one line. `closeAtEnd` closes open emphasis at the end (for a cut-off excerpt). */
export function parsePoemLine(line: string, closeAtEnd = false): PoemNode[] {
  const tokens = tokenize(line);
  const openers: Run[] = [];
  const take = (o: Run, available: number) => {
    const use = o.remaining >= 2 && available >= 2 ? 2 : 1;
    o.remaining -= use;
    o.opens.push(use === 2 ? "strong" : "em");
    if (o.remaining === 0) openers.pop();
    return use;
  };

  for (const t of tokens) {
    if (t.type !== "run") continue;
    if (t.canClose) {
      // The nearest opener is always on top, so pairs nest properly.
      while (t.remaining > 0 && openers.length > 0) {
        const use = take(openers[openers.length - 1], t.remaining);
        t.remaining -= use;
        t.closes.push(use === 2 ? "strong" : "em");
      }
    }
    if (t.canOpen && t.remaining > 0) openers.push(t);
  }
  const trailing: EmphasisKind[] = [];
  while (closeAtEnd && openers.length > 0) {
    const o = openers[openers.length - 1];
    trailing.push(take(o, Infinity) === 2 ? "strong" : "em");
  }

  // Build the tree. Within a run, closing pairs come first (they consumed
  // its left end), then leftover literal stars, then opening pairs from
  // outermost to innermost.
  const root: PoemNode[] = [];
  const stack: PoemNode[][] = [root];
  const push = (s: string) => {
    const top = stack[stack.length - 1];
    if (typeof top[top.length - 1] === "string") top[top.length - 1] += s;
    else top.push(s);
  };
  const open = (kind: EmphasisKind) => {
    const node = { kind, children: [] as PoemNode[] };
    stack[stack.length - 1].push(node);
    stack.push(node.children);
  };
  const close = () => void stack.pop();

  for (const t of tokens) {
    if (t.type === "text") {
      push(t.text);
      continue;
    }
    t.closes.forEach(close);
    if (t.remaining > 0) push("*".repeat(t.remaining));
    [...t.opens].reverse().forEach(open);
  }
  trailing.forEach(close);
  return root;
}

/** Parses a whole poem, one node list per line. */
export function parsePoem(text: string, { truncated = false } = {}): PoemNode[][] {
  const lines = text.split("\n");
  return lines.map((line, i) => parsePoemLine(line, truncated && i === lines.length - 1));
}

function plain(nodes: PoemNode[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : plain(n.children))).join("");
}

/** The poem as plain text: formatting markers removed, `\*` shown as `*`. */
export function stripPoemMarkdown(text: string): string {
  return parsePoem(text).map(plain).join("\n");
}

/* ------------------------------------------------------------------------ */
/* Editor shortcuts                                                          */
/* ------------------------------------------------------------------------ */

export type TextEdit = {
  /** Replace value[from, to) with `insert`... */
  from: number;
  to: number;
  insert: string;
  /** ...then select [selStart, selEnd). */
  selStart: number;
  selEnd: number;
};

const leadingStars = (s: string) => s.length - s.replace(/^\*+/, "").length;
const trailingStars = (s: string) => s.length - s.replace(/\*+$/, "").length;

/** Whether `lead`/`trail` star counts carry `marker` (a run of exactly 2 is bold, not italic). */
function carries(lead: number, trail: number, marker: "*" | "**") {
  return marker === "**" ? lead >= 2 && trail >= 2 : lead >= 1 && trail >= 1 && lead !== 2 && trail !== 2;
}

/**
 * ⌘B / ⌘I in the poem editor: wrap the selection in `**` / `*`, or unwrap it
 * if it already is (markers just outside the selection, or included in it).
 * Whitespace at the selection's edges stays outside the markers, and a
 * multi-line selection is formatted line by line, since emphasis doesn't
 * cross line breaks.
 */
export function toggleEmphasis(value: string, start: number, end: number, marker: "*" | "**"): TextEdit {
  const m = marker.length;
  const sel = value.slice(start, end);

  if (!sel.includes("\n")) {
    // Markers just outside the selection: unwrap them.
    const lead = trailingStars(value.slice(0, start));
    const trail = leadingStars(value.slice(end));
    if (carries(lead, trail, marker)) {
      return { from: start - m, to: end + m, insert: sel, selStart: start - m, selEnd: end - m };
    }
    const [, ws1, core, ws2] = /^(\s*)(.*?)(\s*)$/.exec(sel)!;
    // Markers included in the selection: unwrap them.
    if (core.length > 2 * m && carries(leadingStars(core), trailingStars(core), marker)) {
      const inner = core.slice(m, -m);
      const s = start + ws1.length;
      return { from: start, to: end, insert: ws1 + inner + ws2, selStart: s, selEnd: s + inner.length };
    }
    // Wrap, keeping edge whitespace outside so the markers still apply.
    const target = core || sel;
    const pre = core ? ws1 : "";
    const post = core ? ws2 : "";
    const s = start + pre.length + m;
    return { from: start, to: end, insert: pre + marker + target + marker + post, selStart: s, selEnd: s + target.length };
  }

  const lines = sel.split("\n").map((l) => /^(\s*)(.*?)(\s*)$/.exec(l)!.slice(1) as [string, string, string]);
  const wrapped = ([, core]: [string, string, string]) =>
    core.length > 2 * m && carries(leadingStars(core), trailingStars(core), marker);
  const filled = lines.filter(([, core]) => core);
  const unwrap = filled.length > 0 && filled.every(wrapped);
  const insert = lines
    .map((l) => {
      const [ws1, core, ws2] = l;
      if (!core) return ws1 + ws2;
      if (unwrap) return ws1 + core.slice(m, -m) + ws2;
      return wrapped(l) ? ws1 + core + ws2 : ws1 + marker + core + marker + ws2;
    })
    .join("\n");
  return { from: start, to: end, insert, selStart: start, selEnd: start + insert.length };
}
