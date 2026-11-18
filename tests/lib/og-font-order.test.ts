import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { OgCard } from "@/components/brand/og-card";
import { needsExtendedFont, ogFontFamily } from "@/components/brand/og-type";
import { ShareImage } from "@/components/brand/share-image";
import { SHARE_DESIGN_NAMES } from "@/lib/share-image/designs";
import { IPA_GROUPS, LANGUAGE_SETS, TONE_MARKS } from "@/lib/letter-sets";
import { readFontMetrics } from "@/lib/share-image/font-metrics";
import { layoutShareImage } from "@/lib/share-image/layout";
import { passageParagraphs } from "@/lib/share-image/passage";
import { layoutPassageImage } from "@/lib/share-image/passage-layout";
import { shareImageFonts } from "@/server/share-image";

/*
 * The font-order rule for share cards and the share image (docs/PLAN.md,
 * Phase 21, round 0; src/components/brand/og-type.ts). Satori takes each
 * character from the first font that has it and can't position a tone mark
 * across fonts, so Ghanaian text must be set in Gentium Book Plus first,
 * and English stays in Newsreader. These fail if that order regresses.
 */

const FONTS = join(process.cwd(), "src/assets/fonts");
const cmap = (file: string) => readFontMetrics(readFileSync(join(FONTS, file)));
const NEWSREADER = ["Newsreader.ttf", "Newsreader-Italic.ttf", "NewsreaderText-Regular.ttf", "NewsreaderText-Italic.ttf", "NewsreaderText-Bold.ttf", "NewsreaderText-BoldItalic.ttf"].map(cmap);
const GENTIUM = ["GentiumBookPlus-Regular.ttf", "GentiumBookPlus-Italic.ttf", "GentiumBookPlus-Bold.ttf", "GentiumBookPlus-BoldItalic.ttf"].map(cmap);

const letters = [
  ...LANGUAGE_SETS.flatMap((s) => s.letters.flatMap((k) => [k.char, k.char.toUpperCase()])),
  // The Capitals toggle is for the language tabs only; IPA has no capitals.
  ...IPA_GROUPS.flatMap((g) => g.keys.map((k) => k.char)),
];
const toneMarks = TONE_MARKS.map((t) => t.char);

const EWE = "Nùnyá, àsí mètúnɛ́ ò. Ƒè ɖèká mèɖɔ̀a ŋkɔ́ ò".normalize("NFC");
const ENGLISH = ["Harmattan", "Instructions for the House-Sitter", "“the dry wind” — it’s… 50% café", "by Abla Dzifa", "InkBoard · tryinkboard.elabo.me"];

describe("which text puts Gentium first", () => {
  it("everything Newsreader is trusted with, it really has (every face, every cut)", () => {
    for (let cp = 0x20; cp < 0x3000; cp++) {
      const ch = String.fromCodePoint(cp);
      if (needsExtendedFont(ch)) continue;
      for (const font of NEWSREADER) expect(font.advance(cp), `U+${cp.toString(16)}`).not.toBeNull();
    }
  });

  it("every Ghanaian and IPA letter Newsreader lacks, every tone mark, and ƒ Ƒ (Newsreader's are florins)", () => {
    for (const ch of [...letters, ...toneMarks, "ƒ", "Ƒ"]) {
      const lacking = NEWSREADER.some((f) => f.advance(ch.codePointAt(0)!) === null);
      if (lacking || toneMarks.includes(ch) || /[ƒƑ]/.test(ch)) expect(needsExtendedFont(`a${ch}b`), ch).toBe(true);
    }
    // Any combining mark, on any letter.
    for (let cp = 0x300; cp <= 0x36f; cp++) expect(needsExtendedFont(`e${String.fromCodePoint(cp)}`)).toBe(true);
  });

  it("Gentium has every one of them, in all four styles", () => {
    for (const ch of [...letters, ...toneMarks, "ƒ", "Ƒ"]) {
      for (const font of GENTIUM) expect(font.advance(ch.codePointAt(0)!), ch).not.toBeNull();
    }
  });

  it("English keeps Newsreader; Ewe, Twi and Ga get Gentium first", () => {
    for (const t of ENGLISH) expect(ogFontFamily(t), t).toBe("Newsreader, Gentium Book Plus");
    for (const t of [EWE, "Sankɔfa", "Oyiwala dɔŋŋ", "Selorm Agbɔ", "ƒe"]) expect(ogFontFamily(t), t).toBe("Gentium Book Plus, Newsreader");
    expect(ogFontFamily("Harmattan", "text")).toBe("Newsreader Text, Gentium Book Plus");
    expect(ogFontFamily(EWE, "text")).toBe("Gentium Book Plus, Newsreader Text");
  });
});

