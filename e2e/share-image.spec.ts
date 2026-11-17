import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "../playwright.config";
import { expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * "Share as image" (docs/PLAN.md, Phase 21): the button on public poems (page
 * and overlay), the sheet and its preview, Web Share with the file and text,
 * the desktop fallback, and the image route's caching and 404s.
 *
 * The phone's share sheet can't run here, so navigator.share/canShare are
 * stubbed to record what they're given (and whether the tap's activation was
 * still live); the fallback test removes them, as on Firefox or Linux.
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

async function poemRow(title: string) {
  const { rows } = await sql(
    `SELECT p.id, p.slug, e.slug AS author FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = '${title}'`,
  );
  return rows[0] as { id: string; slug: string; author: string };
}

/** Width and height from a PNG's IHDR. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

type Shared = {
  active: boolean;
  sinceTap: number;
  text?: string;
  title?: string;
  url?: string;
  files: { name: string; type: string; size: number; width: number; height: number }[];
};

/** navigator.share / canShare that record what they get, like a phone that can share files. */
async function stubShare(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __shared: unknown[]; __shareMode: string; __lastTap: number };
    w.__shared = [];
    w.__shareMode = "ok";
    w.__lastTap = 0;
    addEventListener("click", () => (w.__lastTap = performance.now()), true);
    const isImageFile = (f: unknown) => f instanceof File && f.type === "image/png";
    Object.defineProperty(Navigator.prototype, "canShare", {
      configurable: true,
      value: (data?: ShareData) => !!data && (!data.files || data.files.every(isImageFile)),
    });
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: (data: ShareData) => {
        // Recorded synchronously: was the tap's activation still live when share() was called?
        const active = navigator.userActivation.isActive;
        const sinceTap = performance.now() - w.__lastTap;
        const files = data.files ?? [];
        return Promise.all(files.map((f) => createImageBitmap(f))).then((bitmaps) => {
          w.__shared.push({
            active,
            sinceTap,
            text: data.text,
            title: data.title,
            url: data.url,
            files: files.map((f, i) => ({ name: f.name, type: f.type, size: f.size, width: bitmaps[i].width, height: bitmaps[i].height })),
          });
          if (w.__shareMode === "abort") throw new DOMException("Share canceled", "AbortError");
        });
      },
    });
  });
}

/** A browser that can't share files (most desktops, Firefox, in-app browsers). */
async function noShare(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  });
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "Share as image" });
const preview = (page: Page) => sheet(page).getByRole("img", { name: /^Preview of the image: / });

async function expectPreview(page: Page, title: string, pen: string) {
  await expect(preview(page)).toHaveAttribute("alt", `Preview of the image: “${title}” by ${pen}, with lines from the poem and its InkBoard address.`);
  await expect.poll(() => preview(page).evaluate((img: HTMLImageElement) => [img.complete, img.naturalWidth, img.naturalHeight])).toEqual([true, 1080, 1920]);
}

