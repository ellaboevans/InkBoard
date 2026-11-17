import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURES_FILE, PRIVATE_LINE, PRIVATE_PASSWORD } from "./constants";

/*
 * Offline reading (docs/PLAN.md, Phase 15 round 2), against a production
 * build with its service worker (see playwright.offline.config.ts). Every
 * test uses a fresh browser context, so it installs the worker from scratch.
 */

type Poem = { id: string; slug: string };
const F = JSON.parse(readFileSync(FIXTURES_FILE, "utf8")) as {
  token: string;
  read: Poem;
  unpublish: Poem;
  unread: Poem;
  secret: Poem;
};
const url = (p: Poem) => `/p/offline-poet/${p.slug}`;

const boardReady = (page: Page) => expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();

/** Open the board and wait until the worker controls the page and has saved the board. */
async function withWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await boardReady(page);
  await expect.poll(() => saved(page)).toContain("/");
}

/** The pages saved on this device, from the worker's index. */
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

/** Every URL in every cache, and whether any stored body contains `needle`. */
const cacheContents = (page: Page, needle: string) =>
  page.evaluate(async (needle) => {
    const keys: string[] = [];
    let found = false;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        keys.push(new URL(req.url).pathname + new URL(req.url).search);
        const res = await cache.match(req);
        if (res && (await res.clone().text()).includes(needle)) found = true;
      }
    }
    return { keys, found };
  }, needle);

