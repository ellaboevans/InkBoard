import { expect, test, type Page } from "@playwright/test";
import { expectBackOnList, poemIdByTitle, signUpAs, sql } from "./helpers";

/*
 * Real 404s for reader pages (docs/PLAN.md, Phase 19). The pages stream under
 * Cache Components, so a notFound() inside them used to arrive under a 200;
 * the proxy (src/proxy.ts) now checks first on a full page load. A private
 * poem's page is still a 200 with its unlock form, and opening a missing poem
 * from the board still shows "Poem not found" in the overlay.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
}

const noindex = (page: Page) =>
  page.locator("meta[name=robots]").evaluateAll((ms) => ms.some((m) => m.getAttribute("content")?.includes("noindex")));

test("hard loads: real pages are 200, missing ones a real 404 with their own not-found page", async ({ page, request }) => {
  const id = unique();
  const email = `status-${id}@example.com`;
  await signUpAs(page, email, `Status Poet ${id}`);
  await publish(page, `Locked ${id}`, `private words ${id}`, "status-pass");
  const author = (await sql(`SELECT slug FROM editors WHERE email = '${email}'`)).rows[0].slug as string;

  expect((await page.goto(`/a/${author}`))!.status()).toBe(200);
  expect(await noindex(page)).toBe(false);

  // A private poem: 200, its title and the unlock form, never its text.
  const locked = await page.goto(`/p/${author}/locked-${id}`);
  expect(locked!.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: `Locked ${id}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await page.content()).not.toContain(`private words ${id}`);
  expect(await noindex(page)).toBe(false);

  // Missing: an unknown author, poem or collection, and another author's slug.
  const missing: [string, string][] = [
    [`/a/nobody-${id}`, "Author not found"],
    [`/p/${author}/no-such-poem`, "Poem not found"],
    [`/p/nobody-${id}/locked-${id}`, "Poem not found"],
    [`/a/${author}/c/no-such-collection`, "Collection not found"],
  ];
  for (const [path, heading] of missing) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(404);
    // Its own not-found page, at the address asked for, never stored by a cache.
    await expect(page.getByRole("heading", { name: heading }), path).toBeVisible();
    await expect(page, path).toHaveURL(new RegExp(`${path}$`));
    expect(await noindex(page), path).toBe(true);
    expect(res!.headers()["cache-control"], path).toContain("no-store");
    // Crawlers and link checkers (no browser headers) get the same answer, for HEAD too.
    expect((await request.get(path)).status(), path).toBe(404);
    expect((await request.head(path)).status(), path).toBe(404);
  }
  // Other routes under /a and /p keep their own answers.
  expect((await request.get(`/a/${author}/feed.xml`)).status()).toBe(200);
  expect((await request.get(`/a/nobody-${id}/feed.xml`)).status()).toBe(404);
});

test("a collection and a poem become 404s when their last published poem is unpublished", async ({ page }) => {
  const id = unique();
  const email = `status-col-${id}@example.com`;
  await signUpAs(page, email, `Status Collector ${id}`);
  await publish(page, `Open ${id}`, "a public line");
  await page.goto("/admin/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  const dialog = page.getByRole("dialog", { name: "New collection" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(`Set ${id}`);
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await page.getByRole("combobox", { name: "Add a poem" }).selectOption({ label: `Open ${id}` });
  await page.getByRole("button", { name: "Add to collection" }).click();
  await expect(page.getByRole("button", { name: `Remove “Open ${id}” from the collection` })).toBeVisible();
  const { rows } = await sql(
    `SELECT e.slug AS author, c.slug AS collection FROM editors e JOIN collections c ON c.editor_id = e.id WHERE e.email = '${email}'`,
  );
  const [{ author, collection }] = rows;
  const paths = [`/p/${author}/open-${id}`, `/a/${author}/c/${collection}`];
  for (const path of paths) expect((await page.goto(path))!.status(), path).toBe(200);

  const poemId = await poemIdByTitle(`Open ${id}`);
  await page.goto(`/admin/poems/${poemId}`);
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect.poll(async () => (await sql(`SELECT status FROM poems WHERE id = '${poemId}'`)).rows[0].status).toBe("draft");
  for (const path of paths) expect((await page.goto(path))!.status(), path).toBe(404);
  // A writer with nothing published still has an author page (it says so); the address isn't gone.
  expect((await page.goto(`/a/${author}`))!.status()).toBe(200);
});

test("a poem gone since the board loaded shows 'Poem not found' in the overlay, over the board", async ({ page, browser }) => {
  const id = unique();
  const pen = `Overlay Gone ${id}`;
  await signUpAs(page, `overlay-gone-${id}@example.com`, pen);
  await publish(page, `Soon gone ${id}`, "here for now");

  // A reader opens the board while the poem is still there.
  const reader = await browser.newContext();
  const readerPage = await reader.newPage();
  await readerPage.goto("/");
  await expect(readerPage.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  const card = readerPage.getByRole("link", { name: `Soon gone ${id}` });
  await expect(card).toBeAttached();

  // The writer deletes it.
  await page.goto(`/admin/poems/${await poemIdByTitle(`Soon gone ${id}`)}`);
  await page.getByRole("button", { name: "Delete poem" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete poem" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // The reader's stale card opens the overlay (a soft navigation), which says so; the board stays underneath.
  await card.focus();
  await readerPage.keyboard.press("Enter");
  const dialog = readerPage.getByRole("dialog", { name: "Poem not found" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Poem not found" })).toBeFocused();
  await expect(readerPage.locator('[aria-label="Poem board"]')).toBeAttached();
  await readerPage.keyboard.press("Escape");
  await expect(readerPage.getByRole("dialog")).toHaveCount(0);
  await expect(readerPage).toHaveURL(/\/$/);
  await expect(readerPage.locator('[aria-label="Poem board"]')).toBeVisible();

  // A full load of the same address is a real 404.
  const { rows } = await sql(`SELECT slug FROM editors WHERE pen_name = '${pen}'`);
  expect((await readerPage.goto(`/p/${rows[0].slug}/soon-gone-${id}`))!.status()).toBe(404);
  await reader.close();
});
