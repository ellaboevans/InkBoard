import { expect, test, type Page } from "@playwright/test";
import { expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * The About and Privacy pages (docs/PLAN.md, Phase 19): what they say, the
 * video placeholder, their plumbing (metadata, share card, sitemap, offline
 * marker), and that people can reach them from where they look.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const meta = (page: Page, name: string) => page.locator(`meta[name="${name}"]`).first().getAttribute("content");

test("About: what InkBoard is, the video placeholder (nothing from YouTube), and the way in", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  const res = await page.goto("/about");
  expect(res!.status()).toBe(200);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "About InkBoard" })).toBeVisible();
  await expect(main).toContainText("A home for poetry in Ghanaian languages and English");
  for (const heading of ["What it’s for", "How it works for readers", "How it works for writers", "Come and read, come and write"]) {
    await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }

  // The walkthrough: our own cover with "Video coming soon"; no player, no request to YouTube.
  const video = main.locator('[data-walkthrough="coming-soon"]');
  await expect(video.getByText("Video coming soon")).toBeVisible();
  const cover = video.getByRole("img", { name: /^How InkBoard works/ });
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await cover.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname)).toMatch(/^\/_next\/static\/.*walkthrough-cover-\d+.*\.webp$/);
  await expect(main.locator("iframe")).toHaveCount(0);
  await expect(main.getByRole("button", { name: /Play/ })).toHaveCount(0);
  expect(requested.filter((u) => /youtube|ytimg|googlevideo/.test(u))).toEqual([]);
  // The CSP allows no frames while there's no video.
  expect(res!.headers()["content-security-policy"]).not.toContain("frame-src");

  // The invitation, and the privacy page.
  await expect(main.getByRole("link", { name: "Read the board" })).toHaveAttribute("href", "/");
  await expect(main.getByRole("link", { name: "Start writing" })).toHaveAttribute("href", "/sign-in");
  await main.getByRole("link", { name: "privacy page" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
});

test("About and Privacy: metadata, share card, sitemap, and the offline marker", async ({ page, request }) => {
  for (const [path, title] of [["/about", "About InkBoard"], ["/privacy", "Privacy"]]) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(title));
    expect(await meta(page, "description"), path).toBeTruthy();
    expect(await page.locator('link[rel="canonical"]').getAttribute("href"), path).toMatch(new RegExp(`${path}$`));
    expect(await page.locator('meta[name="robots"]').evaluateAll((ms) => ms.some((m) => m.getAttribute("content")?.includes("noindex")))).toBe(false);
    // Saved for offline reading like the other reader pages (kind "page").
    expect(await meta(page, "inkboard-offline"), path).toBe("save");
    expect(await meta(page, "inkboard-offline-kind"), path).toBe("page");
  }
  await page.goto("/about");
  const og = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  expect(og).toMatch(/\/about\/opengraph-image/);
  const card = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toContain("image/png");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/about</loc>");
  expect(sitemap).toContain("/privacy</loc>");
});

test("Privacy: who runs it, how to reach them, and the facts with an Updated date", async ({ page }) => {
  await page.goto("/privacy");
  const main = page.getByRole("main");
  await expect(main).toContainText("InkBoard is run by Evans Elabo");
  await expect(main.getByText(/^Updated \d{1,2} \w+ \d{4}$/)).toBeVisible();
  const mail = main.getByRole("link", { name: "ellaboevans@gmail.com" }).first();
  await expect(mail).toHaveAttribute("href", "mailto:ellaboevans@gmail.com");
  for (const heading of ["In short", "When you read", "On your device", "When you write", "Cookies", "Services we use", "What you can do", "Changes to this page"]) {
    await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  // A few of the numbers the page takes from the code (tests/privacy/privacy-facts.test.ts checks them all).
  await expect(main).toContainText("A sign-in lasts 30 days");
  await expect(main).toContainText("the sign-in lasts 12 hours");
  await expect(main).toContainText("we haven’t been able to use for 90 days");
  // Services, and no YouTube while there's no video.
  for (const service of ["Vercel", "Neon", "Resend"]) await expect(main.getByText(service, { exact: true }).first()).toBeVisible();
  await expect(main).not.toContainText("YouTube");
});

test("reachable from the board, the list view, reader pages and sign-in; the board toolbar is unchanged", async ({ page, browser }) => {
  test.slow(); // signs up and publishes before the checks
  // A poem on the board (each run starts from an empty database, which shows the empty board instead).
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await signUpAs(page, `about-board-${id}@example.com`, `About Board ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`On the board ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("a line");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);

  // A reader on a phone.
  const reader = await browser.newContext({ viewport: { width: 375, height: 760 } });
  page = await reader.newPage();
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  // Not in the toolbar (it's full on phones): beside Authors, in the overlay column.
  await expect(page.locator("[data-board-toolbar]").getByRole("link", { name: /About/ })).toHaveCount(0);
  await page.getByRole("link", { name: "About InkBoard" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: "About InkBoard" })).toBeVisible();

  // The list view's foot.
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.getByRole("button", { name: "List view" }).click();
  const site = page.getByRole("navigation", { name: "Site" });
  await expect(site.getByRole("link", { name: "About InkBoard" })).toHaveAttribute("href", "/about");
  await expect(site.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");

  // Sign-in screens.
  await page.goto("/sign-in");
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "About InkBoard" }).click();
  await expect(page).toHaveURL(/\/about$/);

  // A reader page, even a missing one.
  await page.goto("/a/nobody-at-all");
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Privacy" })).toBeVisible();
  await reader.close();
});

test("an editor finds the privacy page in Settings", async ({ page }) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await signUpAs(page, `privacy-${id}@example.com`, `Privacy Poet ${id}`);
  await page.goto("/admin/settings");
  await page.getByRole("main").getByRole("link", { name: "privacy page" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
});
