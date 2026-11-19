import { continueRender, delayRender, staticFile } from "remotion";

/** The app's own fonts (OFL), copied into public/fonts. Ext faces cover only Ghanaian letters and IPA. */
const EXT = "U+0100-02FF, U+0300-036F, U+0370-03FF, U+1D00-1DFF, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF";
const FACES: { family: string; file: string; desc?: FontFaceDescriptors }[] = [
  { family: "Geist", file: "fonts/geist-latin.woff2", desc: { weight: "100 900" } },
  { family: "Geist", file: "fonts/geist-latin-ext.woff2", desc: { weight: "100 900", unicodeRange: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" } },
  { family: "Geist Mono", file: "fonts/geist-mono-latin.woff2", desc: { weight: "100 900" } },
  { family: "Newsreader", file: "fonts/Newsreader.ttf", desc: { weight: "200 800" } },
  { family: "Newsreader", file: "fonts/Newsreader-Italic.ttf", desc: { weight: "200 800", style: "italic" } },
  { family: "GentiumExt", file: "fonts/GentiumBookPlus-Regular.ttf", desc: { weight: "400", unicodeRange: EXT } },
  { family: "GentiumExt", file: "fonts/GentiumBookPlus-Bold.ttf", desc: { weight: "700", unicodeRange: EXT } },
  { family: "GentiumExt", file: "fonts/GentiumBookPlus-Italic.ttf", desc: { weight: "400", style: "italic", unicodeRange: EXT } },
  { family: "AndikaExt", file: "fonts/Andika-Regular.woff2", desc: { weight: "400", unicodeRange: EXT } },
  { family: "AndikaExt", file: "fonts/Andika-Bold.woff2", desc: { weight: "700", unicodeRange: EXT } },
];

const handle = delayRender("Loading fonts");
Promise.all(
  FACES.map(async (f) => {
    const face = new FontFace(f.family, `url(${staticFile(f.file)})`, f.desc);
    await face.load();
    document.fonts.add(face);
  }),
)
  .then(() => continueRender(handle))
  .catch((err) => {
    console.error(err);
    continueRender(handle);
  });