/** Read a poem in the board's overlay, then close it. */
async function readInOverlay(page: Page, title: string) {
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const offlinePage = (page: Page) => expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
const indicator = (page: Page) => expect(page.getByRole("status").filter({ hasText: "You're offline" }).first()).toBeVisible();

/**
 * Sign this browser in as the fixture editor. CDP refuses a __Host-/Secure
 * cookie for an http:// URL, so it's set from a page on the origin, where
 * localhost counts as a secure context (as for the server's own Set-Cookie).
 */
async function signInAsEditor(page: Page) {
  await page.goto("/sign-in");
  await page.evaluate((token) => {
    document.cookie = `__Host-poemhub_session=${token}; Path=/; Secure; SameSite=Lax`;
  }, F.token);
}

test("a poem read online opens offline: reloaded, and from the board", async ({ context, page }) => {
  await withWorker(page);
  await readInOverlay(page, "Low Tide Inventory");
  await expect.poll(() => saved(page)).toContain(url(F.read));

  await context.setOffline(true);
  // A full reload of the poem: the saved copy.
  await page.goto(url(F.read));
  await expect(page.getByRole("heading", { level: 1, name: "Low Tide Inventory" })).toBeVisible();
  await expect(page.getByText("one blue rope, frayed at the wrist,")).toBeVisible();
  await indicator(page);

  // From the board (saved too): a soft navigation becomes a document load of the saved page.
  await page.goto("/");
  await boardReady(page);
  await indicator(page);
  await page.getByRole("link", { name: "Low Tide Inventory", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${url(F.read)}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Low Tide Inventory" })).toBeVisible();
  await expect(page.getByText("one blue rope, frayed at the wrist,")).toBeVisible();
});

test("the share image is never stored by the worker (docs/PLAN.md, Phase 21)", async ({ context, page }) => {
  await withWorker(page);
  await page.goto(url(F.read));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  const sheet = page.getByRole("dialog", { name: "Share as image" });
  await expect(sheet.getByRole("img", { name: /^Preview of the image/ })).toBeVisible();
  // Round 2: the chat size, the picker's lines and a picked-lines image go through it too.
  const choose = (name: RegExp) => sheet.locator("label").filter({ has: page.getByRole("radio", { name }) }).click();
  await choose(/^Chat/);
  await expect.poll(() => sheet.getByRole("img", { name: /^Preview of the image/ }).evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(1350);
  await choose(/^Choose lines$/);
  await sheet.getByRole("checkbox", { name: /^Line 1: / }).click();
  await expect(sheet.getByRole("img", { name: /^Preview of the image: lines from/ })).toBeVisible();
  // Fetched through the worker, shown, and in no cache.
  await expect.poll(() => saved(page)).toContain(url(F.read));
  const { keys } = await cacheContents(page, "share-image");
  expect(keys.filter((k) => k.includes("share-image"))).toEqual([]);
  await page.keyboard.press("Escape");

  // Offline, the saved poem still opens, and the sheet says plainly why there's no image.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Low Tide Inventory" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet.getByText("You're offline. Connect to the internet to make the image.")).toBeVisible();
});

test("a short link (/s/<code>) through the worker: online it lands on the poem; offline, the offline page", async ({ context, page }) => {
  await withWorker(page);
  // The poem's first picture makes its code; the picture says which address it printed.
  const res = await page.request.get(`${url(F.read)}/share-image`);
  const address = res.headers()["x-share-address"];
  expect(address).toMatch(/^\/s\/[23456789bcdfghjkmnpqrstvwxz]{6}$/);
  // Online: the worker passes the navigation through and the browser follows the 302.
  await page.goto(address);
  await expect(page).toHaveURL(new RegExp(`${url(F.read)}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Low Tide Inventory" })).toBeVisible();
  // A code that doesn't exist: the real 404 page, through the worker too.
  const missing = await page.goto("/s/zzzzzz");
  expect(missing!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  // Offline: the worker can't know where a code goes, so the offline page (which lists saved poems).
  await context.setOffline(true);
  await page.goto(address);
  await offlinePage(page);
});

test("the board opens offline, as last seen", async ({ context, page }) => {
  await withWorker(page);
  await context.setOffline(true);
  await page.reload();
  await boardReady(page);
  for (const title of ["Low Tide Inventory", "Harbour Lights", "Salt"]) {
    await expect(page.getByRole("link", { name: title, exact: true })).toBeAttached();
  }
  // The private poem's card: its title only, as on the live board.
  await expect(page.getByRole("link", { name: "Old Letters (password protected)" })).toBeAttached();
  await indicator(page);
});

test("an unread poem offline shows the offline page, which lists the saved poems", async ({ context, page }) => {
  await withWorker(page);
  await readInOverlay(page, "Low Tide Inventory");
  await expect.poll(() => saved(page)).toContain(url(F.read));
  await context.setOffline(true);

  // A full load of a poem never read here.
  await page.goto(url(F.unread));
  await expect(page).toHaveURL(new RegExp(`/offline\\?from=${encodeURIComponent(url(F.unread))}$`));
  await offlinePage(page);
  const list = page.locator("[data-saved-poems]");
  await expect(list.getByRole("link", { name: /Low Tide Inventory/ })).toContainText("by Offline Poet");
  await expect(list.getByRole("link", { name: /Salt/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Try that page again" })).toHaveAttribute("href", url(F.unread));

  // From the board, the same: a soft navigation to an unsaved poem lands on the offline page.
  await page.goto("/");
  await boardReady(page);
  await page.getByRole("link", { name: "Salt", exact: true }).click();
  await offlinePage(page);
  // And a saved poem opens from the list.
  await page.locator("[data-saved-poems]").getByRole("link", { name: /Low Tide Inventory/ }).click();
  await expect(page.getByText("one blue rope, frayed at the wrist,")).toBeVisible();
});

test("a private poem unlocked online is never stored, so it isn't there offline", async ({ context, page }) => {
  await withWorker(page);
  await page.goto(url(F.secret));
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(PRIVATE_PASSWORD);
  await page.getByRole("button", { name: "Unlock poem" }).click();
  await expect(page.getByText(PRIVATE_LINE)).toBeVisible();
  // Also open it in the overlay, unlocked (an RSC response with the text).
  await page.goto("/");
  await boardReady(page);
  await page.getByRole("link", { name: "Old Letters (password protected)" }).click();
  await expect(page.getByRole("dialog").getByText(PRIVATE_LINE)).toBeVisible();
  await page.waitForTimeout(1500); // let any save the worker might do finish

  expect(await saved(page)).not.toContain(url(F.secret));
  const { keys, found } = await cacheContents(page, PRIVATE_LINE);
  expect(found, "the private text is in no cache").toBe(false);
  expect(keys.filter((k) => k.startsWith(url(F.secret)))).toEqual([]);

  await context.setOffline(true);
  await page.goto(url(F.secret));
  await offlinePage(page);
  await expect(page.getByText(PRIVATE_LINE)).toHaveCount(0);
});

test("/admin and /sign-in are never served from a cache", async ({ context, page }) => {
  await withWorker(page);
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /Sign in/ })).toBeVisible();
  await signInAsEditor(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Your poems" })).toBeVisible();
  const { keys } = await cacheContents(page, "Your poems");
  expect(keys.filter((k) => /^\/(admin|sign-in|api)/.test(k))).toEqual([]);

  await context.setOffline(true);
  for (const path of ["/admin", "/sign-in"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/offline\\?from=${encodeURIComponent(path)}$`));
    await offlinePage(page);
  }
});

test("after a poem is unpublished, the next online visit removes it from the saved poems", async ({ browser, context, page }) => {
  await withWorker(page);
  await readInOverlay(page, "Harbour Lights");
  await expect.poll(() => saved(page)).toContain(url(F.unpublish));

  // The editor unpublishes it (a separate browser, signed in).
  const editor = await browser.newContext();
  const admin = await editor.newPage();
  await signInAsEditor(admin);
  await admin.goto(`/admin/poems/${F.unpublish.id}`);
  await admin.getByRole("button", { name: "Unpublish" }).click();
  await expect(admin.locator("[data-sileo-toast]").filter({ hasText: "Draft saved" })).toBeVisible();
  await editor.close();

  // The reader, online again: the page is gone (a real 404, Phase 19), and so is the saved copy.
  expect((await page.goto(url(F.unpublish)))!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await expect.poll(() => saved(page)).not.toContain(url(F.unpublish));
  await context.setOffline(true);
  await page.goto(url(F.unpublish));
  await offlinePage(page);
  await expect(page.locator("[data-saved-poems]").getByRole("link", { name: /Harbour Lights/ })).toHaveCount(0);
});

test("production: missing reader pages are real 404s; real ones and a private poem stay 200", async ({ page, request }) => {
  // Under Cache Components the prerendered shell starts a 200, so these come
  // from the proxy's rewrite to a static 404 page (src/app/missing, Phase 19).
  for (const [path, heading] of [
    ["/a/nobody-here", "Author not found"],
    ["/p/offline-poet/no-such-poem", "Poem not found"],
    ["/a/offline-poet/c/no-such-collection", "Collection not found"],
  ] as const) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(404);
    expect(res!.headers()["cache-control"], path).toContain("no-store");
    await expect(page.getByRole("heading", { name: heading }), path).toBeVisible();
    await expect(page, path).toHaveURL(new RegExp(`${path}$`));
    expect((await request.head(path)).status(), path).toBe(404);
  }
  for (const path of ["/", "/a/offline-poet", url(F.read), url(F.secret), "/about", "/privacy"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  // The private poem's page: its unlock form, never its text.
  await page.goto(url(F.secret));
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await page.content()).not.toContain(PRIVATE_LINE);
});

test("the About and Privacy pages are saved, and open offline", async ({ context, page }) => {
  await withWorker(page);
  await page.goto("/about");
  await expect(page.getByRole("button", { name: "Play the walkthrough" })).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect.poll(() => saved(page)).toEqual(expect.arrayContaining(["/about", "/privacy"]));
  // A missing page is never saved.
  await page.goto("/a/nobody-here");
  await context.setOffline(true);
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "About InkBoard" })).toBeVisible();
  // The cover image comes from the static cache with the page. (Behind the
  // play button it is decoration, alt="", so find it inside the button.)
  const cover = page.getByRole("button", { name: "Play the walkthrough" }).locator("img");
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await indicator(page);
  expect(await saved(page)).not.toContain("/a/nobody-here");
});
