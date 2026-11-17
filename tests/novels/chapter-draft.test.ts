import { describe, expect, it } from "vitest";
import {
  CHAPTER_DRAFT_PREFIX,
  chapterDraftKey,
  parseDraft,
  sameContent,
  serializeDraft,
  shouldOfferDraft,
} from "@/lib/chapter-draft";
import { chapterDisplayTitle } from "@/lib/novel-limits";

describe("the chapter editor's device draft (Phase 23a)", () => {
  it("one key per chapter, under the prefix the Privacy page names", () => {
    expect(chapterDraftKey("abc")).toBe("inkboard-chapter-draft:abc");
    expect(chapterDraftKey("abc").startsWith(CHAPTER_DRAFT_PREFIX)).toBe(true);
  });

  it("round-trips, Ghanaian letters and all", () => {
    const d = { title: "Ŋkeke ɖeka", body: "Akosua sé: “Ɔdɔ.”\n\n* * *\n\nɛ́", at: 1_800_000_000_000 };
    expect(parseDraft(serializeDraft(d))).toEqual(d);
  });

  it("reads anything else as no draft", () => {
    for (const raw of [null, undefined, "", "not json", "null", "[]", '{"v":2,"title":"","body":"","at":1}', '{"v":1,"title":1,"body":"","at":1}', '{"v":1,"title":"","body":"","at":"soon"}']) {
      expect(parseDraft(raw as string | null), String(raw)).toBeNull();
    }
  });

  it("is offered only when newer than the saved chapter and different from it", () => {
    const saved = { title: "One", body: "It began.", updatedAt: 1000 };
    expect(shouldOfferDraft({ title: "One", body: "It began, again.", at: 2000 }, saved)).toBe(true);
    expect(shouldOfferDraft({ title: "Uno", body: "It began.", at: 2000 }, saved)).toBe(true);
    // Older than the last save (say, saved since from another device): not offered.
    expect(shouldOfferDraft({ title: "One", body: "It began, again.", at: 999 }, saved)).toBe(false);
    // The same text (line endings and trailing spaces aside): nothing to restore.
    expect(shouldOfferDraft({ title: "One ", body: "It began.  \r\n", at: 2000 }, saved)).toBe(false);
    expect(shouldOfferDraft(null, saved)).toBe(false);
  });

  it("compares like the server stores", () => {
    expect(sameContent({ title: "A", body: "x\r\ny  \n" }, { title: "A", body: "x\ny" })).toBe(true);
    expect(sameContent({ title: "A", body: "x\n\ny" }, { title: "A", body: "x\ny" })).toBe(false);
  });

  it("an empty title shows as Chapter n", () => {
    expect(chapterDisplayTitle("", 3)).toBe("Chapter 3");
    expect(chapterDisplayTitle("   ", 1)).toBe("Chapter 1");
    expect(chapterDisplayTitle("The Radio", 4)).toBe("The Radio");
  });
});
