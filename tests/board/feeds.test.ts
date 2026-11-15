import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { FEED_LIMIT, loadAuthorFeed, loadSiteFeed } from "@/server/feeds";

const db = getDb();
const at = (d: string) => new Date(d);

let savedAppUrl: string | undefined;
beforeEach(() => {
  savedAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://ink.example";
});
afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
});

async function setup() {
  const [wren, ama, newcomer] = await db
    .insert(editors)
    .values([
      { email: "wren-secret@example.com", penName: "Wren Hale", slug: "wren-hale" },
      { email: "ama-secret@example.com", penName: "Ama Ɔdɔ", slug: "ama-odo" },
      // Not onboarded yet (no pen name): never in a feed.
      { email: "newcomer@example.com" },
    ])
    .returning();
  await db.insert(poems).values([
    {
      editorId: wren.id, title: "Rain & <Thunder>", slug: "rain", status: "published",
      body: "first *soft* line\n    indented **loud**\n\n<script>x</script>",
      publishedAt: at("2026-03-01T10:00:00Z"), updatedAt: at("2026-03-05T10:00:00Z"),
    },
    {
      editorId: wren.id, title: "Locked", slug: "locked", status: "published", visibility: "private",
      passwordHash: "x", language: "ak", body: "TOP SECRET VERSE",
      publishedAt: at("2026-02-01T10:00:00Z"), updatedAt: at("2026-02-01T10:00:00Z"),
    },
    { editorId: wren.id, title: "Draft", slug: "draft", body: "draft text" },
    {
      editorId: ama.id, title: "Ŋutifafa", slug: "nutifafa", status: "published", language: "ee",
      body: "Ŋutifafa na wò", publishedAt: at("2026-04-01T10:00:00Z"), updatedAt: at("2026-04-01T10:00:00Z"),
    },
    {
      editorId: newcomer.id, title: "Ghost", slug: "ghost", status: "published",
      body: "ghost text", publishedAt: at("2026-05-01T10:00:00Z"),
    },
  ]);
  return { wren, ama, newcomer };
}

const entries = (xml: string) => xml.split("<entry>").slice(1);

describe("loadSiteFeed", () => {
  it("lists published poems by onboarded authors, newest first", async () => {
    await setup();
    const xml = await loadSiteFeed();
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://ink.example/feed.xml"/>');
    const list = entries(xml);
    expect(list.map((e) => /<title[^>]*>(.*?)<\/title>/.exec(e)![1])).toEqual([
      "Ŋutifafa",
      "Rain &amp; &lt;Thunder&gt;",
      "Locked",
    ]);
    expect(xml).not.toContain("Draft");
    expect(xml).not.toContain("draft text");
    expect(xml).not.toContain("Ghost");
    // The feed is as new as its newest change.
    expect(xml.split("<entry>")[0]).toContain("<updated>2026-04-01T10:00:00Z</updated>");
  });

  it("includes public text with Markdown rendered and everything else escaped", async () => {
    await setup();
    const rain = entries(await loadSiteFeed()).find((e) => e.includes("/p/wren-hale/rain"))!;
    expect(rain).toContain("<author><name>Wren Hale</name><uri>https://ink.example/a/wren-hale</uri></author>");
    expect(rain).toContain("<published>2026-03-01T10:00:00Z</published>");
    expect(rain).toContain("<updated>2026-03-05T10:00:00Z</updated>");
    expect(rain).toContain(
      "&lt;p&gt;first &lt;em&gt;soft&lt;/em&gt; line&lt;br&gt;\n&amp;#160;&amp;#160;&amp;#160;&amp;#160;indented &lt;strong&gt;loud&lt;/strong&gt;&lt;br&gt;\n&lt;br&gt;\n&amp;lt;script&amp;gt;x&amp;lt;/script&amp;gt;&lt;/p&gt;",
    );
    expect(rain).not.toContain("<script>");
  });

  it("never includes a private poem's text, or anyone's email (N1)", async () => {
    await setup();
    const xml = await loadSiteFeed();
    expect(xml).not.toContain("TOP SECRET");
    expect(xml).not.toMatch(/@example\.com|secret@/);
    const locked = entries(xml).find((e) => e.includes("/p/wren-hale/locked"))!;
    expect(locked).toContain('<title type="text" xml:lang="ak">Locked</title>');
    expect(locked).toContain('<content type="text" xml:lang="en">This poem is password protected.');
  });

  it("tags the language per poem", async () => {
    await setup();
    const ewe = entries(await loadSiteFeed()).find((e) => e.includes("nutifafa"))!;
    expect(ewe).toContain('<title type="text" xml:lang="ee">Ŋutifafa</title>');
    expect(ewe).toContain('<content type="html" xml:lang="ee">');
    expect(ewe).toContain('<category term="ee" label="Ewe"/>');
    const rain = entries(await loadSiteFeed()).find((e) => e.includes("/rain"))!;
    expect(rain).not.toContain("xml:lang");
  });

  it(`keeps the newest ${FEED_LIMIT}`, async () => {
    const [e] = await db.insert(editors).values({ email: "many@example.com", penName: "Many", slug: "many" }).returning();
    await db.insert(poems).values(
      Array.from({ length: FEED_LIMIT + 5 }, (_, i) => ({
        editorId: e.id, title: `P${i}`, slug: `p${i}`, body: "x", status: "published" as const,
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    );
    const list = entries(await loadSiteFeed());
    expect(list).toHaveLength(FEED_LIMIT);
    expect(list[0]).toContain(`>P${FEED_LIMIT + 4}<`);
    expect(list.at(-1)).toContain(">P5<");
  });

  it("is a valid empty feed with no poems", async () => {
    const xml = await loadSiteFeed();
    expect(xml).not.toContain("<entry>");
    expect(xml).toMatch(/<updated>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/updated>/);
  });
});

describe("loadAuthorFeed", () => {
  it("has only that author's published poems and a feed-level author", async () => {
    await setup();
    const xml = (await loadAuthorFeed("wren-hale"))!;
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://ink.example/a/wren-hale/feed.xml"/>');
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://ink.example/a/wren-hale"/>');
    expect(xml).toContain('<title type="text">Wren Hale on InkBoard</title>');
    expect(entries(xml)).toHaveLength(2);
    expect(xml).not.toContain("Ŋutifafa");
    expect(xml).not.toContain("TOP SECRET");
    expect(xml).not.toContain("Draft");
    expect(xml).not.toContain("@example.com");
  });

  it("escapes and keeps non-Latin pen names", async () => {
    await setup();
    expect(await loadAuthorFeed("ama-odo")).toContain("<name>Ama Ɔdɔ</name>");
  });

  it("is null for unknown authors and editors who haven't onboarded", async () => {
    await setup();
    expect(await loadAuthorFeed("nobody")).toBeNull();
    await db.insert(editors).values({ email: "half@example.com", slug: "half-done" });
    expect(await loadAuthorFeed("half-done")).toBeNull();
  });

  it("is an empty feed for an author with no published poems", async () => {
    await db.insert(editors).values({ email: "quiet@example.com", penName: "Quiet", slug: "quiet" });
    const xml = (await loadAuthorFeed("quiet"))!;
    expect(xml).not.toContain("<entry>");
    expect(xml).toContain("<author><name>Quiet</name>");
  });
});
