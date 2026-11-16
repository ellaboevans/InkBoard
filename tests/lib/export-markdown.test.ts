import { HtmlRenderer, Parser } from "commonmark";
import { describe, expect, it } from "vitest";
import { exportToJson, exportToMarkdown, plainTextToMarkdown, poemTextToMarkdown, type EditorExport } from "@/lib/export-format";
import { stripPoemMarkdown } from "@/lib/poem-markdown";

/*
 * The Markdown download keeps a poem's lines, stanzas and indentation when a
 * Markdown viewer renders it (docs/PLAN.md, Phase 19). Rendered here with
 * commonmark.js, the CommonMark reference implementation.
 */

const NBSP = "\u00a0";
const render = (md: string) => new HtmlRenderer().render(new Parser().parse(md));

const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The rendered stanzas: each <p> split at its <br />s into lines of plain text. */
function renderedStanzas(md: string): string[][] {
  const html = render(md);
  // Nothing but paragraphs: no lists, headings, rules, quotes, code or HTML.
  expect(html.replace(/<p>[\s\S]*?<\/p>\n?/g, ""), html).toBe("");
  return [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].split(/<br \/>\n?/).map(decode));
}

/** What InkBoard shows: stanzas of lines, indentation kept (as no-break spaces here), emphasis as plain text. */
function expectedStanzas(text: string): string[][] {
  return text
    .trim()
    .split(/\n(?:[ \t]*\n)+/)
    .map((stanza) =>
      stanza.split("\n").map((line) => {
        const indent = /^[ \t]*/.exec(line)![0];
        return indent.replace(/\t/g, "    ").replace(/ /g, NBSP) + stripPoemMarkdown(line.slice(indent.length)).trimEnd();
      }),
    );
}

// Ewe and Twi with their letters and tone marks (combining accents on ɛ and ɔ have no precomposed form).
const POEM = [
  "Ŋkeke ɖeka le Keta",
  "  ɛ́yae nye *ŋkɔ* si",
  "    wòyɔ **dzidzɔ** gbe",
  "",
  "Ɔdɔ, wo ho yɛ fɛ",
  "\tƆ̀kɔ́ ne Ɛ̀ʋɛ",
  "",
  "",
  "Last stanza, after two blank lines.",
].join("\n").normalize("NFC");

describe("poem text in the Markdown download", () => {
  it("renders every line on its own line, stanzas as paragraphs, indentation kept, letters and tone marks intact", () => {
    const md = poemTextToMarkdown(POEM);
    expect(renderedStanzas(md)).toEqual(expectedStanzas(POEM));
    // The poem's own light Markdown still renders as emphasis.
    expect(render(md)).toContain("<em>ŋkɔ</em>");
    expect(render(md)).toContain("<strong>dzidzɔ</strong>");
    expect(render(md)).toContain("Ɔ̀kɔ́ ne Ɛ̀ʋɛ".normalize("NFC"));
  });

  it("reads well as plain text: the same lines in the same places, with only invisible differences", () => {
    const md = poemTextToMarkdown(POEM);
    const lines = md.split("\n");
    // Line for line: blank lines stay blank, other lines differ only by trailing
    // spaces (the hard breaks) and no-break spaces in place of indentation.
    expect(lines).toHaveLength(POEM.split("\n").length);
    POEM.split("\n").forEach((original, i) => {
      expect(lines[i].replace(/ +$/, "").replaceAll(NBSP, " "), `line ${i + 1}`).toBe(original.replace("\t", "    "));
    });
    // Hard breaks inside stanzas only, never before a blank line or at the end.
    expect(lines.map((l) => l.endsWith("  "))).toEqual([true, true, false, false, true, false, false, false, false]);
  });

  it("keeps lines that look like Markdown as the poet wrote them", () => {
    const text = [
      "# not a heading",
      "- not a list",
      "+ nor this",
      "1. nor a numbered list",
      "> nor a quote",
      "* * *",
      "---",
      "===",
      "<b>not HTML</b> & &amp; stay as typed",
      "[not a link](https://example.com) or ![an image](x.png)",
      "`not code` and a | pipe",
      "snake_case stays, _but this_ isn't italic, nor ~this~",
      "2 * 3 = 6, a stray * and *unclosed",
      "C:\\path\\* and a trailing backslash\\",
      "    four spaces in, not a code block",
    ].join("\n");
    const md = poemTextToMarkdown(text);
    expect(renderedStanzas(md)).toEqual(expectedStanzas(text));
  });

  it("writes plain text with no escapes when nothing needs them", () => {
    expect(poemTextToMarkdown("one\ntwo\n\nthree")).toBe("one  \ntwo\n\nthree");
    expect(poemTextToMarkdown("* * *\n2 * 3")).toBe("\\* * *  \n2 * 3");
    expect(poemTextToMarkdown("\r\n\r\nWindows\r\nline ends\r\n\r\n")).toBe("Windows  \nline ends");
  });

  it("bios and collection intros keep their line breaks, and an asterisk there is just an asterisk", () => {
    const html = render(plainTextToMarkdown("Poet from Ho.\n*Writes at night*"));
    expect(html).toBe("<p>Poet from Ho.<br />\n*Writes at night*</p>\n");
  });
});

describe("the whole Markdown file", () => {
  const data: EditorExport = {
    format: "inkboard-export",
    version: 1,
    exportedAt: "2026-11-16T10:00:00.000Z",
    site: "https://inkboard.example",
    profile: {
      penName: "Selorm Agbɔ",
      slug: "selorm-agbo",
      tagline: null,
      bio: "From Keta.\nWrites in Ewe.",
      links: [],
      avatar: null,
      pinnedPoemId: null,
      joinedAt: "2026-01-01T00:00:00.000Z",
    },
    collections: [],
    poems: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Ŋkeke ɖeka",
        slug: "nkeke-deka",
        text: POEM,
        language: "ee",
        visibility: "public",
        status: "published",
        publishedAt: "2026-02-01T00:00:00.000Z",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
        collection: null,
        revisions: [],
      },
    ],
  };

  it("renders the poem's stanzas and lines under its heading, and the bio's lines too", () => {
    const html = render(exportToMarkdown(data));
    expect(html).toContain("<h3>Ŋkeke ɖeka</h3>");
    expect(html).toContain("<p>From Keta.<br />\nWrites in Ewe.</p>");
    const after = html.slice(html.indexOf("</ul>") + "</ul>".length);
    const stanzas = [...after.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].split(/<br \/>\n?/).map(decode));
    expect(stanzas).toEqual(expectedStanzas(POEM));
  });

  it("leaves the JSON download's text exactly as stored", () => {
    expect(JSON.parse(exportToJson(data)).poems[0].text).toBe(POEM);
  });
});
