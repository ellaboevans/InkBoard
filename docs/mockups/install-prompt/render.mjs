// Exports every frame of index.html (each <figure data-export>) as a PNG next to it.
//
//   node docs/mockups/install-prompt/render.mjs
//
// Uses the repo's @playwright/test with the installed Chrome (PW_CHANNEL to change,
// like playwright.config.ts). PW_MODULE can point at another Playwright build.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.PW_MODULE ?? "@playwright/test");
const dir = path.dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
  await page.waitForSelector("html[data-ready=true]");
  await page.evaluate(() => document.fonts.ready);
  // Frames at 100%, without the gallery's fit-to-width scaling.
  await page.evaluate(() => document.body.classList.add("export"));
  for (const name of await page.$$eval("figure[data-export]", (els) => els.map((e) => e.dataset.export))) {
    const shot = page.locator(`figure[data-export="${name}"] .shot`);
    await shot.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled" });
    console.log(`${name}.png`);
  }
} finally {
  await browser.close();
}
