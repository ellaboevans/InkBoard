import { describe, expect, it } from "vitest";
import { contentHeight, SHARE_FORMAT_NAMES, type PoemRow } from "@/lib/share-image/layout";
import { passageParagraphs, pickedRanges, type PassagePick } from "@/lib/share-image/passage";
import {
  layoutPassageImage,
  PASSAGE_MIN_SIZE,
  PASSAGE_MORE_TEXT,
  PASSAGE_SIZES,
  type PassageImageInput,
} from "@/lib/share-image/passage-layout";
import { shareImageFonts } from "@/server/share-image";

/*
 * The passage picture's layout (docs/PLAN.md, Phase 25 round 3), measured
 * with the real font files (the same Measure the renderer uses): it fits each
 * format's safe area, reflows prose, sets scene breaks apart, keeps emphasis,
 * cuts at a sentence with "…" when it must, and puts Gentium first for tone marks.
 */

function input(body: string, pick?: PassagePick, over: Partial<PassageImageInput> = {}): PassageImageInput {
  const paragraphs = passageParagraphs(body);
  const p = pick ?? { from: { p: 1, s: 1 }, to: { p: paragraphs.length, s: paragraphs[paragraphs.length - 1].sentences.length } };
  return {
    novelTitle: "The Ferry at Yeji",
    chapterLine: "Chapter 4 · The Radio",
    paragraphs: pickedRanges(p, paragraphs.map((x) => x.sentences.length)).map(([n, a, b]) => ({
      sceneBreakBefore: paragraphs[n - 1].sceneBreakBefore,
      sentences: paragraphs[n - 1].sentences.slice(a - 1, b),
    })),
    penName: "Ama Sɛwaa",
    language: null,
    host: "tryinkboard.elabo.me",
    path: "/s/k3x9qm",
    ...over,
  };
}

const rowText = (rows: PoemRow[]) =>
  rows.map((r) => (r.kind === "row" ? r.words.map((w) => w.pieces.map((p) => p.text).join("")).join(" ") : `[${r.kind}]`));

/** About 600 characters of ordinary English prose, in three paragraphs. */
const SIX_HUNDRED = [
  "Every Thursday the ferry crossed the lake, and every Thursday Akua waited at the landing with her basket of smoked fish and a pot of groundnut soup wrapped in a cloth.",
  "The radio on the shelf talked to nobody. It talked about rain in the north and prices in the south, and once, late at night, about a boat that had not come home.",
  "She did not turn it off. She sat with it until the lamp burned low and the water outside went quiet, and then she sat a little longer, listening for an engine, for oars, for anything at all that was not the wind moving through the reeds by the shore.",
].join("\n\n");

describe("fitting the safe area", () => {
  it("a passage at the 600-character cap fits a Status at a readable size, whole", async () => {
    const { measure } = await shareImageFonts();
    expect(SIX_HUNDRED.length).toBeGreaterThan(560);
    const layout = layoutPassageImage(input(SIX_HUNDRED), measure, { format: "story" });
    expect(layout.more).toBeNull();
    expect(layout.passage!.shown).toBe(layout.passage!.picked);
    expect(layout.poem.size).toBeGreaterThanOrEqual(PASSAGE_MIN_SIZE);
    expect(layout.height).toBeLessThanOrEqual(contentHeight("story"));
  });

  it("never outgrows either format, short or long; a short passage gets the largest size", async () => {
    const { measure } = await shareImageFonts();
    for (const format of SHARE_FORMAT_NAMES) {
      const short = layoutPassageImage(input("The ferry came late."), measure, { format });
      expect(short.poem.size, format).toBe(PASSAGE_SIZES[0]);
      for (const body of [SIX_HUNDRED, `${SIX_HUNDRED}\n\n${SIX_HUNDRED}\n\n${SIX_HUNDRED}`]) {
        const l = layoutPassageImage(input(body), measure, { format });
        expect(l.height, format).toBeLessThanOrEqual(contentHeight(format));
        // The rows' own heights add up to the passage's height.
        const sum = l.poem.rows.reduce((h, r) => h + (r.kind === "row" ? l.poem.rowHeight : r.kind === "scene" ? l.poem.breakHeight : l.poem.gapHeight), 0);
        expect(sum).toBeCloseTo(l.poem.height, 6);
      }
    }
  });
});

