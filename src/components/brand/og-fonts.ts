import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Newsreader (OFL, src/assets/fonts) so share cards use the site's serif.
 * Static 400 instances: Satori (ImageResponse) can't read variable fonts.
 *
 * Gentium Book Plus (SIL, OFL) supplies what Newsreader lacks: the letters of
 * Ewe, Twi/Akan, Nzema and Ga (Ɛ Ɔ Ɖ Ƒ Ɣ Ʋ Ʒ…) and IPA, like on the site
 * (docs/PLAN.md, Phase 11). Satori only has the fonts given here, so without
 * it those letters would be empty boxes. Subset to Latin, IPA, combining
 * marks, Greek and arrows (the IPA tone arrows ↗ ↘) to keep the function small.
 *
 * Order matters: Satori can't place a tone mark from one font on a letter
 * from another, so Ghanaian text puts Gentium first (ogFontFamily in
 * og-type.ts; tests/lib/og-font-order.test.ts). The share image adds
 * Newsreader's text cut and bold faces (src/server/share-image.tsx).
 */
export async function ogFonts() {
  const dir = join(process.cwd(), "src/assets/fonts");
  const [regular, italic, extRegular, extItalic] = await Promise.all([
    readFile(join(dir, "Newsreader.ttf")),
    readFile(join(dir, "Newsreader-Italic.ttf")),
    readFile(join(dir, "GentiumBookPlus-Regular.ttf")),
    readFile(join(dir, "GentiumBookPlus-Italic.ttf")),
  ]);
  return [
    { name: "Newsreader", data: regular, style: "normal" as const, weight: 400 as const },
    { name: "Newsreader", data: italic, style: "italic" as const, weight: 400 as const },
    { name: "Gentium Book Plus", data: extRegular, style: "normal" as const, weight: 400 as const },
    { name: "Gentium Book Plus", data: extItalic, style: "italic" as const, weight: 400 as const },
  ];
}
