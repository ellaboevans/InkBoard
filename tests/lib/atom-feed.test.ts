import { describe, expect, it } from "vitest";
import { buildAtomFeed, escapeXml, poemToHtml, PRIVATE_ENTRY_TEXT, type Feed, type FeedEntry } from "@/lib/atom-feed";

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Rain",
  url: "https://ink.example/p/wren/rain",
  penName: "Wren",
  authorUrl: "https://ink.example/a/wren",
  visibility: "public",
  language: null,
  body: "drops",
  published: new Date("2026-03-01T10:00:00.123Z"),
  updated: new Date("2026-03-02T11:00:00Z"),
  ...over,
});
const feed = (entries: FeedEntry[], over: Partial<Feed> = {}): string =>
  buildAtomFeed({
    selfUrl: "https://ink.example/feed.xml",
    pageUrl: "https://ink.example/",
    title: "InkBoard",
    subtitle: "New poems",
    iconUrl: "https://ink.example/icon.svg",
    emptyUpdated: new Date("2026-01-01T00:00:00Z"),
    entries,
    ...over,
  });
/** The HTML inside <content type="html">, unescaped once (as a feed reader would). */
const contentHtml = (xml: string) =>
  /<content type="html"[^>]*>([\s\S]*?)<\/content>/.exec(xml)![1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

describe("escapeXml", () => {
  it("escapes markup and drops characters XML 1.0 forbids", () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;");
    expect(escapeXml("a\u0000b\u0008c\u000Bd￾e\tf\ng")).toBe("abcde\tf\ng");
    expect(escapeXml("lone \uD800 high")).toBe("lone  high");
    expect(escapeXml("Ɔdɔ ŋ 😀")).toBe("Ɔdɔ ŋ 😀");
  });
});

describe("poemToHtml", () => {
  it("keeps line breaks, blank lines and indentation", () => {
    expect(poemToHtml("one\n    two\n\nthree  four")).toBe(
      "<p>one<br>\n&#160;&#160;&#160;&#160;two<br>\n<br>\nthree &#160;four</p>",
    );
  });

  it("renders the light Markdown and escapes everything else", () => {
    expect(poemToHtml("*soft* and **loud** and ***both***, \\*literal\\*")).toBe(
      "<p><em>soft</em> and <strong>loud</strong> and <em><strong>both</strong></em>, *literal*</p>",
    );
    expect(poemToHtml(`<script>alert("x")</script> & <b>bold</b>`)).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;</p>",
    );
    // Emphasis around markup still escapes the markup inside.
    expect(poemToHtml("*<img src=x onerror=alert(1)>*")).toBe("<p><em>&lt;img src=x onerror=alert(1)&gt;</em></p>");
    expect(poemToHtml("* * *")).toBe("<p>* * *</p>");
  });

  it("normalises Windows line endings", () => {
    expect(poemToHtml("a\r\nb")).toBe("<p>a<br>\nb</p>");
  });
});

describe("buildAtomFeed", () => {
  it("writes a feed with self/alternate links and an entry per poem", () => {
    const xml = feed([entry()]);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">')).toBe(true);
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://ink.example/feed.xml"/>');
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://ink.example/"/>');
    expect(xml).toContain("<id>urn:uuid:11111111-1111-4111-8111-111111111111</id>");
    expect(xml).toContain('<title type="text">Rain</title>');
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://ink.example/p/wren/rain"/>');
    expect(xml).toContain("<author><name>Wren</name><uri>https://ink.example/a/wren</uri></author>");
    expect(xml).toContain("<published>2026-03-01T10:00:00Z</published>");
    expect(xml).toContain("<updated>2026-03-02T11:00:00Z</updated>");
    expect(contentHtml(xml)).toBe("<p>drops</p>");
    expect(xml.trimEnd().endsWith("</feed>")).toBe(true);
  });

  it("uses the newest entry for the feed's updated, or emptyUpdated with no entries", () => {
    const xml = feed([entry({ updated: new Date("2026-03-02T00:00:00Z") }), entry({ id: "b", updated: new Date("2026-05-05T00:00:00Z") })]);
    expect(xml.split("<entry>")[0]).toContain("<updated>2026-05-05T00:00:00Z</updated>");
    const empty = feed([]);
    expect(empty).toContain("<updated>2026-01-01T00:00:00Z</updated>");
    expect(empty).not.toContain("<entry>");
  });

  it("marks the language on the poem's title and text only, with a category", () => {
    const xml = feed([entry({ language: "ee", body: "Ŋutifafa" })]);
    expect(xml).toContain('<title type="text" xml:lang="ee">Rain</title>');
    expect(xml).toContain('<content type="html" xml:lang="ee">');
    expect(xml).toContain('<category term="ee" label="Ewe"/>');
    expect(feed([entry()])).not.toContain("<category");
  });

  it("gives private poems a fixed English line and never any text (N1)", () => {
    // Even if a body slipped through, a private entry ignores it.
    const xml = feed([entry({ visibility: "private", language: "ak", body: "TOP SECRET VERSE" })]);
    expect(xml).not.toContain("TOP SECRET");
    expect(xml).not.toContain('type="html"');
    expect(xml).toContain(`<content type="text" xml:lang="en">${PRIVATE_ENTRY_TEXT}</content>`);
    expect(xml).toContain('<title type="text" xml:lang="ak">Rain</title>');
  });

  it("escapes titles, names and URLs", () => {
    const xml = feed([entry({ title: "</title><x>&", penName: `A "B" <C>`, url: "https://ink.example/p/a/b?x=1&y=2" })], {
      title: "Ink & <Board>",
    });
    expect(xml).toContain('<title type="text">&lt;/title&gt;&lt;x&gt;&amp;</title>');
    expect(xml).toContain("<name>A &quot;B&quot; &lt;C&gt;</name>");
    expect(xml).toContain('href="https://ink.example/p/a/b?x=1&amp;y=2"');
    expect(xml).toContain('<title type="text">Ink &amp; &lt;Board&gt;</title>');
    expect(xml).not.toContain("<x>");
  });

  it("double-escapes HTML content so it survives as one XML text node", () => {
    const xml = feed([entry({ body: "a & b <i>" })]);
    expect(xml).toContain("&lt;p&gt;a &amp;amp; b &amp;lt;i&amp;gt;&lt;/p&gt;");
    expect(contentHtml(xml)).toBe("<p>a &amp; b &lt;i&gt;</p>");
  });
});
