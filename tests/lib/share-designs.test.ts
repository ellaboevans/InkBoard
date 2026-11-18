import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ShareImage } from "@/components/brand/share-image";
import { SHARE_DESIGNS, SHARE_DESIGN_NAMES } from "@/lib/share-image/designs";
import { layoutShareImage, type ShareImageInput } from "@/lib/share-image/layout";
import { passageParagraphs } from "@/lib/share-image/passage";
import { layoutPassageImage } from "@/lib/share-image/passage-layout";
import { shareImageFonts } from "@/server/share-image";

/*
 * The share image's designs (docs/PLAN.md, Phase 21 round 3): every text
 * colour on what it sits on, measured (WCAG 2 contrast ratio). Each text is
 * found by walking the picture's real tree, so a colour added to the picture
 * is checked too: at least 4.5:1, and 7:1 for the poem's own lines.
 */

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

type Styled = ReactElement<{ style?: { color?: string; fontSize?: number }; children?: ReactNode }>;

/** Every text in the tree with its nearest colour, and whether it's in the poem's rows (their font size is the poem's). */
function texts(node: ReactNode, color = "", out: { text: string; color: string }[] = []) {
  if (Array.isArray(node)) {
    for (const n of node) texts(n, color, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as Styled;
  if (typeof el.type === "function") return texts((el.type as (p: unknown) => ReactNode)(el.props), color, out);
  const own = el.props.style?.color ?? color;
  const kids = [el.props.children].flat(Infinity as 1) as ReactNode[];
  const text = kids.filter((k) => typeof k === "string").join("");
  if (text.trim()) out.push({ text, color: own });
  for (const k of kids) texts(k, own, out);
  return out;
}

const INPUT: ShareImageInput = {
  title: "Nùnyá",
  body: ["Nùnyá, àdìdòé,", "àsí mètúnɛ́ ò.", "", "*Knowledge is a baobab tree:*", ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join("\n").normalize("NFC"),
  penName: "Selorm Agbɔ",
  language: "Ewe",
  host: "tryinkboard.elabo.me",
  path: "/s/k3x9qm",
};

describe("contrast, measured on each design's real tree", () => {
  for (const design of SHARE_DESIGN_NAMES) {
    it(`${design}: every text ≥ 4.5:1 on what it sits on, the poem ≥ 7:1`, async () => {
      const look = SHARE_DESIGNS[design];
      const { measure } = await shareImageFonts();
      // A cut poem (so "Read the whole poem" is drawn) and a quote with a skip ("Lines from", "…").
      const whole = layoutShareImage(INPUT, measure);
      const quote = layoutShareImage(INPUT, measure, { picked: [1, 4] });
      // A passage (Phase 25), long enough to be cut, with a scene break.
      const passage = layoutPassageImage(
        {
          novelTitle: INPUT.title,
          chapterLine: "Chapter 4 · The Radio",
          paragraphs: passageParagraphs(`First paragraph.\n\n* * *\n\n${Array.from({ length: 80 }, (_, i) => `Sentence ${i}.`).join(" ")}`),
          penName: INPUT.penName,
          language: INPUT.language,
          host: INPUT.host,
          path: INPUT.path,
        },
        measure,
        { format: "chat" },
      );
      expect(whole.poem.truncated).toBe(true);
      expect(passage.more).toBe("Read the chapter on InkBoard");
      const found = [
        ...texts(ShareImage({ layout: whole, avatar: null, design })),
        ...texts(ShareImage({ layout: quote, avatar: null, design })),
        ...texts(ShareImage({ layout: passage, avatar: null, design })),
      ];
      const seen = new Map<string, number>();
      for (const t of found) {
        const ratio = contrast(t.color || look.text, look.surface);
        seen.set(t.color || look.text, ratio);
        expect(ratio, `${design}: "${t.text}" ${t.color || look.text} on ${look.surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(look.text, look.surface), `${design} poem text`).toBeGreaterThanOrEqual(7);
      for (const label of ["Read the whole poem on InkBoard", "Lines from", "…", "in Ewe", "/s/k3x9qm", "InkBoard · tryinkboard.elabo.me", "Chapter 4 · The Radio", "Read the chapter on InkBoard"]) {
        expect(found.some((t) => t.text === label), `${design} draws "${label}"`).toBe(true);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3); // text, muted, accent
    });
  }

  it("graphics read too: Ink's divider and logo tile ≥ 3:1 on ink; the logo's glyph ≥ 4.5:1 on its tile; avatars sit on a paper disc", () => {
    const ink = SHARE_DESIGNS.ink;
    expect(contrast(ink.divider, ink.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(ink.logo.tile, ink.background)).toBeGreaterThanOrEqual(3);
    for (const d of SHARE_DESIGN_NAMES) expect(contrast(SHARE_DESIGNS[d].logo.glyph, SHARE_DESIGNS[d].logo.tile), d).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f3eee6", ink.background)).toBeGreaterThanOrEqual(3); // the avatar's tile (src/server/avatar-svg.ts)
  });

  it("the numbers, for the record", () => {
    const table = Object.fromEntries(
      SHARE_DESIGN_NAMES.map((d) => {
        const l = SHARE_DESIGNS[d];
        return [d, { text: +contrast(l.text, l.surface).toFixed(1), muted: +contrast(l.muted, l.surface).toFixed(1), accent: +contrast(l.accent, l.surface).toFixed(1) }];
      }),
    );
    expect(table).toEqual({
      page: { text: 15.9, muted: 6.8, accent: 8.3 },
      ink: { text: 15.9, muted: 8.9, accent: 8.2 },
      board: { text: 15.9, muted: 6.8, accent: 8.3 },
    });
  });
});
