import { HtmlRenderer, Parser } from "commonmark";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProseText } from "@/components/novel/prose-text";
import { proseToMarkdown } from "@/lib/export-format";
import { countWords, normalizeProse, parseProse, stripProse, toggleDropCap, type ProseBlock } from "@/lib/prose";

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

describe("drop caps the writer chose (Phase 24)", () => {
  const caps = (text: string) => parseProse(text).map((b) => (b.kind === "paragraph" ? Boolean(b.dropCap) : "⁂"));

  it("`^^` straight before a paragraph's text marks it, and is gone from the text", () => {
    const blocks = parseProse("^^The stranger did not ask.\n\nHe put the radio down.\n\n* * *\n\n^^That night she listened.");
    expect(caps("^^The stranger did not ask.\n\nHe put the radio down.\n\n* * *\n\n^^That night she listened.")).toEqual([true, false, "⁂", true]);
    expect(shape(blocks)).toEqual([["The stranger did not ask."], ["He put the radio down."], "⁂", ["That night she listened."]]);
  });

  it("is never automatic: unmarked text has no drop cap anywhere (old chapters look as they did)", () => {
    expect(caps("The first paragraph.\n\n* * *\n\nAfter a break.")).toEqual([false, "⁂", false]);
    expect(renderToStaticMarkup(ProseText({ text: "The first paragraph." }) as never)).toBe('<p data-p="1">The first paragraph.</p>');
  });

  it("works after leading spaces and on a scene break's next paragraph; emphasis and quotes may follow it", () => {
    expect(caps("   ^^Indented start.")).toEqual([true]);
    expect(shape(parseProse("^^*Once* upon a time"))).toEqual([["<em> upon a time"]]);
    expect(shape(parseProse("^^“Where did you get this?”"))).toEqual([["“Where did you get this?”"]]);
    expect(caps("^^“Where did you get this?”")).toEqual([true]);
  });

  it("is ordinary text anywhere else: a later line, mid-line, alone, before a space, or tripled", () => {
    for (const text of ["Dear Kwabena,\n^^the lake is high.", "She wrote ^^ back.", "^^", "^^ see you soon", "^^^Three carets", "x\n\n^^\n\ny"]) {
      const out = parseProse(text);
      expect(out.some((b) => b.kind === "paragraph" && b.dropCap), text).toBe(false);
      expect(stripProse(text), text).toContain("^^");
    }
  });

  it("keeps a tone-marked first letter whole and NFC (ɛ́, ɔ̀, Ɔ̃), even when typed decomposed", () => {
    for (const word of ["ɛ́kɔ", "ɔ̀dɔ", "Ɔ̃nɔ"]) {
      const decomposed = `^^${word}`.normalize("NFD");
      const [block] = parseProse(decomposed);
      expect(block.kind === "paragraph" && block.dropCap, word).toBe(true);
      expect(stripProse(decomposed)).toBe(word.normalize("NFC"));
    }
    const html = renderToStaticMarkup(ProseText({ text: "^^ɛ́kɔ ne nsuo" }) as never);
    expect(html).toBe(`<p data-p="1" class="prose-drop-cap" data-drop-cap="">${"ɛ́kɔ ne nsuo".normalize("NFC")}</p>`);
  });

  it("never shows as text: plain text, word counts and the Markdown download drop it", () => {
    const text = "^^The ferry came late.\n\n* * *\n\n^^Akua *waited*.";
    expect(stripProse(text)).toBe("The ferry came late.\n\nAkua waited.");
    expect(countWords(text)).toBe(6);
    const md = proseToMarkdown(text);
    expect(md).not.toContain("^");
    expect(markdownHtml(md)).toBe("<p>The ferry came late.</p>\n<hr />\n<p>Akua <em>waited</em>.</p>\n");
  });
});

describe("the editor's Drop cap button (toggleDropCap)", () => {
  const apply = (text: string, at: number) => {
    const e = toggleDropCap(text, at);
    return e && text.slice(0, e.from) + e.insert + text.slice(e.to);
  };

  it("adds the marker at the start of the paragraph holding the cursor, after its leading spaces", () => {
    const text = "First paragraph.\n\nSecond, line one\nline two.";
    // Cursor on the second paragraph's second line.
    expect(apply(text, text.indexOf("two."))).toBe("First paragraph.\n\n^^Second, line one\nline two.");
    expect(apply("  Indented.", 5)).toBe("  ^^Indented.");
    expect(toggleDropCap("abc", 2)).toMatchObject({ selStart: 4, selEnd: 4 });
  });

  it("removes it when the paragraph has one, and does nothing on a blank line or a scene break", () => {
    expect(apply("^^Marked.", 5)).toBe("Marked.");
    expect(toggleDropCap("^^Marked.", 5)).toMatchObject({ selStart: 3 });
    expect(toggleDropCap("One.\n\nTwo.", 5)).toBeNull();
    expect(toggleDropCap("One.\n* * *\nTwo.", 7)).toBeNull();
  });
});
