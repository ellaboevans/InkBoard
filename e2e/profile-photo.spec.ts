import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import sharp from "sharp";
import { accountButton, expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * Profile photos (docs/PLAN.md, Phase 22). Test photos are made here with
 * sharp: nothing binary is committed.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PHONE = { width: 375, height: 812 };

/** A portrait "phone photo": red top half, blue bottom half, with GPS and camera EXIF. */
async function phonePhoto(width = 900, height = 1200) {
  const top = await sharp({ create: { width, height: Math.floor(height / 2), channels: 3, background: { r: 230, g: 10, b: 10 } } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 230 } } })
    .composite([{ input: top, left: 0, top: 0 }])
    .withExif({ IFD0: { Make: "PhoneMaker" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "5/1 33/1 0/1" } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Bright red pixels in a PNG: only the photo has them. */
async function redPixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) n++;
  return n;
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function publish(page: Page, title: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill("a line by the river\nand another");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
}

async function choosePhoto(page: Page, buffer: Buffer, name = "IMG_0001.jpg", mimeType = "image/jpeg") {
  // After hydration, or the change event has no handler yet.
  await expect(page.locator('#photo[data-ready="true"]')).toBeAttached();
  await page.locator("[data-photo-input]").setInputFiles({ name, mimeType, buffer });
}

const toast = (page: Page, text: string | RegExp) => page.locator("[data-sileo-toast]").getByText(text).first();

async function shareImageReds(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.status()).toBe(200);
  return redPixels(Buffer.from(await res.body()));
}

async function ogImageReds(page: Page, request: APIRequestContext, path: string) {
  await page.goto(path);
  const og = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  const res = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(res.status()).toBe(200);
  return redPixels(Buffer.from(await res.body()));
}