/** Every element whose own children include text, with that text and its nearest fontFamily. */
function textNodes(node: ReactNode, family = "", out: { text: string; family: string }[] = []) {
  if (Array.isArray(node)) {
    for (const n of node) textNodes(n, family, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<{ style?: { fontFamily?: string }; children?: ReactNode }>;
  if (typeof el.type === "function") {
    return textNodes((el.type as (p: unknown) => ReactNode)(el.props), family, out);
  }
  const own = el.props.style?.fontFamily ?? family;
  const kids = [el.props.children].flat(Infinity as 1) as ReactNode[];
  const text = kids.filter((k) => typeof k === "string" || typeof k === "number").join("");
  if (text.trim()) out.push({ text, family: own });
  for (const k of kids) textNodes(k, own, out);
  return out;
}

const first = (family: string) => family.split(",")[0].trim();

describe("the share cards (every opengraph-image)", () => {
  it("every card is an OgCard, with no font set on its own", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "opengraph-image.tsx") files.push(p);
      }
    };
    walk(join(process.cwd(), "src/app"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("<OgCard");
      expect(src, f).not.toMatch(/fontFamily/);
    }
  });

  it("an Ewe poem's card sets its title, kicker and quote in Gentium first", () => {
    const nodes = textNodes(OgCard({ kicker: "by Selorm Agbɔ", title: EWE, quote: EWE, footer: "1 poem on InkBoard" }));
    const byText = (t: string) => nodes.find((n) => n.text === t)!;
    expect(first(byText(EWE).family)).toBe("Gentium Book Plus");
    expect(first(byText("by Selorm Agbɔ").family)).toBe("Gentium Book Plus");
    expect(first(byText("1 poem on InkBoard").family)).toBe("Newsreader");
    expect(first(byText("InkBoard").family)).toBe("Newsreader");
    for (const n of nodes) expect(n.family, n.text).toBe(ogFontFamily(n.text));
  });

  it("a novel's card (Phase 23b): the drawn cover's title and pen name follow the same rule", () => {
    const cover = { title: EWE, penName: "Selorm Agbɔ", hue: 140 };
    const nodes = textNodes(OgCard({ cover, kicker: "A novel by Selorm Agbɔ", title: EWE, quote: "Every Thursday", footer: "3 chapters · ongoing · on InkBoard" }));
    const texts = nodes.map((n) => n.text);
    expect(texts).toContain("SELORM AGBƆ");
    for (const n of nodes) expect(n.family, n.text).toBe(ogFontFamily(n.text));
    expect(first(nodes.find((n) => n.text === "SELORM AGBƆ")!.family)).toBe("Gentium Book Plus");
    expect(nodes.filter((n) => n.text === EWE).every((n) => first(n.family) === "Gentium Book Plus")).toBe(true);
    const english = textNodes(OgCard({ cover: { title: "The Ferry", penName: "Ama Serwaa", hue: 20 }, kicker: "Chapter 4", title: "The Radio" }));
    for (const n of english) expect(first(n.family), n.text).toBe("Newsreader");
  });

  it("an English card stays in Newsreader throughout", () => {
    const nodes = textNodes(OgCard({ kicker: "by Abla Dzifa", title: "Harmattan", quote: "the dry wind", footer: "Wander the board." }));
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    for (const n of nodes) expect(first(n.family), n.text).toBe("Newsreader");
  });
});

describe("the share image, in every design (round 3)", () => {
  const input = (title: string, body: string, penName: string) => ({ title, body, penName, language: "Ewe", host: "x.test", path: "/s/k3x9qm" });
  for (const design of SHARE_DESIGN_NAMES) {
    it(`${design}: Ghanaian text in Gentium first, English in Newsreader, whole and as picked lines`, async () => {
      const { measure } = await shareImageFonts();
      for (const picked of [undefined, [1, 2]]) {
        const layout = layoutShareImage(input("Àtí ɖèká".normalize("NFC"), EWE, "Selorm Agbɔ"), measure, { format: "chat", picked });
        const nodes = textNodes(ShareImage({ layout, avatar: null, design }));
        const families = Object.fromEntries(nodes.map((n) => [n.text, first(n.family)]));
        expect(families["Àtí ɖèká".normalize("NFC")]).toBe("Gentium Book Plus");
        expect(families["Selorm Agbɔ"]).toBe("Gentium Book Plus");
        expect(families["mètúnɛ́"]).toBe("Gentium Book Plus");
        expect(families["InkBoard · x.test"]).toBe("Newsreader");
        expect(families["/s/k3x9qm"]).toBe("Newsreader");
        if (picked) expect(families["Lines from"]).toBe("Newsreader");
        // Text that needs Gentium never gets Newsreader first (a block may choose Gentium for all its words).
        for (const n of nodes) if (needsExtendedFont(n.text)) expect(first(n.family), n.text).toBe("Gentium Book Plus");
      }
    });
  }
});

