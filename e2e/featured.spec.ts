import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER_EMAIL } from "../playwright.config";
import { featuredNoticesFor, signInAsOwner, sql } from "./helpers";

/*
 * Featured (docs/PLAN.md, Phase 33), on a phone: the owner features a poem
 * and (by a chapter's link) a novel from the owner's page; the board's
 * Featured panel lists both and the poem opens in the overlay; the cards carry
 * the mark; /novels shows the novel under Featured; the writer is emailed once
 * per work; removing the poem takes it out of the panel.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

test("the owner features a poem and a novel; readers see them first; removing takes one out", async ({ page }) => {
  test.setTimeout(600_000);
  const id = unique();
  const slug = `featured-writer-${id}`;
  const email = `featured-writer-${id}@example.com`;
  const { rows } = await sql(`INSERT INTO editors (email, pen_name, slug) VALUES ('${email}', 'Featured Writer ${id}', '${slug}') RETURNING id`);
  const poemTitle = `Harmattan ${id}`;
  const novelTitle = `The Ferry ${id}`;
  await sql(`INSERT INTO poems (editor_id, title, slug, body, visibility, status, published_at)
    VALUES ('${rows[0].id}', '${poemTitle}', 'harmattan', 'Dust on the sill.', 'public', 'published', now())`);
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', '${novelTitle}', 'ferry') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, release_at, word_count)
    SELECT id, 'Landing', 'landing', 'It began.', 1, 'published'::poem_status, now(), now(), 2 FROM n`);

  // The owner's Featured tab: add by link (a chapter's link features its novel).
  await signInAsOwner(page, E2E_OWNER_EMAIL);
  await page.goto("/admin/owner");
  await page.getByRole("tab", { name: /Featured/ }).click();
  const field = page.getByRole("textbox", { name: "Link to a poem or novel" });
  for (const link of [`/p/${slug}/harmattan`, `/a/${slug}/n/ferry/landing`]) {
    await field.fill(link);
    await page.getByRole("button", { name: "Feature", exact: true }).click();
    await expect(toast(page, "Featured")).toBeVisible({ timeout: 45_000 });
    await expect(field).toHaveValue("");
  }
  // An author can't be featured: a plain message, nothing added.
  await field.fill(`/a/${slug}`);
  await page.getByRole("button", { name: "Feature", exact: true }).click();
  await expect(page.locator("#feature-link-error")).toHaveText("Authors can't be featured, only their poems and novels.");
  await expect(page.locator("[data-featured-item]").filter({ hasText: id })).toHaveCount(2);
  await expect.poll(async () => (await featuredNoticesFor(email)).map((n) => n.what).sort()).toEqual(["novel", "poem"]);

  // The board: the Featured panel lists both; the cards carry the mark.
  await openBoard(page);
  await page.getByRole("button", { name: "Featured", exact: true }).click();
  const panel = page.getByRole("navigation", { name: "Featured" });
  await expect(panel.getByRole("link", { name: new RegExp(poemTitle) })).toBeVisible();
  await expect(panel.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
  for (const t of [poemTitle, novelTitle]) {
    await expect(page.locator("[data-card]").filter({ has: page.getByRole("link", { name: new RegExp(t) }) }).locator("[data-featured-mark]")).toHaveText("Featured");
  }
  // A poem opens in the overlay, over the board.
  await panel.getByRole("link", { name: new RegExp(poemTitle) }).click();
  await expect(page.getByRole("dialog", { name: poemTitle })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[aria-label="Poem board"]')).toBeAttached();

  // /novels: the novel under Featured, first.
  await page.goto("/novels");
  const featuredSection = page.locator('[data-serials="featured"]');
  await expect(featuredSection.getByRole("heading", { name: /Featured/ })).toBeVisible();
  await expect(featuredSection).toContainText(novelTitle);
  expect(await page.locator("[data-serials]").first().getAttribute("data-serials")).toBe("featured");

  // The owner removes the poem: gone from the panel, the novel stays.
  await page.goto("/admin/owner");
  await page.getByRole("tab", { name: /Featured/ }).click();
  await page.locator("[data-featured-item]").filter({ hasText: poemTitle }).getByRole("button", { name: /^Remove/ }).click();
  await expect(toast(page, "Removed from Featured")).toBeVisible({ timeout: 45_000 });
  await openBoard(page);
  await page.getByRole("button", { name: "Featured", exact: true }).click();
  await expect(panel.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
  await expect(panel.getByRole("link", { name: new RegExp(poemTitle) })).toHaveCount(0);
  // No email on removal.
  expect(await featuredNoticesFor(email)).toHaveLength(2);
});
