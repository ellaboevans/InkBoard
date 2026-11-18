import { expect, test } from "@playwright/test";
import { signUpAs, sql, expectBackOnList, chooseOption } from "./helpers";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

test("an author's public page shows their profile and poems, pinned first", async ({ page, browser }) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const pen = `Public Poet ${id}`;
  await signUpAs(page, `public-${id}@example.com`, pen);
  const publish = async (title: string, body: string, password?: string) => {
    await page.goto("/admin/poems/new");
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Poem" }).fill(body);
    if (password) {
      await page.getByRole("switch", { name: "Password protected" }).click();
      await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
    }
    await page.getByRole("button", { name: "Publish to board" }).click();
    await expectBackOnList(page);
  };
  await publish(`First ${id}`, "an early line");
  await publish(`Second ${id}`, "a later line");
  await publish(`Hidden ${id}`, `private words ${id}`, "author-pass");

  await page.goto("/admin/profile");
  await page.getByRole("textbox", { name: /Tagline/ }).fill("Poems for slow mornings");
  await page.getByRole("textbox", { name: "Website" }).fill("example.com/poet");
  await chooseOption(page.getByRole("combobox", { name: "Pinned poem" }), `First ${id}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();

  // The profile links to the public page.
  await page.getByRole("link", { name: "View public page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: pen })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Poems for slow mornings");
  await expect(main).toContainText("3 poems · 1 password protected");
  const link = main.getByRole("link", { name: /example\.com\/poet/ });
  await expect(link).toHaveAttribute("href", "https://example.com/poet");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("target", "_blank");

  // Pinned poem first, then newest first.
  const cards = main.locator("[data-card] h3");
  await expect(cards.first()).toHaveText(`First ${id} (pinned)`, { useInnerText: false });
  await expect(main.locator("[data-card]").first()).toContainText("an early line");
  // What a signed-out reader gets: no private poem text and no email. (Check in a
  // fresh context: the signed-in editor's own tab keeps the admin sidebar, which
  // shows their email, mounted but hidden after client-side navigation.)
  const reader = await browser.newContext();
  const readerPage = await reader.newPage();
  await readerPage.goto(page.url());
  await expect(readerPage.getByRole("heading", { level: 1, name: pen })).toBeVisible();
  await expect(readerPage.getByRole("link", { name: `Hidden ${id} (password protected)` })).toBeVisible();
  const html = await readerPage.content();
  expect(html).not.toContain(`private words ${id}`);
  expect(html).not.toContain(`public-${id}@example.com`);
  await reader.close();

  // Poems open in the overlay here too, and the byline leads back to this page.
  await main.getByRole("link", { name: `Second ${id}` }).click();
  const overlay = page.getByRole("dialog", { name: `Second ${id}` });
  await expect(overlay).toBeVisible();
  await overlay.getByRole("link", { name: pen, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: pen })).toBeVisible();
  // The full poem page (hard load) has the byline too.
  await page.goto(`${new URL(page.url()).pathname.replace(/^\/a\//, "/p/")}/second-${id}`);
  await page.locator("article").getByRole("link", { name: pen, exact: true }).click();
  await expect(page).toHaveURL(/\/a\/public-poet-/);

  expect((await page.goto("/a/nobody-here"))!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Author not found" })).toBeVisible();
});
