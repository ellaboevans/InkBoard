import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Newsreader (OFL, src/assets/fonts) so share cards use the site's serif.
 * Static 400 instances: Satori (ImageResponse) can't read variable fonts.
 */
export async function ogFonts() {
  const dir = join(process.cwd(), "src/assets/fonts");
  const [regular, italic] = await Promise.all([
    readFile(join(dir, "Newsreader.ttf")),
    readFile(join(dir, "Newsreader-Italic.ttf")),
  ]);
  return [
    { name: "Newsreader", data: regular, style: "normal" as const, weight: 400 as const },
    { name: "Newsreader", data: italic, style: "italic" as const, weight: 400 as const },
  ];
}
