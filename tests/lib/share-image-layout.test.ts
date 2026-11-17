import { describe, expect, it } from "vitest";
import {
  ADDRESS,
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  POEM_LINE_HEIGHT,
  POEM_MIN_SIZE,
  POEM_SIZES,
  STANZA_GAP_ROWS,
  TURNOVER_EM,
  layoutShareImage,
  wrapText,
  type Measure,
  type PoemRow,
  type ShareImageInput,
  type ShareImageLayout,
} from "@/lib/share-image/layout";
import { shareImageFonts } from "@/server/share-image";

/*
 * The share image's fitting rule (docs/PLAN.md, Phase 21; the rule itself is
 * in the header of src/lib/share-image/layout.ts). Most cases use a fake
 * monospaced measure (every letter 0.5 em, tone marks 0), so the numbers are
 * easy to follow; the last block uses the real font files.
 */

const mono: Measure = (text, _style, size) => [...text].filter((c) => !/\p{M}/u.test(c)).length * 0.5 * size;

const input = (over: Partial<ShareImageInput>): ShareImageInput => ({
  title: "Harmattan",
  body: "the dry wind",
  penName: "Abla Dzifa",
  language: "English",
  host: "tryinkboard.elabo.me",
  path: "/p/abla-dzifa/harmattan",
  ...over,
});

/** The rows' text, one string per row ("" for a stanza gap). */
const text = (rows: PoemRow[]) =>
  rows.map((r) => (r.kind === "gap" ? "" : r.words.map((w) => w.pieces.map((p) => p.text).join("")).join(" ")));

/** The widest row, measured the way the layout measures. */
function widest(layout: ShareImageLayout, measure: Measure) {
  const style = { cut: "text" as const, italic: false, bold: false, extendedFirst: layout.poem.extendedFirst };
  return Math.max(
    0,
    ...layout.poem.rows.map((r) =>
      r.kind === "gap"
        ? 0
        : r.indent +
          r.words.reduce(
            (x, w) => x + w.gap + w.pieces.reduce((y, p) => y + measure(p.text, { ...style, italic: p.italic, bold: p.bold }, layout.poem.size), 0),
            0,
          ),
    ),
  );
}

/** 4-line stanzas of `chars`-letter lines. */
const stanzas = (count: number, chars = 20) =>
  Array.from({ length: count }, (_, s) => Array.from({ length: 4 }, (_, l) => `s${s}l${l}`.padEnd(chars, "x")).join("\n")).join("\n\n");

describe("size: as large as it can be", () => {
  it("a short poem gets the largest size, whole", () => {
    const l = layoutShareImage(input({ body: "the dry wind\nwrites on every window\nin a dust" }), mono);
    expect(l.poem.size).toBe(POEM_SIZES[0]);
    expect(l.poem.truncated).toBe(false);
    expect(text(l.poem.rows)).toEqual(["the dry wind", "writes on every window", "in a dust"]);
  });

  it("a longer poem steps down, but stays whole while it fits at the minimum", () => {
    const l = layoutShareImage(input({ body: stanzas(2) }), mono);
    expect(l.poem.size).toBeLessThan(POEM_SIZES[0]);
    expect(l.poem.size).toBeGreaterThanOrEqual(POEM_MIN_SIZE);
    expect(l.poem.truncated).toBe(false);
    expect(l.height).toBeLessThanOrEqual(CONTENT_HEIGHT);
    // And it's the largest size that fits: one step up would not.
    const bigger = POEM_SIZES[POEM_SIZES.indexOf(l.poem.size as (typeof POEM_SIZES)[number]) - 1];
    const rows = 8 + 1 * STANZA_GAP_ROWS;
    expect(rows * bigger * POEM_LINE_HEIGHT).toBeGreaterThan(l.poem.height + (CONTENT_HEIGHT - l.height));
  });

  it("shrinks before it wraps one of the poet's lines", () => {
    // 30 letters: one row at 56 px (30 × 28 = 840 ≤ 888), two rows at 60 px and up.
    const l = layoutShareImage(input({ body: `${"a".repeat(30)}\nshort` }), mono);
    expect(l.poem.size).toBe(56);
    expect(l.poem.wrappedLines).toBe(0);
  });

  it("a line too long even at the minimum wraps, its turnover indented, at the largest size that wraps no more", () => {
    const long = Array.from({ length: 12 }, () => "word").join(" "); // 59 letters: two rows at every size (59 × 24 > 888)
    const l = layoutShareImage(input({ body: `${long}\nshort line` }), mono);
    expect(l.poem.size).toBe(POEM_SIZES[0]);
    expect(l.poem.wrappedLines).toBe(1);
    const [first, second] = l.poem.rows as Extract<PoemRow, { kind: "row" }>[];
    expect(first.indent).toBe(0);
    expect(second.indent).toBe(TURNOVER_EM * l.poem.size);
    expect(widest(l, mono)).toBeLessThanOrEqual(CONTENT_WIDTH);
  });

  it("a turnover doesn't hold a lone word when the row above can spare one", () => {
    // Too long for one row at any size, so 72 px (36 px a letter): 5 words, then 4 on the
    // turnover (it starts 1 em in), which would leave "jjjj" alone on a third row.
    const l = layoutShareImage(input({ body: "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj" }), mono);
    expect(l.poem.size).toBe(72);
    expect(text(l.poem.rows)).toEqual(["aaaa bbbb cccc dddd eeee", "ffff gggg hhhh", "iiii jjjj"]);
  });

  it("a word longer than a row is broken between letters, never past the edge", () => {
    const l = layoutShareImage(input({ body: "x".repeat(200) }), mono);
    expect(widest(l, mono)).toBeLessThanOrEqual(CONTENT_WIDTH);
    expect(text(l.poem.rows).join("")).toBe("x".repeat(200));
  });

  it("never splits a letter from its tone mark", () => {
    const word = "ɛ́".repeat(120);
    const l = layoutShareImage(input({ body: word }), mono);
    for (const row of text(l.poem.rows)) expect(row.normalize("NFD")).toMatch(/^(ɛ́)+$/);
  });
});

