import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURES_FILE } from "./constants";
import { build, start, stop } from "./server";

/*
 * A new deploy (runs last: it rebuilds the app with a new build id and
 * restarts the server on the same origin). The page must pick up the new
 * worker, its caches must be the new build's only, saved poems must carry
 * over (fetched again under the rules) and pages must keep working.
 */
const F = JSON.parse(readFileSync(FIXTURES_FILE, "utf8")) as { read: { slug: string } };
const poem = `/p/offline-poet/${F.read.slug}`;

const buildOf = (page: Page) =>
  page.evaluate(async () => {
    const src = await (await fetch("/sw.js", { cache: "no-store" })).text();
    const reg = await navigator.serviceWorker.getRegistration();
    return { served: /Build (\S+)\./.exec(src)?.[1], active: reg?.active?.state, caches: (await caches.keys()).sort() };
  });

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

test("a new deploy picks up the new worker, keeps saved poems and doesn't break pages", async ({ context, page }) => {
  test.setTimeout(420_000);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.getByRole("link", { name: "Low Tide Inventory", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Low Tide Inventory" })).toBeVisible();
  await expect.poll(() => saved(page)).toContain(poem);
  const before = await buildOf(page);
  expect(before.caches).toEqual([`inkboard-pages-${before.served}`, `inkboard-static-${before.served}`]);

  // Deploy: rebuild with a new id, restart on the same origin.
  await stop();
  const next = `e2e-next-${Date.now().toString(36)}`;
  build(next);
  await start(next);

  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/_next/static/") && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failed.push(`pageerror: ${e.message}`));
  await page.goto("/"); // the browser checks /sw.js (no-cache) and installs the new worker
  await expect.poll(async () => (await buildOf(page)).caches, { timeout: 60_000 }).toEqual([
    `inkboard-pages-${next}`,
    `inkboard-static-${next}`,
  ]);
  const after = await buildOf(page);
  expect(after.served).toBe(next);
  expect(after.active).toBe("activated");
  // The poem saved under the old build was fetched again into the new one.
  expect(await saved(page)).toContain(poem);

  // Pages still work, online and offline, with the new build's assets.
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await context.setOffline(true);
  await page.goto(poem);
  await expect(page.getByText("one blue rope, frayed at the wrist,")).toBeVisible();
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  expect(failed).toEqual([]);
});