describe("cutting a passage that can't fit", () => {
  it("ends after the last whole sentence that fits, with “…”, and says so ('Read the chapter on InkBoard')", async () => {
    const { measure } = await shareImageFonts();
    const long = `${SIX_HUNDRED}\n\n${SIX_HUNDRED}\n\n${SIX_HUNDRED}`;
    const l = layoutPassageImage(input(long), measure, { format: "chat" });
    expect(l.more).toBe(PASSAGE_MORE_TEXT);
    expect(l.poem.truncated).toBe(true);
    expect(l.passage!.shown).toBeLessThan(l.passage!.picked);
    const text = rowText(l.poem.rows).filter((r) => !r.startsWith("["));
    const last = text[text.length - 1];
    // The kept text ends on a sentence's stop, then the ellipsis.
    expect(last).toMatch(/[.!?] …$/);
    expect(l.height).toBeLessThanOrEqual(contentHeight("chat"));
  });

  it("one sentence too long for any size: its first words, with “…”", async () => {
    const { measure } = await shareImageFonts();
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const l = layoutPassageImage(input(`${words}.`), measure, { format: "chat" });
    expect(l.more).toBe(PASSAGE_MORE_TEXT);
    const text = rowText(l.poem.rows);
    expect(text[0].startsWith("word0 word1")).toBe(true);
    expect(text[text.length - 1]).toMatch(/…$/);
    expect(l.height).toBeLessThanOrEqual(contentHeight("chat"));
  });
});

describe("prose, not verse", () => {
  it("reflows paragraphs, sets them apart, and a scene break inside the pick is a wider gap; one before it isn't drawn", async () => {
    const { measure } = await shareImageFonts();
    const body = "First paragraph.\n\nSecond paragraph.\n\n* * *\n\nAfter the break.";
    const l = layoutPassageImage(input(body), measure);
    expect(rowText(l.poem.rows)).toEqual(["First paragraph.", "[gap]", "Second paragraph.", "[scene]", "After the break."]);
    expect(l.poem.breakHeight).toBeGreaterThan(l.poem.gapHeight);
    // A pick starting right after the break: no gap above it.
    const after = layoutPassageImage(input(body, { from: { p: 3, s: 1 }, to: { p: 3, s: 1 } }), measure);
    expect(rowText(after.poem.rows)).toEqual(["After the break."]);
  });

  it("keeps a kept line break as a new row, the emphasis, and drops the drop-cap marker", async () => {
    const { measure } = await shareImageFonts();
    const l = layoutPassageImage(input("^^Dear Akua,\nthe lake is *wide*."), measure);
    expect(rowText(l.poem.rows)).toEqual(["Dear Akua,", "the lake is wide."]);
    const row = l.poem.rows[1];
    expect(row.kind === "row" && row.words[3].pieces).toEqual([
      { text: "wide", italic: true, bold: false },
      { text: ".", italic: false, bold: false },
    ]);
  });

  it("the frame: the novel's title, the chapter under it, the author and the short address", async () => {
    const { measure } = await shareImageFonts();
    const l = layoutPassageImage(input("The ferry came late."), measure);
    expect(l.kicker).toBeNull();
    expect(l.title.rows).toEqual(["The Ferry at Yeji"]);
    expect(l.subtitle!.rows).toEqual(["Chapter 4 · The Radio"]);
    expect(l.byline.penName).toBe("Ama Sɛwaa");
    expect(l.address.pathRows).toEqual(["/s/k3x9qm"]);
  });
});

describe("Ghanaian letters and tone marks", () => {
  it("sets a passage, a title or a chapter line with ɛ, ɔ or a tone mark in Gentium first", async () => {
    const { measure } = await shareImageFonts();
    const ewe = "Ŋkekea ɖe ɖeka la, èyi ƒuta. Ɛ́ ɖó wò.".normalize("NFC");
    const l = layoutPassageImage(input(ewe, undefined, { novelTitle: "Ʋu la", chapterLine: "Chapter 2 · Ɖe ƒe ŋkɔ" }), measure);
    expect(l.poem.extendedFirst).toBe(true);
    expect(l.title.extendedFirst).toBe(true);
    expect(l.subtitle!.extendedFirst).toBe(true);
    // English stays in Newsreader.
    expect(layoutPassageImage(input("The ferry came late."), measure).poem.extendedFirst).toBe(false);
  });
});