describe("cutting a long poem", () => {
  it("cuts at a stanza break, then says so", () => {
    const body = stanzas(12);
    const l = layoutShareImage(input({ body }), mono);
    expect(l.poem.truncated).toBe(true);
    expect(l.height).toBeLessThanOrEqual(CONTENT_HEIGHT);
    const shown = body.split("\n").slice(0, l.poem.shownLines);
    // It ends on a stanza's last line: the next line of the poem is a blank one.
    expect(body.split("\n")[l.poem.shownLines]).toBe("");
    expect(shown.at(-1)).toMatch(/^s\d+l3/);
    expect(l.poem.rows.at(-1)?.kind).toBe("row");
  });

  it("the kept stanzas get the largest size that fits them", () => {
    // Two short stanzas, then a long one that can't fit: only the first two are kept, at a size above the minimum.
    const body = `${stanzas(2, 10)}\n\n${Array.from({ length: 40 }, (_, i) => `long stanza line ${i}`).join("\n")}`;
    const l = layoutShareImage(input({ body }), mono);
    expect(l.poem.truncated).toBe(true);
    expect(l.poem.shownLines).toBe(9);
    expect(l.poem.size).toBeGreaterThan(POEM_MIN_SIZE);
  });

  it("with no stanza break in reach, whole lines, ending a sentence when one is near", () => {
    const lines = Array.from({ length: 40 }, (_, i) => (i % 3 === 2 ? `line ${i} ends here.` : `line ${i} goes on`));
    const l = layoutShareImage(input({ body: lines.join("\n") }), mono);
    expect(l.poem.truncated).toBe(true);
    expect(lines[l.poem.shownLines - 1]).toMatch(/\.$/);
    expect(l.height).toBeLessThanOrEqual(CONTENT_HEIGHT);
  });

  it("a single line too long for the whole image ends with …", () => {
    const l = layoutShareImage(input({ body: Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ") }), mono);
    expect(l.poem.truncated).toBe(true);
    expect(text(l.poem.rows).at(-1)).toMatch(/…$/);
    expect(l.height).toBeLessThanOrEqual(CONTENT_HEIGHT);
  });
});

describe("indentation, blank lines and Markdown", () => {
  it("keeps leading indentation (a tab is four spaces) and every blank line between stanzas", () => {
    const l = layoutShareImage(input({ body: "\n\none\n    two\n\tthree\n\n\nfour\n\n" }), mono);
    const rows = l.poem.rows;
    expect(text(rows)).toEqual(["one", "two", "three", "", "", "four"]);
    const space = mono(" ", { cut: "text", italic: false, bold: false, extendedFirst: false }, l.poem.size);
    expect(rows.map((r) => (r.kind === "row" ? r.indent : null))).toEqual([0, 4 * space, 4 * space, null, null, 0]);
  });

  it("keeps the poet's spacing inside a line", () => {
    const l = layoutShareImage(input({ body: "wait    here" }), mono);
    const row = l.poem.rows[0] as Extract<PoemRow, { kind: "row" }>;
    expect(row.words[1].gap).toBe(4 * 0.5 * l.poem.size);
  });

  it("*italic*, **bold** and ***both*** stay on their words, even inside one", () => {
    const l = layoutShareImage(input({ body: "*Do* believe **the** un*break*able ***ants***" }), mono);
    const row = l.poem.rows[0] as Extract<PoemRow, { kind: "row" }>;
    expect(row.words.map((w) => w.pieces.map((p) => [p.text, p.italic, p.bold]))).toEqual([
      [["Do", true, false]],
      [["believe", false, false]],
      [["the", false, true]],
      [
        ["un", false, false],
        ["break", true, false],
        ["able", false, false],
      ],
      [["ants", true, true]],
    ]);
  });
});

describe("title, byline and address", () => {
  it("a long title gets at most three rows, cut at a word with …", () => {
    const title = "Instructions for the House-Sitter, Including Several Things I Forgot to Mention About the Mango Tree";
    const l = layoutShareImage(input({ title }), mono);
    expect(l.title.rows.length).toBeLessThanOrEqual(3);
    expect(l.title.rows.at(-1)).toMatch(/[a-z]…$/i);
    // Every word shown is a whole word of the title.
    const words = l.title.rows.join(" ").replace(/…$/, "").split(" ");
    for (const w of words) expect(title.split(" ")).toContain(w);
    for (const r of l.title.rows) expect(mono(r, { cut: "display", italic: false, bold: false, extendedFirst: false }, l.title.size)).toBeLessThanOrEqual(CONTENT_WIDTH);
  });

  it("a short title is large and whole", () => {
    const l = layoutShareImage(input({ title: "Nùnyá" }), mono);
    expect(l.title).toMatchObject({ size: 84, rows: ["Nùnyá"], extendedFirst: false });
  });

  it("a long address wraps after / and -, and never runs off the image", () => {
    const path = "/p/an-author-with-a-remarkably-long-pen-name-that-go/a-very-long-slug-that-the-editor-chose-for-this-poem-12";
    const l = layoutShareImage(input({ path }), mono);
    expect(l.address.pathRows.join("")).toBe(path);
    expect(l.address.pathRows.length).toBeGreaterThan(1);
    expect(l.address.pathRows.length).toBeLessThanOrEqual(3);
    for (const r of l.address.pathRows) {
      expect(mono(r, { cut: "display", italic: false, bold: false, extendedFirst: false }, ADDRESS.path)).toBeLessThanOrEqual(CONTENT_WIDTH - ADDRESS.logo - ADDRESS.gap);
    }
    expect(l.address.host).toBe("InkBoard · tryinkboard.elabo.me");
  });

  it("a very long pen name is cut to one row", () => {
    const l = layoutShareImage(input({ penName: "An Author With A Remarkably Long Pen Name That Goes On And On" }), mono);
    expect(l.byline.penName).toMatch(/…$/);
  });

  it("wrapText keeps short text as one row", () => {
    expect(wrapText("one two", { maxWidth: 1000, maxRows: 1, width: (s) => s.length })).toEqual({ rows: ["one two"], truncated: false });
  });
});

describe("with the real fonts", () => {
  const fixtures: Record<string, Partial<ShareImageInput>> = {
    ewe: { title: "Nùnyá", body: "Nùnyá, àdìdòé,\nàsí mètúnɛ́ ò.\nƑè ɖèká mèɖɔ̀a ŋkɔ́ ò,\nʋɔ̀ ɣè dzí ɖè.\n\n*Knowledge is a baobab tree:*\n*no one pair of arms can hold it.*", penName: "Selorm Agbɔ", language: "Ewe" },
    twi: { title: "Sankɔfa", body: "Sɛ wo werɛ fi na wosankɔfa a,\nyɛnkyiri.", penName: "Ama Sɛwaa", language: "Akan" },
    ga: { title: "Oyiwala dɔŋŋ", body: "Oyiwala dɔŋŋ,\nAtaa Naa Nyɔŋmɔ,\noyiwala dɔŋŋ.", language: "Ga" },
    long: { body: stanzas(30, 48) },
  };
  for (const [name, over] of Object.entries(fixtures)) {
    it(`${name}: fits the safe area, every row within the width`, async () => {
      const { measure } = await shareImageFonts();
      const l = layoutShareImage(input({ ...over, body: over.body!.normalize("NFC") }), measure);
      expect(l.height).toBeLessThanOrEqual(CONTENT_HEIGHT);
      expect(widest(l, measure)).toBeLessThanOrEqual(CONTENT_WIDTH);
      expect(l.poem.size).toBeGreaterThanOrEqual(POEM_MIN_SIZE);
      if (name !== "long") expect(l.poem.size).toBe(POEM_SIZES[0]);
      expect(l.poem.extendedFirst).toBe(name !== "long");
    });
  }
});
