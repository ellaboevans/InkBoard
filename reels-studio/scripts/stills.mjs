// Preview stills: bundle once, render the given seconds to tmp/stills/<t>.png.
//   node scripts/stills.mjs 0.5 1.2 3.4 …            (the Reel)
//   node scripts/stills.mjs --comp WhatsNew 12 40 …   (another composition)
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const out = path.join(root, "tmp/stills");
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const args = process.argv.slice(2);
const id = args[0] === "--comp" ? args[1] : "LaunchReel";
const times = args[0] === "--comp" ? args.slice(2) : args;
const composition = await selectComposition({ serveUrl, id });
for (const s of times.map(Number)) {
  const frame = Math.round(s * composition.fps);
  await renderStill({ serveUrl, composition, frame, output: path.join(out, `${s.toFixed(2)}.png`), imageFormat: "png" });
  console.log("still", s);
}
