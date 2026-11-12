import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { cardExcerpt, normalizePoemBody } from "@/lib/poem-text";
import { loadBoardSections } from "@/server/board";

const db = getDb();

// The editor's live card preview must show exactly what the board will.
describe("card preview excerpt matches the board", () => {
  const bodies = {
    short: "one line",
    stanzas: "first\nsecond\n\n  indented third\n\nfifth",
    sixLines: "1\n2\n3\n4\n5\n6",
    exactlyFive: "a\nb\nc\nd\ne",
    longLine: "x".repeat(300),
    longLines: Array.from({ length: 5 }, (_, i) => `${i} ${"word ".repeat(15)}`).join("\n"),
    emoji: "🌙".repeat(285) + "\nmore",
    accents: "José señor café\n\tTabbed line",
  };

  it("for every kind of body", async () => {
    const [e] = await db
      .insert(editors)
      .values({ email: "x@x.com", penName: "Ex", slug: "ex" })
      .returning();
    await db.insert(poems).values(
      Object.entries(bodies).map(([slug, body]) => ({
        editorId: e.id,
        title: slug,
        slug,
        body: normalizePoemBody(body),
        status: "published" as const,
        publishedAt: new Date(),
      })),
    );
    const board = (await loadBoardSections())[0].poems;
    for (const [slug, body] of Object.entries(bodies)) {
      const card = board.find((p) => p.slug === slug)!;
      expect(cardExcerpt(normalizePoemBody(body)), slug).toEqual({ excerpt: card.excerpt, hasMore: card.hasMore });
    }
  });

  it("normalises like the server: line endings, leading blank lines, trailing space", () => {
    expect(normalizePoemBody("\n\n  \r\nfirst\r\n  second  \r\n\n")).toBe("first\n  second");
    expect(cardExcerpt("")).toEqual({ excerpt: "", hasMore: false });
  });
});
