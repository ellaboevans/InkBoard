import { expect, test, type Page } from "@playwright/test";
import { signOut, signUpAs, sql } from "./helpers";

// Browsing the board by language (docs/PLAN.md, Phase 11c): a filter in the
// toolbar, kept in the URL (?lang=ee), followed by the list view and the
// Authors index; search still covers everything.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, language: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: language });
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible({ timeout: 45_000 });
}

async function openBoard(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

const filter = (page: Page) => page.getByRole("combobox", { name: "Language" });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /^Showing / });
const card = (page: Page, title: string) =>
  page.locator("[data-card]").filter({ has: page.getByRole("link", { name: title, exact: true }) });

test("filtering the board by language, in the URL, the list view and the Authors index", async ({ page }) => {
  const id = unique();
  const ewePoet = `Ewe Poet ${id}`;
  const englishPoet = `English Poet ${id}`;
  await signUpAs(page, `lang-a-${id}@example.com`, ewePoet);
  await publish(page, `Ŋutifafa ${id}`, `Ŋutifafa na wò ${id}`, "Ewe");
  await publish(page, `Ɖoɖo ${id}`, `hidden ewe text ${id}`, "Ewe", "ewe-pass");
  await publish(page, `Morning ${id}`, "an English poem", "English");
  await signOut(page);
  await signUpAs(page, `lang-b-${id}@example.com`, englishPoet);
  await publish(page, `Evening ${id}`, "only English here", "English");

  await openBoard(page);
  // Only languages with poems are offered (nothing is tagged Ga).
  const offered = await filter(page).locator("option").allTextContents();
  expect(offered).toEqual(expect.arrayContaining(["All languages", "Ewe", "English"]));
  expect(offered).not.toContain("Ga");
  await expect(filter(page)).toHaveValue("");
  await expect(status(page)).toHaveCount(0);

  // Pick Ewe: the URL follows, other languages and emptied authors drop out.
  await filter(page).selectOption({ label: "Ewe" });
  await expect(page).toHaveURL(/\/\?lang=ee$/);
  await expect(status(page)).toContainText("Showing Ewe poems ·");
  await expect(card(page, `Ŋutifafa ${id}`)).toBeVisible();
  await expect(card(page, `Ɖoɖo ${id} (password protected)`)).toBeAttached();
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);
  await expect(page.locator(`[aria-label^="${englishPoet},"]`)).toHaveCount(0);
  await expect(page.getByRole("region", { name: `${ewePoet}, 2 poems` })).toBeAttached();
  // Private poems stay title-only (N1).
  expect(await page.content()).not.toContain(`hidden ewe text ${id}`);

  // The Authors index follows the filter.
  await page.getByRole("button", { name: /^Authors/ }).click();
  const authors = page.getByRole("navigation", { name: "Authors" });
  await expect(authors.getByRole("button", { name: new RegExp(ewePoet) })).toBeVisible();
  await expect(authors.getByRole("button", { name: new RegExp(englishPoet) })).toHaveCount(0);
  await page.getByRole("button", { name: /^Authors/ }).click();

  // Search still covers everything; a filtered-out author explains itself.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search the board" });
  await palette.getByRole("combobox").fill(englishPoet);
  await palette.getByRole("option", { name: new RegExp(englishPoet) }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: `${englishPoet} has no Ewe poems` })).toBeVisible();

  // Opening a poem and closing the overlay keeps the filter.
  await page.getByRole("link", { name: `Ŋutifafa ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Ŋutifafa ${id}` })).toBeVisible();
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/\?lang=ee$/);
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);

  // Reload keeps it; back returns to all.
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(filter(page)).toHaveValue("ee");
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, `Morning ${id}`)).toBeVisible();

  // List view follows the filter, and can change it.
  await openBoard(page, "/?lang=ee");
  await page.getByRole("button", { name: "List view" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: new RegExp(`^Ŋutifafa ${id}`) })).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`^Morning ${id}`) })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: new RegExp(englishPoet) })).toHaveCount(0);
  await filter(page).selectOption({ label: "English" });
  await expect(page).toHaveURL(/\/\?lang=en$/);
  await expect(main.getByRole("link", { name: new RegExp(`^Evening ${id}`) })).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`^Ŋutifafa ${id}`) })).toHaveCount(0);

  // "Show all languages" removes the param and returns focus to the filter.
  await page.getByRole("button", { name: "Show all languages" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(filter(page)).toBeFocused();
  await expect(main.getByRole("link", { name: new RegExp(`^Ŋutifafa ${id}`) })).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`^Evening ${id}`) })).toBeVisible();
});

test("an unknown or unused language behaves like All", async ({ page }) => {
  for (const url of ["/?lang=zz", "/?lang=gaa", "/?lang="]) {
    await openBoard(page, url);
    await expect(filter(page)).toHaveValue("");
    await expect(status(page)).toHaveCount(0);
  }
});

test("the filter works from the keyboard", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `lang-kb-${id}@example.com`, `Keyboard Poet ${id}`);
  await publish(page, `Akwaaba ${id}`, "Akwaaba", "Akan (Twi, Fante, Nzema)");
  await openBoard(page, "/?lang=ak");
  await expect(status(page)).toContainText(/Showing Akan poems? ·/);
  // The filter is a native <select> (keyboard-operable by the browser);
  // check it's focusable and that "Show all" works with Enter.
  await filter(page).focus();
  await expect(filter(page)).toBeFocused();
  const showAll = page.getByRole("button", { name: "Show all languages" });
  await showAll.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(filter(page)).toBeFocused();
  await expect(status(page)).toHaveCount(0);
});
