/** Reader scenes, on the production build (desktop). */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PROD_URL } from "../lib/config";
import type { Locator } from "@playwright/test";
import type { Recorder } from "../lib/recorder";
import { card, cardLink, openBoard, placeBoard, setZoom, sleep, type Scene } from "./common";

const B = PROD_URL;

async function boardTake(rec: Recorder, url = `${B}/`) {
  const ctx = await rec.context();
  const page = await ctx.newPage();
  await openBoard(page, url);
  await rec.attach(page);
  return page;
}

/** An overlay is loaded once its poem's heading shows (not the skeleton). */
async function loaded(dialog: Locator, title: string) {
  await dialog.getByRole("heading", { level: 1, name: title }).waitFor();
  await sleep(150);
}

export const readerScenes: Scene[] = [
  {
    id: "board",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const page = await boardTake(rec);
      await setZoom(page, 56);
      await placeBoard(page, page.getByRole("button", { name: /^Odalys Moon/ }).first(), 700, 470);
      await page.mouse.move(640, 420);
      await rec.begin();
      rec.mark("in");
      await rec.caption("InkBoard is a public board of poems, grouped by author.");
      await rec.hold(600);
      await rec.mouseDrag(760, 470, -260, -150, 1500);
      await rec.caption("Drag to wander. Hold ⌘ or Ctrl and scroll to zoom.");
      const odalys = page.getByRole("button", { name: /^Odalys Moon/ }).first();
      const ob = (await odalys.boundingBox())!;
      await rec.moveTo(ob.x + 140, ob.y + 120);
      await rec.wheel(-60, { ctrl: true, ms: 1600 });
      await rec.hold(900);
      rec.mark("zoomed");
      await rec.caption("Each section is one author. Their poems sit inside as cards.");
      await rec.hold(800);
      await rec.mouseDrag(820, 430, -340, 20, 1400);
      await rec.hold(600);
      await rec.caption("Fit shows the whole board again; the minimap shows where you are.");
      await rec.click(page.getByRole("button", { name: "Fit", exact: true }));
      await rec.hold(2400);
      rec.mark("out");
      await rec.end();
    },
  },
  {
    id: "overlay",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const page = await boardTake(rec);
      await setZoom(page, 84);
      await placeBoard(page, card(page, "Late Bloom"), 520, 380);
      await page.mouse.move(900, 600);
      await rec.begin();
      await rec.caption("Click a poem to read it right on the board.");
      await rec.hold(500);
      await rec.click(cardLink(page, "Late Bloom"));
      const dialog = page.getByRole("dialog", { name: "Late Bloom" });
      // The overlay shows a loading skeleton for a moment: leave it out.
      await rec.cut(() => loaded(dialog, "Late Bloom"));
      await rec.hold(700);
      await rec.focus(dialog.getByText(/Part 3 of 4/).first(), { pad: 150, maxZoom: 1.7 });
      await rec.caption("Poems can belong to a collection: this is part 3 of 4.");
      await rec.captionDone();
      rec.unfocus();
      const next = dialog.getByRole("link", { name: /^Next:/ });
      await rec.scrollTo(next, { offset: 420 }).catch(() => {});
      await rec.caption("Step through the collection without leaving the board.");
      await rec.click(next);
      await rec.cut(() => loaded(page.getByRole("dialog", { name: "First Frost" }), "First Frost"));
      await rec.hold(1600);
      await rec.caption("Every poem also has its own page and link.");
      const full = page.getByRole("dialog", { name: "First Frost" }).getByRole("link", { name: "Open full page" });
      await rec.click(full);
      await rec.cut(async () => {
        await page.waitForURL(/\/p\/odalys-moon\/first-frost$/);
        await page.getByRole("heading", { level: 1, name: "First Frost" }).waitFor();
        await rec.settle(150);
      });
      await rec.hold(1800);
      await rec.caption("A collection has a page too, with its poems in reading order.");
      await rec.click(page.getByRole("main").getByRole("link", { name: "Four Seasons, Briefly", exact: true }));
      await rec.cut(async () => {
        await page.getByRole("heading", { level: 1, name: "Four Seasons, Briefly" }).waitFor();
        await rec.settle(150);
      });
      await rec.hold(800);
      await rec.focus(page.getByRole("main"), { pad: 0, maxZoom: 1.35 });
      await rec.hold(2600);
      await rec.end();
    },
  },
  {
    id: "private",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const page = await boardTake(rec);
      await setZoom(page, 84);
      await placeBoard(page, card(page, "Old Letters (password protected)"), 640, 400);
      await page.mouse.move(980, 560);
      await rec.begin();
      await rec.focus(card(page, "Old Letters (password protected)"), { pad: 120, maxZoom: 1.6 });
      await rec.caption("Private poems show only their title. The text stays locked.");
      await rec.captionDone();
      rec.unfocus();
      await rec.click(cardLink(page, "Old Letters (password protected)"));
      const dialog = page.getByRole("dialog", { name: "Old Letters" });
      await rec.cut(async () => {
        await dialog.getByLabel("Password", { exact: true }).waitFor();
        await rec.settle(150);
      });
      await rec.hold(500);
      const pw = dialog.getByLabel("Password", { exact: true });
      await rec.focus(dialog, { pad: 10, maxZoom: 1.4 });
      rec.mark("unlock");
      await rec.caption("Readers who have the password can unlock it.");
      await rec.type(pw, "moonlight", { delay: 90 });
      await rec.click(dialog.getByRole("button", { name: "Unlock poem" }));
      await dialog.getByText("Unlocked on this device").waitFor();
      await rec.hold(400);
      await rec.caption("Unlocked: the poem opens, and stays open on this device.");
      await rec.hold(800);
      await rec.end();
    },
  },
  {
    id: "search",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const page = await boardTake(rec);
      await setZoom(page, 70);
      await page.mouse.move(640, 500);
      await rec.begin();
      await rec.caption("Search finds authors and poem titles.");
      await rec.click(page.getByRole("button", { name: /Search authors & poems/ }));
      const palette = page.getByRole("dialog", { name: "Search the board" });
      await palette.waitFor();
      const field = palette.getByRole("combobox");
      const fb = (await field.boundingBox())!;
      await rec.focus({ x: fb.x - 20, y: fb.y - 20, width: fb.width + 40, height: 200 }, { pad: 10, maxZoom: 1.9 });
      await rec.type(palette.getByRole("combobox"), "agbo", { delay: 150, click: false });
      const option = palette.getByRole("option", { name: /Selorm Agbɔ/ }).first();
      await option.waitFor();
      await rec.hold(500);
      await rec.caption("No special keyboard needed: “agbo” finds Agbɔ.");
      await rec.hold(1200);
      rec.unfocus();
      await rec.click(option);
      await rec.hold(1500);
      await rec.caption("Pick a result and the board takes you there.");
      await rec.focus(page.getByRole("button", { name: /^Selorm Agbɔ/ }).first(), { pad: 180, maxZoom: 1.5 });
      await rec.hold(1800);
      rec.unfocus();
      await rec.hold(600);
      await rec.end();
    },
  },
  {
    id: "language",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const page = await boardTake(rec);
      await page.mouse.move(640, 500);
      await rec.begin();
      const filter = page.getByRole("combobox", { name: "Language" });
      await rec.focus(filter, { pad: 70, maxZoom: 1.8 });
      await rec.caption("Browse by language: Akan (Twi, Fante, Nzema), Ewe and Ga.");
      await rec.hover(filter);
      await rec.hold(600);
      await filter.selectOption({ label: "Ewe" });
      await page.waitForURL(/lang=ee/);
      await rec.hold(900);
      rec.unfocus();
      await rec.hold(900);
      const ewe = card(page, "Nunya");
      await rec.captionDone();
      await rec.focus(ewe, { pad: 60, maxZoom: 1.9 });
      await rec.caption("Letters such as ɛ, ɔ, ɖ and ŋ show properly, in every view.");
      await rec.captionDone();
      rec.unfocus();
      // Each caption goes up before its filter changes, so words and picture match.
      await rec.caption("Akan covers Twi, Fante and Nzema.");
      await rec.hover(filter);
      await filter.selectOption({ label: "Akan" });
      await page.waitForURL(/lang=ak/);
      await rec.hold(500);
      await rec.focus(card(page, "Sankɔfa"), { pad: 60, maxZoom: 1.9 });
      await rec.captionDone();
      rec.unfocus();
      await rec.caption("And Ga.");
      await filter.selectOption({ label: "Ga" });
      await page.waitForURL(/lang=gaa/);
      await rec.hold(400);
      await rec.focus(card(page, "Oyiwala dɔŋŋ"), { pad: 60, maxZoom: 1.9 });
      await rec.captionDone();
      await rec.hold(600);
      rec.unfocus();
      await rec.hold(500);
      await rec.end();
    },
  },
  {
    id: "author",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const ctx = await rec.context();
      const page = await ctx.newPage();
      await page.goto(`${B}/p/ama-sewaa/sankofa`);
      await rec.attach(page);
      await rec.begin();
      await rec.caption("Click an author's name to open their page.");
      await rec.click(page.locator("article").getByRole("link", { name: "Ama Sɛwaa", exact: true }));
      await rec.cut(async () => {
        await page.getByRole("heading", { level: 1, name: "Ama Sɛwaa" }).waitFor();
        await rec.settle(300);
      });
      await rec.focus({ x: 150, y: 100, width: 700, height: 270 }, { maxZoom: 1.7 });
      await rec.caption("A tagline, a bio, links and an avatar the author picks.");
      await rec.captionDone();
      rec.unfocus();
      await rec.focus({ x: 140, y: 400, width: 680, height: 260 }, { maxZoom: 1.7 });
      await rec.caption("Their pinned poem comes first, then all their poems.");
      await rec.captionDone();
      rec.unfocus();
      await rec.hold(500);
      await rec.end();
    },
  },
  {
    id: "feeds",
    server: "prod",
    device: "desktop",
    async run(rec) {
      const page = await boardTake(rec);
      await setZoom(page, 70);
      await page.mouse.move(800, 500);
      await rec.begin();
      await rec.caption("Subscribe to follow new poems in any feed reader.");
      await rec.click(page.getByRole("button", { name: "Subscribe", exact: true }));
      const pop = page.getByRole("dialog", { name: "Follow new poems" });
      await pop.waitFor();
      await rec.hold(400);
      await rec.focus(pop, { pad: 24, maxZoom: 1.8 });
      await rec.hold(800);
      await rec.caption("Each author has a feed of their own, too.");
      await rec.captionDone();
      rec.unfocus();
      await rec.hold(400);
      await rec.end();
    },
  },
  {
    id: "share",
    server: "prod",
    device: "desktop",
    async run(rec) {
      // The real share card, for the edit to show as a link preview.
      const og = await fetch(`${B}/p/ama-sewaa/sankofa/opengraph-image`);
      if (!og.ok) throw new Error(`share card: ${og.status}`);
      const png = Buffer.from(await og.arrayBuffer());
      const ctx = await rec.context();
      const page = await ctx.newPage();
      await page.goto(`${B}/p/ama-sewaa/sankofa`);
      await rec.attach(page);
      await rec.begin();
      writeFileSync(path.join(rec.dir, "share-card.png"), png);
      await rec.focus(page.locator("article").first(), { pad: 40, maxZoom: 1.6 });
      await rec.hold(700);
      rec.mark("card");
      await rec.caption("Share a poem's link anywhere: it shows a card with the title, the author and the opening lines.");
      await rec.captionDone();
      await rec.hold(1500);
      rec.mark("card-out");
      await rec.hold(400);
      await rec.end();
    },
  },
];