async function noSidewaysScroll(page: Page, label: string) {
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: width < 1000 ? 740 : 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${label} at ${width}px`).toBeLessThanOrEqual(0);
    // The sheet itself stays on screen.
    const box = await sheet(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width, `${label} sheet at ${width}px`).toBe(true);
  }
}

async function setUpPoems(page: Page, kind: string) {
  const id = unique();
  const pen = `Share Poet ${id}`;
  await signUpAs(page, `share-${kind}-${id}@example.com`, pen);
  const open = `Open ${id}`;
  const locked = `Locked ${id}`;
  await publish(page, open, "Àtí ɖèká mèwɔ̀a àvé ò.\n\n*One tree does not make a forest.*");
  await publish(page, locked, `private words ${id}`, "share-pass");
  return { id, pen, open, locked, o: await poemRow(open), l: await poemRow(locked) };
}

test("the button on a poem page: public poems only; the sheet, its preview and focus", async ({ page }) => {
  const { id, pen, open, o, l } = await setUpPoems(page, "page");

  // Under the byline; the sheet opens with focus inside, its preview loaded.
  await page.goto(`/p/${o.author}/${o.slug}`);
  const button = page.getByRole("main").getByRole("button", { name: "Share as image" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /^(Share|Download image)$/ }).first()).toBeFocused();
  await expectPreview(page, open, pen);
  for (const b of await sheet(page).getByRole("button").all()) {
    expect((await b.boundingBox())!.height, (await b.textContent()) ?? "").toBeGreaterThanOrEqual(44);
  }
  await noSidewaysScroll(page, "poem page");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(button).toBeFocused();

  // A private poem: no button, locked or unlocked.
  await page.goto(`/p/${l.author}/${l.slug}`);
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share as image" })).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("share-pass");
  await page.getByRole("button", { name: "Unlock poem" }).click();
  await expect(page.locator("article")).toContainText(`private words ${id}`);
  await expect(page.getByRole("button", { name: "Share as image" })).toHaveCount(0);
});

test("the button in the board's overlay: the sheet opens over it and gives it back", async ({ page }) => {
  const { pen, open, locked } = await setUpPoems(page, "overlay");
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.getByRole("link", { name: open, exact: true }).click();
  const overlay = page.getByRole("dialog", { name: open });
  await expect(overlay).toBeVisible();
  const inOverlay = overlay.getByRole("button", { name: "Share as image" });
  await inOverlay.click();
  await expect(sheet(page)).toBeVisible();
  await expectPreview(page, open, pen);
  await noSidewaysScroll(page, "overlay");
  // Esc closes only the sheet: the overlay keeps its name (the poem's title) and focus returns to the button.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: open })).toBeVisible();
  await expect(inOverlay).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  // A private poem in the overlay: no button.
  await page.getByRole("link", { name: `${locked} (password protected)` }).click();
  await expect(page.getByRole("dialog", { name: locked }).getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: locked }).getByRole("button", { name: "Share as image" })).toHaveCount(0);
});

test("Share hands the PNG and the text to the share sheet, straight from the tap", async ({ page, context }) => {
  await stubShare(context);
  const id = unique();
  const pen = `Sharer ${id}`;
  await signUpAs(page, `sharer-${id}@example.com`, pen);
  const title = `Harmattan ${id}`;
  await publish(page, title, "the dry wind\nwrites on every window");
  const o = await poemRow(title);

  await page.goto(`/p/${o.author}/${o.slug}`);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expectPreview(page, title, pen);
  // Files can be shared here, so there's no WhatsApp link (WhatsApp is in the system sheet).
  await expect(sheet(page).getByRole("link", { name: "Send on WhatsApp" })).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Share", exact: true }).click();

  const shared = () => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);
  await expect.poll(async () => (await shared()).length).toBe(1);
  const [s] = await shared();
  expect(s.active).toBe(true);
  expect(s.sinceTap).toBeLessThan(100);
  expect(s.files).toEqual([{ name: `inkboard-${o.slug}.png`, type: "image/png", size: expect.any(Number), width: 1080, height: 1920 }]);
  expect(s.files[0].size).toBeGreaterThan(20_000);
  expect(s.text).toBe(`“${title}” by ${pen}, on InkBoard: ${E2E_BASE_URL}/p/${o.author}/${o.slug}`);
  expect(s.url).toBeUndefined();

  // Closing the phone's share sheet (AbortError) isn't an error: no toast.
  await page.evaluate(() => ((window as unknown as { __shareMode: string }).__shareMode = "abort"));
  await sheet(page).getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(async () => (await shared()).length).toBe(2);
  await page.waitForTimeout(500);
  await expect(page.locator("[data-sileo-toast]")).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();
});

test("without file sharing: Download image, Copy link and Send on WhatsApp", async ({ page, context }) => {
  await noShare(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = unique();
  const pen = `Desk Poet ${id}`;
  await signUpAs(page, `desk-${id}@example.com`, pen);
  const title = `Desk ${id}`;
  await publish(page, title, "a line for the desktop");
  const o = await poemRow(title);
  const url = `${E2E_BASE_URL}/p/${o.author}/${o.slug}`;

  await page.goto(`/p/${o.author}/${o.slug}`);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Download image" })).toBeFocused();
  await expectPreview(page, title, pen);

  const [download] = await Promise.all([page.waitForEvent("download"), sheet(page).getByRole("button", { name: "Download image" }).click()]);
  expect(download.suggestedFilename()).toBe(`inkboard-${o.slug}.png`);
  const { readFile } = await import("node:fs/promises");
  expect(pngSize(await readFile((await download.path())!))).toEqual({ width: 1080, height: 1920 });

  await sheet(page).getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  const wa = sheet(page).getByRole("link", { name: "Send on WhatsApp" });
  const href = new URL((await wa.getAttribute("href"))!);
  expect(href.origin + href.pathname).toBe("https://wa.me/");
  expect(href.searchParams.get("text")).toBe(`“${title}” by ${pen}, on InkBoard: ${url}`);
  await expect(wa).toHaveAttribute("target", "_blank");
});

test("offline, or a failed load, says so plainly and can try again", async ({ page, context }) => {
  const id = unique();
  await signUpAs(page, `fail-${id}@example.com`, `Fail Poet ${id}`);
  const title = `Fragile ${id}`;
  await publish(page, title, "a line that won't load");
  const o = await poemRow(title);
  await page.goto(`/p/${o.author}/${o.slug}`);

  await page.route("**/share-image", (r) => r.fulfill({ status: 500, body: "boom" }));
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByText("Couldn't load the image. Check your connection and try again.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Download image" })).toHaveAttribute("aria-disabled", "true");
  await page.unroute("**/share-image");
  await sheet(page).getByRole("button", { name: "Try again" }).click();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press("Escape");

  await context.setOffline(true);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByText("You're offline. Connect to the internet to make the image.")).toBeVisible();
  await context.setOffline(false);
});

test("the route: a PNG for a public poem, one uncached 404 for private, draft and unknown poems", async ({ page, request }) => {
  const id = unique();
  const email = `route-${id}@example.com`;
  await signUpAs(page, email, `Route Poet ${id}`);
  await publish(page, `Public ${id}`, "seen by all");
  await publish(page, `Private ${id}`, `private words ${id}`, "route-pass");
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Draft ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill(`draft words ${id}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  const author = (await poemRow(`Public ${id}`)).author;

  const ok = await request.get(`/p/${author}/public-${id}/share-image`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("image/png");
  expect(ok.headers()["cache-control"]).toBe("private, no-cache");
  expect(ok.headers()["content-disposition"]).toBe(`inline; filename="inkboard-public-${id}.png"`);
  const etag = ok.headers()["etag"];
  expect(etag).toMatch(/^"[\w-]{32}"$/);
  expect(pngSize(await ok.body())).toEqual({ width: 1080, height: 1920 });
  // Unchanged: a 304, so the browser's copy costs nothing.
  expect((await request.get(`/p/${author}/public-${id}/share-image`, { headers: { "If-None-Match": etag } })).status()).toBe(304);

  for (const path of [
    `/p/${author}/private-${id}/share-image`,
    `/p/${author}/draft-${id}/share-image`,
    `/p/${author}/no-such-poem/share-image`,
    `/p/nobody-${id}/public-${id}/share-image`,
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(res.headers()["cache-control"], path).toContain("no-store");
    expect(res.headers()["content-type"], path).toContain("text/plain");
    expect(await res.text(), path).not.toContain("words");
  }
});

test("an edit gives a new image; a poem made private, then deleted, stops being served", async ({ page, request }) => {
  const id = unique();
  await signUpAs(page, `edit-${id}@example.com`, `Edit Poet ${id}`);
  const title = `Changing ${id}`;
  await publish(page, title, "the first version");
  const o = await poemRow(title);
  const path = `/p/${o.author}/${o.slug}/share-image`;

  const before = await request.get(path);
  const etag = before.headers()["etag"];
  const bytes = await before.body();

  // An edit: a different picture, and the old ETag no longer matches.
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("the second version\nwith a new line");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  const after = await request.get(path, { headers: { "If-None-Match": etag } });
  expect(after.status()).toBe(200);
  expect(after.headers()["etag"]).not.toBe(etag);
  expect((await after.body()).equals(bytes)).toBe(false);

  // A pen-name change shows on the image too.
  const etag2 = after.headers()["etag"];
  await page.goto("/admin/profile");
  await page.getByRole("textbox", { name: "Pen name" }).fill(`Renamed Poet ${id}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  const renamed = await request.get(path, { headers: { "If-None-Match": etag2 } });
  expect(renamed.status()).toBe(200);
  expect(renamed.headers()["etag"]).not.toBe(etag2);

  // Made private: gone at once, even for a browser holding the last ETag.
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("now-private");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  const priv = await request.get(path, { headers: { "If-None-Match": renamed.headers()["etag"] } });
  expect(priv.status()).toBe(404);
  // And the reading page no longer offers it.
  await page.goto(`/p/${o.author}/${o.slug}`);
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share as image" })).toHaveCount(0);

  // Deleted: still a 404.
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("button", { name: "Delete poem" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete poem" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect((await request.get(path)).status()).toBe(404);
});
