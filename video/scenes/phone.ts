/**
 * Phone scenes (Android Chrome, 390×844 at device scale 3), on the production
 * build: the service worker for offline reading only runs there.
 */
import type { Page } from "@playwright/test";
import { PROD_URL } from "../lib/config";
import type { Recorder } from "../lib/recorder";
import { card, cardLink, openBoard, sleep, type Scene } from "./common";

const B = PROD_URL;

/** Saved pages, from the service worker's index (as e2e-offline does). */
const saved = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("inkboard-pages-")) continue;
      const res = await (await caches.open(name)).match("/__inkboard/saved.json");
      for (const e of res ? ((await res.json()) as { url: string }[]) : []) out.push(e.url);
    }
    return out;
  });

async function until(fn: () => Promise<boolean>, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error("timed out");
}

/** Place a card at (x, y) on the phone board, before the take. */
async function placePhone(rec: Recorder, page: Page, name: string, x: number, y: number) {
  const target = card(page, name);
  for (let i = 0; i < 16; i++) {
    const b = await target.boundingBox();
    if (!b) throw new Error(`card ${name}`);
    const dx = x - (b.x + b.width / 2);
    const dy = y - (b.y + b.height / 2);
    if (Math.hypot(dx, dy) < 6) return;
    const sx = Math.max(-170, Math.min(170, dx));
    const sy = Math.max(-300, Math.min(300, dy));
    await rec.drag(195 - sx / 2, 470 - sy / 2, sx, sy, 400);
    await sleep(250);
  }
}

export const phoneScenes: Scene[] = [
  {
    id: "phone-board",
    server: "prod",
    device: "phone",
    async run(rec) {
      const ctx = await rec.context();
      const page = await ctx.newPage();
      await openBoard(page, `${B}/`);
      await rec.attach(page);
      await placePhone(rec, page, "Sankɔfa", 195, 360);
      await rec.begin();
      rec.mark("in");
      await rec.caption("On your phone: drag to wander, pinch to zoom.");
      await rec.drag(300, 520, -120, -180, 1300);
      await rec.hold(300);
      await rec.drag(120, 360, 150, 200, 1300);
      await rec.hold(300);
      await rec.pinch(195, 420, 90, 230, 1300);
      await rec.hold(600);
      rec.mark("pinched");
      await placePhone(rec, page, "Sankɔfa", 195, 420);
      await rec.hold(300);
      rec.mark("tap");
      await rec.caption("Tap a poem to read it.");
      await rec.tap(cardLink(page, "Sankɔfa"));
      await rec.cut(async () => {
        await page.getByRole("dialog", { name: "Sankɔfa" }).getByRole("heading", { level: 1, name: "Sankɔfa" }).waitFor();
        await sleep(150);
      });
      await rec.hold(2600);
      rec.mark("read");
      await rec.hold(1200);
      rec.mark("out");
      await rec.end();
    },
  },
  {
    id: "phone-language",
    server: "prod",
    device: "phone",
    async run(rec) {
      const ctx = await rec.context();
      const page = await ctx.newPage();
      await openBoard(page, `${B}/`);
      await rec.attach(page);
      await rec.begin();
      await rec.caption("Browse by language: Akan, Ewe or Ga.");
      const filter = page.getByRole("combobox", { name: "Language" });
      await rec.tap(filter);
      await filter.selectOption({ label: "Ewe" });
      await page.waitForURL(/lang=ee/);
      await rec.hold(2200);
      await filter.selectOption({ label: "Akan" });
      await page.waitForURL(/lang=ak/);
      await rec.hold(2200);
      await rec.end();
    },
  },
  {
    id: "install",
    server: "prod",
    device: "phone",
    async run(rec) {
      const ctx = await rec.context();
      // Chrome on Android offers installing with `beforeinstallprompt`; headless
      // Chrome never fires it, so it's simulated (as in e2e/install-nudge.spec.ts),
      // and this browser counts as a returning reader's.
      await ctx.addInitScript(() => {
        addEventListener("load", () => {
          const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
          e.prompt = async () => {};
          e.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
          dispatchEvent(e);
        });
        if (!localStorage.getItem("inkboard-install")) {
          const hourAgo = Date.now() - 3_600_000;
          localStorage.setItem("inkboard-install", JSON.stringify({ visits: 1, visitStart: hourAgo, lastSeen: hourAgo, poems: [] }));
        }
      });
      const page = await ctx.newPage();
      await openBoard(page, `${B}/`);
      const nudge = page.getByRole("region", { name: /home screen|Install InkBoard/ });
      await nudge.waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
      await rec.attach(page);
      await rec.begin();
      await rec.focus(nudge, { pad: 20, maxZoom: 1.5 });
      await rec.caption("Coming back often? InkBoard offers to go on your home screen.");
      await rec.captionDone();
      await rec.tap(nudge.getByRole("button", { name: "Install", exact: true }));
      await nudge.waitFor({ state: "hidden" });
      rec.unfocus();
      // Chrome fires `appinstalled` once the person confirms its install dialog.
      await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
      await rec.caption("Confirm in your browser, and it opens full screen, like an app.");
      await rec.hold(1000);
      // Opened from the home screen: no browser UI around it (the frame drops its
      // address bar at the "standalone" mark), and no install offer.
      const app = await (await rec.context()).newPage();
      await openBoard(app, `${B}/`);
      await app.waitForTimeout(500);
      rec.mark("standalone");
      await rec.attach(app);
      await rec.hold(2800);
      await rec.end();
    },
  },
  {
    id: "offline",
    server: "prod",
    device: "phone",
    async run(rec) {
      const ctx = await rec.context({ serviceWorkers: "allow" });
      const page = await ctx.newPage();
      await openBoard(page, `${B}/`);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
      await until(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
      await openBoard(page, `${B}/`);
      await until(async () => (await saved(page)).includes("/"));
      await rec.attach(page);
      await placePhone(rec, page, "Low Tide Inventory", 195, 420);
      await rec.begin();
      await rec.caption("Every poem you open is saved on your phone.");
      await rec.tap(cardLink(page, "Low Tide Inventory"));
      const dialog = page.getByRole("dialog", { name: "Low Tide Inventory" });
      await rec.cut(async () => {
        await dialog.getByRole("heading", { level: 1, name: "Low Tide Inventory" }).waitFor();
        await sleep(150);
      });
      await until(async () => (await saved(page)).some((u) => u.includes("low-tide-inventory")));
      await rec.hold(1800);
      await rec.tap(dialog.getByRole("button", { name: /Close/ }).first());
      await dialog.waitFor({ state: "hidden" });
      await rec.hold(500);
      rec.mark("offline");
      await ctx.setOffline(true);
      await rec.caption("No connection? The board and the poems you've read still open.");
      await page.reload();
      await page.locator('[aria-label="Poem board"][data-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
      await rec.hold(1400);
      await rec.tap(page.getByRole("button", { name: /^Authors/ }));
      const index = page.getByRole("navigation", { name: "Authors" });
      await index.waitFor();
      await rec.hold(500);
      await rec.tap(index.getByRole("button", { name: /Ines Calloway/ }));
      await rec.hold(1200);
      await card(page, "Low Tide Inventory").waitFor();
      await rec.tap(cardLink(page, "Low Tide Inventory"));
      await page.getByText("one blue rope, frayed at the wrist,").first().waitFor({ timeout: 30_000 });
      await rec.hold(2400);
      await rec.end();
      await ctx.setOffline(false).catch(() => {});
    },
  },
];
