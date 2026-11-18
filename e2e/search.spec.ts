import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql, expectBackOnList } from "./helpers";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
}

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Search the board" });
const searchBox = (page: Page) => palette(page).getByRole("combobox");

test("search finds authors and titles (prefix, typo, accents) and flies to them", async ({ page }) => {
  const id = unique();
  // Unique, searchable words per run: "Zephyrine <id>" etc.
  const pen = `Mirabelle Ostrowska ${id}`;
  const title = `Zephyrine Lanterns ${id}`;
  await signUpAs(page, `search-${id}@example.com`, pen);
  await publish(page, title, `secretbodyword${id} should never be searchable`);
  await openBoard(page);

  // ⌘K / Ctrl+K opens it.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();

  // Title prefix
  await searchBox(page).fill(`zephyr ${id}`);
  const poemResult = palette(page).getByRole("option", { name: new RegExp(`Zephyrine Lanterns ${id}`) });
  await expect(poemResult).toBeVisible();

  // Poem text is never searched.
  await searchBox(page).fill(`secretbodyword${id}`);
  await expect(palette(page).getByText(/No authors, novels or poems match/)).toBeVisible();

  // Author by misspelt, accent-free name
  await searchBox(page).fill(`ostrowsk ${id}`);
  await expect(palette(page).getByRole("option", { name: new RegExp(pen) })).toBeVisible();
  await searchBox(page).fill(`mirabele ${id}`); // typo
  await expect(palette(page).getByRole("option", { name: new RegExp(pen) })).toBeVisible();

  // Picking an author flies to their section and focuses its label.
  await palette(page).getByRole("option", { name: new RegExp(pen) }).click();
  await expect(palette(page)).toHaveCount(0);
  const label = page.getByRole("button", { name: new RegExp(`^${pen}`) });
  await expect(label).toBeFocused();
  await expect(label).toBeInViewport();

  // Picking a poem flies to its card; Enter opens it in the overlay.
  await page.getByRole("button", { name: /Search/ }).first().click();
  await searchBox(page).fill(`lanterns ${id}`);
  await palette(page).getByRole("option", { name: new RegExp(title) }).press("Enter");
  const card = page.getByRole("link", { name: title, exact: true });
  await expect(card).toBeFocused();
  // The title link is stretched over its card; the card is what's shown and highlighted.
  const box = card.locator("xpath=ancestor::div[@data-card]");
  await expect(box).toBeInViewport({ ratio: 0.99 }); // sub-pixel rounding at fractional zoom
  await expect(box).toHaveAttribute("data-highlight", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
});

test("search API never returns poem text and rejects junk safely", async ({ request }) => {
  const res = await request.get("/api/search?q=" + encodeURIComponent("x:* | !y & ("));
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ authors: [], novels: [], poems: [] });
  const short = await request.get("/api/search?q=a");
  expect(await short.json()).toEqual({ authors: [], novels: [], poems: [] });
  const body = await (await request.get("/api/search?q=the")).text();
  expect(body).not.toMatch(/"body"|excerpt|password/i);
});
