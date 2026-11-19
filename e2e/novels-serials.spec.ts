import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

/*
 * The "ongoing serials" page, /novels (docs/PLAN.md, Phase 29), on a phone:
 * serials still being written, most recently updated first, the finished ones
 * below; a new chapter moves its serial to the top; a private novel shows its
 * lock; "Continue: Chapter n" appears once this browser has read a chapter;
 * the board's "Novels" link gets there.
 *
 * The novels are written straight to the database, then a chapter is
 * published through the app, whose updateTag(BOARD_TAG) refreshes the cache.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();

/** "New chapter" on the writer's novel page, then publish it. */
async function publishChapter(page: Page, novelId: string, title: string) {
  await page.goto(`/admin/novels/${novelId}`);
  await page.getByRole("button", { name: "New chapter" }).click();
  await expect(page).toHaveURL(/\/chapters\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await page.getByRole("textbox", { name: /Chapter title/ }).fill(title);
  await page.getByRole("textbox", { name: "Text" }).fill(`The text of ${title}.`);
  await page.getByRole("button", { name: "Publish chapter" }).click();
  await expect(toast(page, "Chapter published")).toBeVisible({ timeout: 90_000 });
}

/** This test's novels in a section, top to bottom (other tests' novels may be there too). */
async function order(page: Page, section: "ongoing" | "finished", mine: string[]) {
  const titles = await page.locator(`[data-serials="${section}"] [data-serial] h3`).allTextContents();
  return titles.map((t) => t.replace(/ \(novel.*\)$/, "")).filter((t) => mine.includes(t));
}

test("readers find serials most recently updated first, finished ones below, a lock on private ones, and continue where they stopped", async ({ page }) => {
  test.setTimeout(480_000);
  const id = unique();
  const email = `serials-${id}@example.com`;
  await signUpAs(page, email, `Serialist ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const editorId = rows[0].id as string;
  const author = rows[0].slug as string;
  const t = { alpha: `Alpha ${id}`, beta: `Beta ${id}`, done: `Done ${id}`, locked: `Locked ${id}` };
  const mine = Object.values(t);
  await sql(`WITH n AS (
      INSERT INTO novels (editor_id, title, slug, status, visibility, password_hash) VALUES
        ('${editorId}', '${t.alpha}', 'alpha', 'ongoing', 'public', NULL),
        ('${editorId}', '${t.beta}', 'beta', 'ongoing', 'public', NULL),
        ('${editorId}', '${t.done}', 'done', 'complete', 'public', NULL),
        ('${editorId}', '${t.locked}', 'locked', 'ongoing', 'private', 'scrypt$16384$8$1$c2FsdA$aGFzaA')
      RETURNING id, slug)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, release_at, word_count)
    SELECT n.id, 'Opening', 'opening', 'SECRET CHAPTER TEXT', 1, 'published', now() - d.ago, now() - d.ago, 4
    FROM n JOIN (VALUES ('alpha', interval '3 days'), ('beta', interval '4 days'), ('done', interval '1 hour'), ('locked', interval '6 days')) AS d(slug, ago)
      ON d.slug = n.slug`);
  const { rows: made } = await sql(`SELECT id, slug FROM novels WHERE editor_id = '${editorId}'`);
  const novelId = (slug: string) => made.find((r) => r.slug === slug)!.id as string;

  // Beta gets a new chapter through the app: now the most recently updated serial.
  await publishChapter(page, novelId("beta"), "Second Crossing");
  await page.goto("/novels");
  await expect(page.getByRole("heading", { level: 1, name: "Novels" })).toBeVisible();
  await expect.poll(() => order(page, "ongoing", mine)).toEqual([t.beta, t.alpha, t.locked]);
  expect(await order(page, "finished", mine)).toEqual([t.done]);
  await expect(page.getByRole("heading", { name: /Finished/ })).toBeVisible();
  const beta = page.locator('[data-serials="ongoing"] [data-serial="beta"]');
  await expect(beta.locator("[data-serial-latest]")).toContainText("Chapter 2 · Second Crossing");
  await expect(beta).toContainText("2 chapters");

  // The private novel: listed, its lock badge and link name, never its text.
  const locked = page.getByRole("link", { name: `${t.locked} (novel, password protected)` });
  await expect(locked).toBeVisible();
  await expect(page.locator('[data-serial="locked"] [data-lock-badge]')).toBeAttached();
  expect(await page.content()).not.toContain("SECRET CHAPTER TEXT");
  expect(await page.content()).not.toContain(email);

  // Alpha publishes: it moves above Beta.
  await publishChapter(page, novelId("alpha"), "The Landing");
  await page.goto("/novels");
  await expect.poll(() => order(page, "ongoing", mine)).toEqual([t.alpha, t.beta, t.locked]);
  expect(await order(page, "finished", mine)).toEqual([t.done]);

  // No saved place yet: no "Continue". Reading a chapter of Beta adds one, after hydration.
  await page.evaluate(() => localStorage.removeItem("inkboard-reading"));
  await page.reload();
  await expect(page.locator("[data-serial-continue]")).toHaveCount(0);
  await page.goto(`/a/${author}/n/beta/opening`);
  await expect(page.getByRole("heading", { level: 1, name: "Opening" })).toBeVisible();
  await page.goto("/novels");
  const cont = page.locator('[data-serial="beta"]').getByRole("link", { name: "Continue: Chapter 1" });
  await expect(cont).toBeVisible();
  await cont.click();
  await expect(page).toHaveURL(new RegExp(`/a/${author}/n/beta/opening$`));

  // The whole card goes to the novel page.
  await page.goto("/novels");
  await page.getByRole("link", { name: `${t.done} (novel)` }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${author}/n/done$`));

  // No sideways scrolling on a phone.
  await page.goto("/novels");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("the board's Novels link and the site links lead to the page", async ({ page }) => {
  await page.goto("/");
  // After the test above, the board has a section (an empty board shows only its welcome).
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.getByRole("link", { name: "Novels", exact: true }).first().click();
  await expect(page).toHaveURL(/\/novels$/);
  await expect(page.getByRole("heading", { level: 1, name: "Novels" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Novels" })).toBeVisible();
});
