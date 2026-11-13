import { describe, expect, it } from "vitest";
import { parsePoem, parsePoemLine, stripPoemMarkdown, toggleEmphasis, type PoemNode } from "@/lib/poem-markdown";

/** Nodes as compact HTML-ish text, for readable assertions. */
function html(nodes: PoemNode[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : `<${n.kind}>${html(n.children)}</${n.kind}>`)).join("");
}
const line = (s: string, closeAtEnd = false) => html(parsePoemLine(s, closeAtEnd));

describe("parsePoemLine", () => {
  it("italic, bold and both", () => {
    expect(line("a *moth* rehearses")).toBe("a <em>moth</em> rehearses");
    expect(line("**its one** argument")).toBe("<strong>its one</strong> argument");
    expect(line("***loud***")).toBe("<em><strong>loud</strong></em>");
    expect(line("***a* b**")).toBe("<strong><em>a</em> b</strong>");
    expect(line("*a **b** c*")).toBe("<em>a <strong>b</strong> c</em>");
    expect(line("**a *b* c**")).toBe("<strong>a <em>b</em> c</strong>");
  });

  it("works inside words and next to punctuation", () => {
    expect(line("un*break*able")).toBe("un<em>break</em>able");
    expect(line('"*quoted*", she said')).toBe('"<em>quoted</em>", she said');
  });

  it("leaves stanza breaks, arithmetic and lone stars alone", () => {
    for (const s of ["* * *", "*", "**", "2 * 3 = 6", "a * b * c", "* bullet", "trailing *", "** spaced **"]) {
      expect(line(s)).toBe(s);
    }
  });

  it("keeps unmatched markers literal", () => {
    expect(line("*open only")).toBe("*open only");
    expect(line("**half*")).toBe("*<em>half</em>");
  });

  it("\\* is a literal asterisk", () => {
    expect(line("\\*not italic\\*")).toBe("*not italic*");
    expect(line("*a \\* b*")).toBe("<em>a * b</em>");
    expect(line("back\\slash")).toBe("back\\slash");
  });

  it("keeps indentation and spacing", () => {
    expect(line("    *indented*  twice")).toBe("    <em>indented</em>  twice");
  });

  it("closeAtEnd closes emphasis cut off by an excerpt", () => {
    expect(line("a *moth reh", true)).toBe("a <em>moth reh</em>");
    expect(line("**bold and *both", true)).toBe("<strong>bold and <em>both</em></strong>");
    expect(line("a *moth reh")).toBe("a *moth reh");
  });
});

describe("parsePoem", () => {
  it("emphasis never crosses a line break", () => {
    expect(parsePoem("*one\ntwo*").map(html)).toEqual(["*one", "two*"]);
  });

  it("only the last line of a truncated excerpt is closed", () => {
    expect(parsePoem("*one\n*two", { truncated: true }).map(html)).toEqual(["*one", "<em>two</em>"]);
  });

  it("handles a long line of markers quickly", () => {
    const t = performance.now();
    parsePoem("*a ".repeat(10_000) + "b*");
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("stripPoemMarkdown", () => {
  it("removes markers, keeps literal stars and lines", () => {
    expect(stripPoemMarkdown("a *moth*\n**its one** argument\n* * *\n\\*not italic\\*")).toBe(
      "a moth\nits one argument\n* * *\n*not italic*",
    );
  });
});

describe("toggleEmphasis", () => {
  /** Applies the edit; `[` and `]` mark the selection before and after. */
  function run(marked: string, marker: "*" | "**") {
    const start = marked.indexOf("[");
    const end = marked.indexOf("]") - 1;
    const value = marked.replace("[", "").replace("]", "");
    const e = toggleEmphasis(value, start, end, marker);
    const out = value.slice(0, e.from) + e.insert + value.slice(e.to);
    return out.slice(0, e.selStart) + "[" + out.slice(e.selStart, e.selEnd) + "]" + out.slice(e.selEnd);
  }

  it("wraps and unwraps", () => {
    expect(run("a [moth] b", "*")).toBe("a *[moth]* b");
    expect(run("a *[moth]* b", "*")).toBe("a [moth] b");
    expect(run("a [moth] b", "**")).toBe("a **[moth]** b");
    expect(run("a **[moth]** b", "**")).toBe("a [moth] b");
  });

  it("italic inside bold adds a marker instead of eating one", () => {
    expect(run("**[moth]**", "*")).toBe("***[moth]***");
    expect(run("***[moth]***", "*")).toBe("**[moth]**");
    expect(run("***[moth]***", "**")).toBe("*[moth]*");
  });

  it("unwraps markers included in the selection", () => {
    expect(run("a [*moth*] b", "*")).toBe("a [moth] b");
    expect(run("a [**moth**] b", "**")).toBe("a [moth] b");
    expect(run("a [**moth**] b", "*")).toBe("a *[**moth**]* b");
  });

  it("keeps edge whitespace outside the markers", () => {
    expect(run("a [moth ]b", "*")).toBe("a *[moth]* b");
  });

  it("an empty selection inserts a pair, and toggling again removes it", () => {
    expect(run("a [] b", "*")).toBe("a *[]* b");
    expect(run("a *[]* b", "*")).toBe("a [] b");
  });

  it("formats a multi-line selection line by line", () => {
    expect(run("[one\n\n  two]", "*")).toBe("[*one*\n\n  *two*]");
    expect(run("[*one*\n\n  *two*]", "*")).toBe("[one\n\n  two]");
    expect(run("[*one*\ntwo]", "*")).toBe("[*one*\n*two*]");
  });
});
