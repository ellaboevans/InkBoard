import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

/*
 * Novels in the dashboard (docs/PLAN.md, Phase 23a), on a phone-sized
 * viewport: create a novel, add and order chapters, the device draft,
 * publishing, History, deleting.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** The device drafts the chapter editor has left in localStorage. */
const draftKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("inkboard-chapter-draft:")).sort());

/** Chapter titles on the novel page, in order. */
async function chapterOrder(page: Page) {
  return page.locator("[data-chapter-link]").allTextContents();
}

test("a writer creates a novel, orders chapters, restores a device draft, publishes, uses History and deletes it", async ({ page }) => {
  test.slow();
  const id = unique();
  await signUpAs(page, `novelist-${id}@example.com`, `Novelist ${id}`);

  // The list, and "New novel" in a dialog.
  await page.goto("/admin/novels");
  await expect(page.getByRole("heading", { level: 1, name: "Novels" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No novels yet");
  await noSidewaysScroll(page);
  await page.getByRole("button", { name: "New novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New novel" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("The Ferry at Yeji");
  await dialog.getByRole("textbox", { name: /Blurb/ }).fill("Every Thursday the ferry crosses the lake.");
  await dialog.getByRole("button", { name: "Create novel" }).click();
  await expect(page).toHaveURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await expect(toast(page, "Novel created")).toBeVisible();
  const novelUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { level: 1, name: "The Ferry at Yeji" })).toBeVisible();
  await noSidewaysScroll(page);

  // Three chapters, each a new draft opened in the editor.
  for (const title of ["Thursday", "The Landing", "The Radio"]) {
    await page.getByRole("button", { name: "New chapter" }).click();
    await expect(page).toHaveURL(/\/chapters\/[0-9a-f-]{36}/, { timeout: 45_000 });
    await page.getByRole("textbox", { name: /Chapter title/ }).fill(title);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(toast(page, "Draft saved")).toBeVisible({ timeout: 45_000 });
    await page.goto(novelUrl);
  }
  await expect.poll(() => chapterOrder(page)).toEqual(["Thursday", "The Landing", "The Radio"]);
  // Every save cleared its chapter's device draft.
  expect(await draftKeys(page)).toEqual([]);

  // Reorder with the buttons (the keyboard path): focus follows the chapter.
  const up = page.getByRole("button", { name: "Move “The Radio” up" });
  await up.click();
  await expect.poll(() => chapterOrder(page)).toEqual(["Thursday", "The Radio", "The Landing"]);
  await expect(page.getByRole("status").filter({ hasText: "Moved “The Radio” to position 2 of 3." })).toBeAttached();
  await expect(up).toBeFocused();
  const firstUp = page.getByRole("button", { name: "Move “Thursday” up" });
  await expect(firstUp).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Move “Thursday” down" }).click();
  await expect.poll(() => chapterOrder(page)).toEqual(["The Radio", "Thursday", "The Landing"]);
  await noSidewaysScroll(page);

  // Type in a chapter, reload: the draft on this device is offered and restored.
  await page.getByRole("link", { name: "Thursday" }).click();
  await expect(page.getByRole("textbox", { name: /Chapter title/ })).toHaveValue("Thursday");
  const text = page.getByRole("textbox", { name: "Text" });
  await text.fill("The ferry came late.\n\n* * *\n\nAkua waited at the landing.");
  await expect(page.getByText("9 words · about 1 minute to read", { exact: false })).toBeVisible();
  const chapterId = new URL(page.url()).pathname.split("/").pop()!;
  await expect.poll(() => draftKeys(page)).toEqual([`inkboard-chapter-draft:${chapterId}`]);
  await noSidewaysScroll(page);
  await page.reload();
  const offer = page.locator("[data-device-draft]");
  await expect(offer).toContainText("A newer draft is saved on this device");
  await expect(text).toHaveValue(""); // the saved chapter is still empty
  await offer.getByRole("button", { name: "Restore draft" }).click();
  await expect(text).toHaveValue("The ferry came late.\n\n* * *\n\nAkua waited at the landing.");
  await expect(offer).toHaveCount(0);

  // Preview renders what readers will get.
  await page.getByRole("tab", { name: "Preview" }).click();
  const preview = page.getByRole("article", { name: "Preview of Thursday" });
  await expect(preview.locator("p")).toHaveText(["The ferry came late.", "Akua waited at the landing."]);
  await expect(preview.getByRole("separator", { name: "Scene break" })).toBeVisible();
  await page.getByRole("tab", { name: "Write" }).click();

  // Publish, then unpublish. A successful save clears the device draft.
  await page.getByRole("button", { name: "Publish chapter" }).click();
  await expect(toast(page, "Chapter published")).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => draftKeys(page)).toEqual([]);
  await expect(page.getByRole("main").getByText("Published", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(toast(page, "Chapter unpublished")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Publish chapter" })).toBeVisible();

  // A second version, then History: open the older one and restore it into the form.
  await text.fill("The ferry came very late.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(toast(page, "Draft saved")).toBeVisible({ timeout: 45_000 });
  const history = page.getByRole("region", { name: "History" });
  // Newest first: the edit, the published text, the titled draft, the empty new chapter.
  await expect(history.getByRole("link")).toHaveCount(4, { timeout: 30_000 });
  await history.getByRole("link").nth(1).click();
  const version = page.getByRole("dialog", { name: /Earlier version, saved/ });
  await expect(version).toBeVisible();
  await version.getByRole("button", { name: "Restore this version" }).click();
  await expect(toast(page, "Version restored in the editor")).toBeVisible();
  await expect(text).toHaveValue("The ferry came late.\n\n* * *\n\nAkua waited at the landing.");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  await noSidewaysScroll(page);

  // Delete the novel, behind a confirmation.
  await page.goto(novelUrl);
  await page.getByRole("button", { name: "Delete novel" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete “The Ferry at Yeji”?" });
  await expect(confirm).toContainText("Its 3 chapters and their saved versions go with it.");
  await confirm.getByRole("button", { name: "Delete novel" }).click();
  await expect(page).toHaveURL(/\/admin\/novels\?deleted=1$|\/admin\/novels$/, { timeout: 45_000 });
  await expect(toast(page, "Novel deleted")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No novels yet");
  const { rows } = await sql(`SELECT count(*)::int AS n FROM novels n JOIN editors e ON e.id = n.editor_id WHERE e.email = 'novelist-${id}@example.com'`);
  expect((rows[0] as { n: number }).n).toBe(0);
});
