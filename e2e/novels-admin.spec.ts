import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { signUpAs, sql } from "./helpers";

/*
 * Novels in the dashboard (docs/PLAN.md, Phase 23a), on a phone-sized
 * viewport: create a novel, add and order chapters, the device draft,
 * publishing, History, deleting; and (Phase 25) uploading a cover, cropping
 * it to 2:3, seeing it for readers, and removing it.
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
  const version = page.getByRole("dialog", { name: /Earlier version, saved/ });
  // Closing takes ?version= out of the address bar at once (not after a server round trip), so
  // a reload straight after closing doesn't bring the dialog back (it did: the a11y test hit it).
  const openOlder = async () => {
    await history.getByRole("link").nth(1).click();
    await expect(page).toHaveURL(/\?version=/);
    await expect(version).toBeVisible();
  };
  await openOlder();
  await page.keyboard.press("Escape");
  expect(page.url()).not.toContain("version="); // synchronous: no waiting, no retry
  await expect(version).toHaveCount(0);
  await openOlder(); // the same version again, without a reload
  await version.getByRole("button", { name: "Close" }).first().click();
  expect(page.url()).not.toContain("version=");
  await page.reload();
  await expect(text).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/version=/);
  await openOlder();
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

/** A phone-sized picture made here (nothing binary is committed): red top half, blue bottom. */
async function coverPicture(width = 900, height = 1200) {
  const top = await sharp({ create: { width, height: Math.floor(height / 2), channels: 3, background: { r: 230, g: 10, b: 10 } } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 230 } } })
    .composite([{ input: top, left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

test("a writer uploads a cover, crops it to 2:3, readers see it on the novel page and the board, and removing it brings the drawn cover back", async ({ page }) => {
  test.slow();
  const id = unique();
  const email = `cover-${id}@example.com`;
  await signUpAs(page, email, `Cover Writer ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const author = rows[0].slug as string;
  // A novel with a published chapter, straight to the database; the cover's save refreshes the readers' cache.
  const { rows: made } = await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, blurb)
      VALUES ('${rows[0].id}', 'The Red Ferry', 'red-ferry', 'A ferry.') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count)
    SELECT id, 'Thursday', 'thursday', 'The ferry came late.', 1, 'published', now(), 4 FROM n RETURNING novel_id`);
  const adminUrl = `/admin/novels/${made[0].novel_id}`;

  // The drawn cover first, in the details.
  await page.goto(adminUrl);
  const panel = page.locator('[data-cover-panel][data-ready="true"]');
  await expect(panel).toBeAttached();
  await expect(panel.locator('[data-novel-cover="drawn"]')).toBeVisible();
  const upload = page.getByRole("button", { name: "Upload cover" });
  await expect(upload).toBeVisible();
  expect((await upload.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Choose a picture: the 2:3 crop step, by keyboard (the sliders) as well as by dragging.
  await page.locator("[data-cover-input]").setInputFiles({ name: "IMG_0002.jpg", mimeType: "image/jpeg", buffer: await coverPicture() });
  const crop = page.getByRole("dialog", { name: "Crop the cover" });
  await expect(crop).toBeVisible();
  const box = (await crop.locator("[data-crop-box]").boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(2 / 3, 1);
  await crop.getByRole("slider", { name: "Zoom" }).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  // Zoomed in, all the way up: the red top of the picture.
  await crop.getByRole("slider", { name: "Top to bottom" }).fill("0");
  await expect(crop.getByText("Preview")).toBeVisible();
  await noSidewaysScroll(page);
  const save = crop.getByRole("button", { name: "Save cover" });
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.click();
  await expect(toast(page, "Cover saved")).toBeVisible({ timeout: 45_000 });
  await expect(crop).toHaveCount(0);
  await expect(panel.locator('[data-novel-cover="uploaded"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Change cover" })).toBeFocused();
  const { rows: keyRows } = await sql(`SELECT cover_key FROM novels WHERE id = '${made[0].novel_id}'`);
  const key = keyRows[0].cover_key as string;
  expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);

  // Readers: the novel page draws it (our own WebP, red at the top), over the drawn cover.
  const novelUrl = `/a/${author}/n/red-ferry`;
  await page.goto(novelUrl);
  const cover = page.getByRole("main").locator('[data-novel-cover="uploaded"]');
  await expect(cover).toBeVisible();
  const img = cover.locator("img[data-cover-image]");
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  const src = await img.evaluate((el: HTMLImageElement) => el.currentSrc);
  expect(new URL(src).pathname).toMatch(new RegExp(`^/covers/${key}/(128|256|512)\\.webp$`));
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/webp");
  const { data, info } = await sharp(Buffer.from(await served.body())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.height / info.width).toBeCloseTo(1.5, 2);
  expect(data[0]).toBeGreaterThan(150); // the top-left pixel is red
  expect(data[2]).toBeLessThan(100);
  await noSidewaysScroll(page);

  // The board's book card.
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(page.locator('[data-book-card] [data-novel-cover="uploaded"]')).toBeAttached();

  // Remove it: the drawn cover is back everywhere and the files are gone.
  await page.goto(adminUrl);
  await expect(panel).toBeAttached();
  await page.getByRole("button", { name: "Remove cover" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove this cover?" });
  await confirm.getByRole("button", { name: "Remove cover" }).click();
  await expect(toast(page, "Cover removed")).toBeVisible({ timeout: 45_000 });
  await expect(panel.locator('[data-novel-cover="drawn"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload cover" })).toBeFocused();
  expect((await page.request.get(src)).status()).toBe(404);
  await page.goto(novelUrl);
  await expect(page.getByRole("main").locator('[data-novel-cover="drawn"]')).toBeVisible();
  await expect(page.getByRole("main").locator("img[data-cover-image]")).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(page.locator('[data-book-card] [data-novel-cover="drawn"]')).toBeAttached();
});