test("upload, crop and save on a phone; it shows everywhere; remove it and the avatar is back", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize(PHONE);
  const id = unique();
  const pen = `Photo Poet ${id}`;
  await signUpAs(page, `photo-${id}@example.com`, pen);
  await publish(page, `River ${id}`);
  const { rows } = await sql(`SELECT e.slug, p.slug AS poem, e.id FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'River ${id}'`);
  const { slug, poem } = rows[0] as { slug: string; poem: string };
  const poemPath = `/p/${slug}/${poem}`;
  const sharePath = `${poemPath}/share-image`;
  const before = await request.get(sharePath);
  const etagBefore = before.headers()["etag"];
  expect(await redPixels(Buffer.from(await before.body()))).toBe(0);

  await page.goto("/admin/profile");
  const panel = page.getByRole("region", { name: "Profile photo" });
  await expect(panel).toContainText("up to 40 MB");
  await choosePhoto(page, await phonePhoto());

  const dialog = page.getByRole("dialog", { name: "Crop your photo" });
  await expect(dialog).toBeVisible();
  // The photo really shows inside the crop box (not a zero-size wrapper).
  const shown = (await dialog.locator("[data-crop-box] img").boundingBox())!;
  const cropBox = (await dialog.locator("[data-crop-box]").boundingBox())!;
  expect(shown.width).toBeGreaterThanOrEqual(cropBox.width - 1);
  expect(shown.height).toBeGreaterThan(cropBox.height);
  await noSidewaysScroll(page);
  // Keyboard path: the named sliders.
  const zoom = dialog.getByRole("slider", { name: "Zoom" });
  const vertical = dialog.getByRole("slider", { name: "Top to bottom" });
  await expect(dialog.getByRole("slider", { name: "Left to right" })).toBeDisabled(); // portrait at 100%: nothing to move sideways
  await zoom.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(zoom).toHaveAttribute("aria-valuetext", /^1\d\d%$/);
  await vertical.focus();
  await page.keyboard.press("Home"); // the top: the red half
  await expect(vertical).toHaveAttribute("aria-valuetext", "0% from the top");
  // Dragging works too (and keeps the square inside the photo).
  const box = (await dialog.locator("[data-crop-box]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height, { steps: 4 });
  await page.mouse.up();
  await expect(vertical).toHaveAttribute("aria-valuetext", "0% from the top");
  await expect(dialog.getByText("Preview")).toBeVisible();
  await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(toast(page, "Photo saved")).toBeVisible({ timeout: 45_000 });
  await expect(dialog).toBeHidden();

  const key = ((await sql(`SELECT photo_key FROM editors WHERE slug = '${slug}'`)).rows[0] as { photo_key: string }).photo_key;
  expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
  const photo = `img[data-author-picture="photo"][src*="${key}"]`;
  // Profile (header card and photo panel).
  await expect(page.getByRole("main").locator(photo)).toHaveCount(2);
  await expect(panel.getByRole("button", { name: "Change photo" })).toBeVisible();
  await noSidewaysScroll(page);

  // What's served is our copy: WebP, square, no metadata.
  const served = await request.get(`/photos/${key}/384.webp`);
  expect(served.headers()["content-type"]).toBe("image/webp");
  expect(served.headers()["cache-control"]).toBe("public, max-age=3600");
  const meta = await sharp(Buffer.from(await served.body())).metadata();
  expect([meta.width, meta.height, meta.exif, meta.icc]).toEqual([384, 384, undefined, undefined]);

  // Dashboard: the account menu (in the sidebar sheet on phones) shows it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin");
  await expect(accountButton(page, pen).locator(photo)).toBeVisible();

  // Board, author page, byline.
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(page.getByRole("region", { name: `${pen}, 1 poem` }).locator(photo)).toBeAttached();
  await page.goto(`/a/${slug}`);
  await expect(page.locator(`header ${photo}`).first()).toBeVisible();
  await page.goto(poemPath);
  await expect(page.getByRole("main").locator(photo)).toBeVisible();
  await noSidewaysScroll(page);

  // The share image (all three designs) and both link cards draw it; the ETag changed.
  const after = await request.get(sharePath);
  expect(after.headers()["etag"]).not.toBe(etagBefore);
  for (const design of ["", "?design=ink", "?design=board"]) {
    expect(await shareImageReds(request, sharePath + design), design || "page").toBeGreaterThan(3000);
  }
  expect(await ogImageReds(page, request, poemPath)).toBeGreaterThan(3000);
  expect(await ogImageReds(page, request, `/a/${slug}`)).toBeGreaterThan(3000);

  // Remove it: the avatar is back everywhere, and the files are gone.
  await page.setViewportSize(PHONE);
  await page.goto("/admin/profile");
  await page.getByRole("button", { name: "Remove photo" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove your photo?" });
  await confirm.getByRole("button", { name: "Remove photo" }).click();
  await expect(toast(page, "Photo removed")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeFocused();
  await expect(page.getByRole("main").locator('img[data-author-picture="photo"]')).toHaveCount(0);
  expect((await request.get(`/photos/${key}/96.webp`)).status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("region", { name: `${pen}, 1 poem` }).locator('img[data-author-picture="avatar"]')).toBeAttached();
  await page.goto(`/a/${slug}`);
  await expect(page.locator('header img[data-author-picture="avatar"]').first()).toBeVisible();
  await page.goto(poemPath);
  await expect(page.getByRole("main").locator('img[data-author-picture="avatar"]')).toBeVisible();
  expect((await request.get(sharePath)).headers()["etag"]).toBe(etagBefore);
  expect(await shareImageReds(request, sharePath)).toBe(0);
});

test("a wrong type, a HEIC or a too-large file gets a clear error and the old photo stays", async ({ page }) => {
  const id = unique();
  const pen = `Careful Poet ${id}`;
  await signUpAs(page, `photo-err-${id}@example.com`, pen);
  await page.goto("/admin/profile");
  await choosePhoto(page, await phonePhoto(600, 600));
  await page.getByRole("dialog", { name: "Crop your photo" }).getByRole("button", { name: "Save photo" }).click();
  await expect(toast(page, "Photo saved")).toBeVisible({ timeout: 45_000 });
  const key = ((await sql(`SELECT photo_key FROM editors WHERE pen_name = '${pen}'`)).rows[0] as { photo_key: string }).photo_key;

  // A text file named like a photo: the bytes decide.
  await choosePhoto(page, Buffer.from("this is not a photo"), "holiday.jpg");
  await expect(toast(page, "That file isn't a photo we can use. Choose a JPEG, PNG or WebP photo.")).toBeVisible();
  // An iPhone's HEIC, picked as a file (Safari's photo picker sends JPEG).
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic\0\0\0\0mif1heic"), Buffer.alloc(64)]);
  await choosePhoto(page, heic, "IMG_0002.HEIC", "image/heic");
  await expect(toast(page, /HEIC photos can't be used yet/)).toBeVisible();
  // Bigger than anything we'll try to shrink.
  const huge = Buffer.alloc(41 * 1024 * 1024);
  huge.set([0xff, 0xd8, 0xff, 0xe0]);
  await choosePhoto(page, huge, "huge.jpg");
  await expect(toast(page, "That photo is too big. Choose one under 40 MB.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Crop your photo" })).toHaveCount(0);

  // Nothing reached the server; the photo is the one saved first.
  const stillKey = ((await sql(`SELECT photo_key FROM editors WHERE pen_name = '${pen}'`)).rows[0] as { photo_key: string }).photo_key;
  expect(stillKey).toBe(key);
  await expect(page.getByRole("main").locator(`img[data-author-picture="photo"][src*="${key}"]`).first()).toBeVisible();
});

test("a big phone photo is made smaller on the device, then saved", async ({ page }) => {
  test.slow();
  const id = unique();
  await signUpAs(page, `photo-big-${id}@example.com`, `Big Photo ${id}`);
  // Noise doesn't compress: well over the 4 MB upload limit.
  const big = await sharp({ create: { width: 3600, height: 2700, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } })
    .jpeg({ quality: 100 })
    .toBuffer();
  expect(big.length).toBeGreaterThan(4 * 1024 * 1024);
  await page.goto("/admin/profile");
  await choosePhoto(page, big, "PXL_20261101.jpg");
  const posted: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/admin/profile")) posted.push(r.postDataBuffer()?.length ?? 0);
  });
  await page.getByRole("dialog", { name: "Crop your photo" }).getByRole("button", { name: "Save photo" }).click();
  await expect(toast(page, "Photo saved")).toBeVisible({ timeout: 60_000 });
  expect(Math.max(...posted)).toBeLessThan(4 * 1024 * 1024 + 64 * 1024);
});

test("deleting the account deletes the photo's files", async ({ page, request }) => {
  const id = unique();
  const pen = `Leaving Photo ${id}`;
  await signUpAs(page, `photo-leave-${id}@example.com`, pen);
  await page.goto("/admin/profile");
  await choosePhoto(page, await phonePhoto(600, 600));
  await page.getByRole("dialog", { name: "Crop your photo" }).getByRole("button", { name: "Save photo" }).click();
  await expect(toast(page, "Photo saved")).toBeVisible({ timeout: 45_000 });
  const key = ((await sql(`SELECT photo_key FROM editors WHERE pen_name = '${pen}'`)).rows[0] as { photo_key: string }).photo_key;
  expect((await request.get(`/photos/${key}/96.webp`)).status()).toBe(200);
  const { readdir } = await import("node:fs/promises");
  const { E2E_PHOTO_DIR } = await import("../playwright.config");
  expect(await readdir(`${E2E_PHOTO_DIR}/photos/${key}`)).toHaveLength(4);

  // Just signed in by email, so no step-up is needed.
  await page.goto("/admin/settings");
  await page.getByRole("region", { name: "Delete account" }).getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
  await dialog.getByRole("textbox", { name: /Type your pen name/ }).fill(pen);
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 45_000 });
  expect((await request.get(`/photos/${key}/96.webp`)).status()).toBe(404);
  await expect(readdir(`${E2E_PHOTO_DIR}/photos/${key}`)).rejects.toThrow(/ENOENT/);
});