describe("a passage picture, in every design (Phase 25)", () => {
  const passage = (novelTitle: string, chapterLine: string, body: string) => ({
    novelTitle,
    chapterLine,
    paragraphs: passageParagraphs(body),
    penName: "Selorm Agbɔ",
    language: "Ewe",
    host: "x.test",
    path: "/s/k3x9qm",
  });
  for (const design of SHARE_DESIGN_NAMES) {
    it(`${design}: an Ewe passage, its novel's title and chapter line in Gentium first; English in Newsreader`, async () => {
      const { measure } = await shareImageFonts();
      // Long enough on a chat picture to be cut, so "Read the chapter on InkBoard" is in the tree too.
      const body = `${EWE}.\n\n${Array.from({ length: 30 }, () => EWE).join(". ")}.`;
      const layout = layoutPassageImage(passage("Ʋu la".normalize("NFC"), "Chapter 2 · Ɖe ƒe ŋkɔ", body), measure, { format: "chat" });
      expect(layout.more).not.toBeNull();
      const nodes = textNodes(ShareImage({ layout, avatar: null, design }));
      const families = Object.fromEntries(nodes.map((n) => [n.text, first(n.family)]));
      expect(families["Ʋu la".normalize("NFC")]).toBe("Gentium Book Plus");
      expect(families["Chapter 2 · Ɖe ƒe ŋkɔ"]).toBe("Gentium Book Plus");
      expect(families["mètúnɛ́"]).toBe("Gentium Book Plus");
      expect(families["Read the chapter on InkBoard"]).toBe("Newsreader");
      expect(families["/s/k3x9qm"]).toBe("Newsreader");
      for (const n of nodes) if (needsExtendedFont(n.text)) expect(first(n.family), n.text).toBe("Gentium Book Plus");

      const english = layoutPassageImage(passage("The Ferry", "Chapter 4 · The Radio", "The ferry came *late*."), measure);
      const en = Object.fromEntries(textNodes(ShareImage({ layout: english, avatar: null, design })).map((n) => [n.text, first(n.family)]));
      expect(en["The Ferry"]).toBe("Newsreader");
      expect(en["Chapter 4 · The Radio"]).toBe("Newsreader");
      expect(en["late"]).toBe("Newsreader Text");
    });
  }
});

describe("the share image", () => {
  const input = (title: string, body: string, penName: string) => ({ title, body, penName, language: "Ewe", host: "x.test", path: "/p/a/b" });

  it("an Ewe poem: title, lines and pen name in Gentium first; the address in Newsreader", async () => {
    const { measure } = await shareImageFonts();
    const layout = layoutShareImage(input("Àtí ɖèká".normalize("NFC"), EWE, "Selorm Agbɔ"), measure);
    const nodes = textNodes(ShareImage({ layout, avatar: null }));
    const families = Object.fromEntries(nodes.map((n) => [n.text, first(n.family)]));
    expect(families["Àtí ɖèká".normalize("NFC")]).toBe("Gentium Book Plus");
    expect(families["Selorm Agbɔ"]).toBe("Gentium Book Plus");
    expect(families["mètúnɛ́"]).toBe("Gentium Book Plus");
    expect(families["InkBoard · x.test"]).toBe("Newsreader");
  });

  it("an English poem: lines in Newsreader's text cut, the title in its display cut", async () => {
    const { measure } = await shareImageFonts();
    const layout = layoutShareImage(input("Harmattan", "the dry wind\nwrites on every window", "Abla Dzifa"), measure);
    const nodes = textNodes(ShareImage({ layout, avatar: null }));
    const families = Object.fromEntries(nodes.map((n) => [n.text, first(n.family)]));
    expect(families["Harmattan"]).toBe("Newsreader");
    expect(families["window"]).toBe("Newsreader Text");
    expect(families["Abla Dzifa"]).toBe("Newsreader");
  });
});
