import { describe, expect, it } from "vitest";
import {
  boardLanguages,
  filterSectionsByLanguage,
  parseLanguageFilter,
  withLanguageParam,
} from "@/lib/board-filter";
import { layoutBoard } from "@/lib/board-layout";
import type { BoardNovel, BoardPoem, BoardSection } from "@/lib/board-types";

const poem = (id: string, language: string | null, visibility: BoardPoem["visibility"] = "public"): BoardPoem => ({
  id,
  title: id,
  slug: id,
  visibility,
  language,
  excerpt: visibility === "public" ? "text" : null,
  hasMore: false,
  collection: null,
});
const section = (editorId: string, poems: BoardPoem[], novels: BoardNovel[] = []): BoardSection => ({
  editorId,
  penName: editorId,
  slug: editorId,
  picture: { avatarId: "a01", photoKey: null },
  novels,
  poems,
});
const novel = (id: string, language: string | null): BoardNovel => ({
  id,
  title: id,
  slug: id,
  language,
  status: "ongoing",
  visibility: "public",
  coverKey: null,
  blurb: null,
  chapterCount: 1,
  wordCount: 10,
  readingMinutes: 1,
  updatedAt: null,
});

const board = [
  section("a", [poem("a1", "ee"), poem("a2", "en"), poem("a3", null), poem("a4", "ee", "private")]),
  section("b", [poem("b1", "en")]),
  section("c", [poem("c1", "ee")]),
];

describe("boardLanguages", () => {
  it("offers only languages with poems, in the list's order, with counts", () => {
    expect(boardLanguages(board)).toEqual([
      { code: "ee", name: "Ewe", count: 3 },
      { code: "en", name: "English", count: 2 },
    ]);
  });

  it("is empty when no poem is tagged", () => {
    expect(boardLanguages([section("x", [poem("x1", null)])])).toEqual([]);
  });
});

describe("parseLanguageFilter", () => {
  const options = boardLanguages(board);
  it.each([
    ["ee", "ee"],
    ["en", "en"],
    ["gaa", null], // a real language with no poems here
    ["xx", null],
    ["", null],
    ["EE", null],
    [null, null],
    [undefined, null],
  ])("%s → %s", (raw, expected) => {
    expect(parseLanguageFilter(raw, options)).toBe(expected);
  });
});

describe("filterSectionsByLanguage", () => {
  it("returns the board unchanged for All", () => {
    expect(filterSectionsByLanguage(board, null)).toBe(board);
  });

  it("keeps only that language's poems and drops authors left empty", () => {
    const ewe = filterSectionsByLanguage(board, "ee");
    expect(ewe.map((s) => [s.editorId, s.poems.map((p) => p.id)])).toEqual([
      ["a", ["a1", "a4"]],
      ["c", ["c1"]],
    ]);
    // Private poems stay title-only (N1).
    expect(ewe[0].poems[1].excerpt).toBeNull();
    // The input isn't mutated.
    expect(board[0].poems).toHaveLength(4);
  });

  it("lays out again with no gaps for hidden poems or authors", () => {
    const ewe = filterSectionsByLanguage(board, "ee");
    const layout = layoutBoard(ewe);
    const compact = layoutBoard([
      { editorId: "a", poems: [{ id: "a1" }, { id: "a4" }] },
      { editorId: "c", poems: [{ id: "c1" }] },
    ]);
    expect(layout).toEqual(compact);
  });
});

describe("filterSectionsByLanguage with novels (Phase 23b)", () => {
  const withNovels = [
    section("a", [poem("a1", "en")], [novel("n-ee", "ee"), novel("n-en", "en")]),
    section("b", [], [novel("only-ee", "ee")]),
    section("c", [poem("c1", "ee")]),
  ];

  it("keeps a novel by its language like a poem, and an author with only a novel in it", () => {
    const ewe = filterSectionsByLanguage(withNovels, "ee");
    expect(ewe.map((s) => [s.editorId, s.novels.map((n) => n.id), s.poems.map((p) => p.id)])).toEqual([
      ["a", ["n-ee"], []],
      ["b", ["only-ee"], []],
      ["c", [], ["c1"]],
    ]);
  });

  it("puts a section's books in its first card slots, then its poems", () => {
    const [box] = layoutBoard([withNovels[0]]).sections;
    expect(box.books.map((b) => b.novelId)).toEqual(["n-ee", "n-en"]);
    expect(box.cards.map((c) => c.poemId)).toEqual(["a1"]);
    // Three slots in one row of three: the books, then the poem.
    const xs = [...box.books, ...box.cards].map((c) => c.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set([...box.books, ...box.cards].map((c) => c.y)).size).toBe(1);
  });
});

describe("withLanguageParam", () => {
  it("sets, replaces and removes lang, keeping other params", () => {
    expect(withLanguageParam("", "ee")).toBe("?lang=ee");
    expect(withLanguageParam("?lang=en&x=1", "ee")).toBe("?lang=ee&x=1");
    expect(withLanguageParam("?lang=ee", null)).toBe("");
    expect(withLanguageParam("?x=1&lang=ee", null)).toBe("?x=1");
  });
});
