import { HtmlRenderer, Parser } from "commonmark";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProseText } from "@/components/novel/prose-text";
import { proseToMarkdown } from "@/lib/export-format";
import { countWords, normalizeProse, parseProse, stripProse, type ProseBlock } from "@/lib/prose";

/** Blocks as plain strings: paragraphs as their lines (emphasis flattened to *…*), breaks as "⁂". */
const shape = (blocks: ProseBlock[]) =>
  blocks.map((b) =>
    b.kind === "break"
      ? "⁂"
      : b.lines.map((l) => l.map((n) => (typeof n === "string" ? n : `<${n.kind}>`)).join("")),
  );

const markdownHtml = (md: string) => new HtmlRenderer().render(new Parser().parse(md));

describe("chapter prose (Phase 23)", () => {
  it("a blank line starts a paragraph; several blank lines are still one break", () => {
    expect(shape(parseProse("One.\n\nTwo.\n\n\n\nThree."))).toEqual([["One."], ["Two."], ["Three."]]);
  });

  it("a single line break is kept inside its paragraph", () => {
    expect(shape(parseProse("Dear Kwabena,\nthe lake is high.\n\nLove, Akua"))).toEqual([
      ["Dear Kwabena,", "the lake is high."],
      ["Love, Akua"],
    ]);
  });

  it("leading spaces and tabs are dropped (CSS indents paragraphs)", () => {
    expect(shape(parseProse("    Indented.\n\t\tTabbed."))).toEqual([["Indented.", "Tabbed."]]);
  });

  it("a line of only * * * (or ***) is a scene break, even without blank lines around it", () => {
    expect(shape(parseProse("Before.\n\n* * *\n\nAfter."))).toEqual([["Before."], "⁂", ["After."]]);
    expect(shape(parseProse("Before.\n***\nAfter."))).toEqual([["Before."], "⁂", ["After."]]);
    expect(shape(parseProse("Before.\n  * * *  \nAfter."))).toEqual([["Before."], "⁂", ["After."]]);
    // Not breaks: other counts, other characters, text around them.
    expect(shape(parseProse("* *\n****\n- - -\n* * * and more"))).toEqual([["* *", "****", "- - -", "* * * and more"]]);
  });

  it("drops breaks that say nothing: at the start, at the end, or twice in a row", () => {
    expect(shape(parseProse("* * *\n\nOne.\n\n* * *\n\n***\n\nTwo.\n\n* * *"))).toEqual([["One."], "⁂", ["Two."]]);
    expect(parseProse("")).toEqual([]);
    expect(parseProse("* * *")).toEqual([]);
  });

  it("emphasis works as in poems, never across a line break", () => {
    const [p] = parseProse("She said *no*, and **meant** it.\n*not across\nlines*") as [Extract<ProseBlock, { kind: "paragraph" }>];
    expect(p.lines[0]).toEqual(["She said ", { kind: "em", children: ["no"] }, ", and ", { kind: "strong", children: ["meant"] }, " it."]);
    expect(p.lines[1]).toEqual(["*not across"]);
    expect(p.lines[2]).toEqual(["lines*"]);
    expect(stripProse("A \\*literal\\* star and *soft* words.")).toBe("A *literal* star and soft words.");
  });

  it("keeps Ghanaian letters with tone marks, stored as NFC", () => {
    // ɛ́ has no precomposed form: it stays ɛ + U+0301 in NFC. "é" typed decomposed becomes U+00E9.
    const typed = "Asuo yi, wo na wode me ba kɔeɛ́.\n\nAkosua sé: “Ŋkeke ɖeka.”";
    const stored = normalizeProse(typed);
    expect(stored).toBe(stored.normalize("NFC"));
    expect(stored).toContain("sé");
    expect(stored).toContain("ɛ́");
    expect(shape(parseProse(typed))).toEqual([["Asuo yi, wo na wode me ba kɔeɛ́."], ["Akosua sé: “Ŋkeke ɖeka.”"]]);
    expect(countWords(typed)).toBe(12); // 8 + 4
  });

  it("normalises line endings and trims ends, but keeps the text as typed", () => {
    expect(normalizeProse("\r\n\r\n  First line.  \r\nSecond.\t\r\n\r\n\r\n")).toBe("  First line.\nSecond.");
  });

  it("strips to plain text for meta descriptions: paragraphs by blank lines, no scene breaks", () => {
    expect(stripProse("One *two*.\nThree.\n\n* * *\n\n**Four.**")).toBe("One two.\nThree.\n\nFour.");
  });

  it("counts words: tone marks and apostrophes inside words, no stars or breaks", () => {
    expect(countWords("It's *Akua's* radio.\n\n* * *\n\nWell-worn, 1984.")).toBe(5);
    expect(countWords("")).toBe(0);
  });

  it("ProseText: <p> per paragraph with <br> for kept breaks, a named separator, emphasis, numbered paragraphs", () => {
    const html = renderToStaticMarkup(ProseText({ text: "One *two*\nthree.\n\n* * *\n\nFour." }) as never);
    expect(html).toBe(
      '<p data-p="1">One <em>two</em><br/>three.</p>' +
        '<div role="separator" aria-label="Scene break" data-scene-break="true" class="my-6 text-center text-muted-foreground"><span aria-hidden="true">⁂</span></div>' +
        '<p data-p="2">Four.</p>',
    );
    // Text is escaped by React, never HTML.
    expect(renderToStaticMarkup(ProseText({ text: "<b>x</b> & y" }) as never)).toBe("<p data-p=\"1\">&lt;b&gt;x&lt;/b&gt; &amp; y</p>");
  });

  it("the Markdown export renders as readers see it: paragraphs, hard breaks, a rule, emphasis, and syntax escaped", () => {
    const text = "One *two*\nthree.\n\n* * *\n\n# Not a heading\n- not a list\n1. not a number\n\n<i>not html</i> and [no link](x)";
    const md = proseToMarkdown(text);
    expect(markdownHtml(md)).toBe(
      "<p>One <em>two</em><br />\nthree.</p>\n<hr />\n" +
        "<p># Not a heading<br />\n- not a list<br />\n1. not a number</p>\n" +
        "<p>&lt;i&gt;not html&lt;/i&gt; and [no link](x)</p>\n",
    );
    // Words and letters unchanged.
    expect(stripProse(text).replace(/\s+/g, " ")).toContain("Not a heading");
  });
});
