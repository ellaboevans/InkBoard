import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql, expectBackOnList, chooseOption } from "./helpers";

// A poem's language (docs/PLAN.md, Phase 11c): chosen in the editor, shown as
// a label, and set as `lang` on the poem's title and text (never on UI).
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, language: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  await chooseOption(page.getByRole("combobox", { name: "Language" }), language);
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page, 45_000);
}

test("the editor's language reaches the board, the reading page and search engines", async ({ page }) => {
  const id = unique();
  const pen = `Language Poet ${id}`;
  await signUpAs(page, `lang-${id}@example.com`, pen);

  // The card preview follows the choice before saving.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Poem" }).fill("Ŋutifafa na wò");
  await chooseOption(page.getByRole("combobox", { name: "Language" }), "Ewe");
  const preview = page.getByRole("region", { name: "Card preview" });
  await expect(preview.getByText("Ewe", { exact: true })).toBeVisible();
  await expect(preview.locator('p[lang="ee"]')).toContainText("Ŋutifafa");

  await publish(page, `Ŋutifafa ${id}`, "Ŋutifafa na wò, ɖevi", "Ewe");
  await publish(page, `Ɔdɔ ${id}`, "Ɔdɔ yɛ dɛ", "Akan (Twi, Fante, Nzema)", "secret-ɔdɔ");

  // Editing shows the saved choice.
  await page.goto("/admin");
  await page.getByRole("link", { name: `Ŋutifafa ${id}` }).first().click();
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveText("Ewe");

  // Board: a label, and lang on the card's title and text.
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  const card = page
    .locator("[data-card]")
    .filter({ has: page.getByRole("link", { name: `Ŋutifafa ${id}`, exact: true }) });
  await expect(card.getByText("Ewe", { exact: true })).toBeVisible();
  await expect(card.locator('h3[lang="ee"]')).toContainText(`Ŋutifafa ${id}`);
  await expect(card.locator('p[lang="ee"]')).toContainText("Ŋutifafa na wò");

  // Reading page (hard load): byline label, lang on the title and text only.
  await card.getByRole("link").click();
  await expect(page).toHaveURL(/\/p\//);
  await page.goto(page.url());
  const main = page.getByRole("main");
  await expect(main.getByText("· in Ewe")).toBeVisible();
  await expect(main.locator('h1[lang="ee"]')).toHaveText(`Ŋutifafa ${id}`);
  await expect(main.locator('div[lang="ee"]')).toContainText("Ŋutifafa na wò, ɖevi");
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.map((s) => JSON.parse(s)).find((d) => d["@type"] === "CreativeWork")?.inLanguage).toBe("ee");

  // A private poem: the label shows, but the English unlock form isn't marked as Akan.
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  const locked = page
    .locator("[data-card]")
    .filter({ has: page.getByRole("link", { name: `Ɔdɔ ${id} (password protected)`, exact: true }) });
  await expect(locked.getByText("Akan", { exact: true })).toBeVisible();
  await locked.getByRole("link").click();
  await expect(page).toHaveURL(/\/p\//);
  await page.goto(page.url());
  await expect(page.getByRole("main").locator('h1[lang="ak"]')).toHaveText(`Ɔdɔ ${id}`);
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await page.getByRole("button", { name: "Unlock poem" }).evaluate((b) => b.closest("[lang]")?.getAttribute("lang"))).toBe("en");
});
