import { expect, test, type Page } from "@playwright/test";
import { expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * The About and Privacy pages (docs/PLAN.md, Phase 19): what they say, the
 * video placeholder, their plumbing (metadata, share card, sitemap, offline
 * marker), and that people can reach them from where they look.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const meta = (page: Page, name: string) => page.locator(`meta[name="${name}"]`).first().getAttribute("content");

test("About: what InkBoard is, the walkthrough (nothing from ImageKit before play), and the way in", async ({ page }) => {
  // The video host is never really reached from tests: record and refuse every request to it.
  // Held until the player has been checked, then refused, so the page's error state shows.
  const toHost: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://ik.imagekit.io/**", async (route) => {
    toHost.push(route.request().url());
    await held;
    await route.abort();
  });
  const res = await page.goto("/about");
  expect(res!.status()).toBe(200);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "About InkBoard" })).toBeVisible();
  await expect(main).toContainText("A home for poetry in Ghanaian languages and English");
  for (const heading of ["What it’s for", "How it works for readers", "How it works for writers", "Come and read, come and write"]) {
    await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }

  // The walkthrough (WALKTHROUGH_VIDEO): our cover as a play button, no <video> and no request to ImageKit yet.
  const video = main.locator("[data-walkthrough]");
  await expect(video).toHaveAttribute("data-walkthrough", "ready");
  const play = video.getByRole("button", { name: "Play the walkthrough" });
  await expect(play).toBeVisible();
  const cover = play.locator("img");
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await cover.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname)).toMatch(/^\/_next\/static\/.*walkthrough-cover-\d+.*\.webp$/);
  await expect(main.locator("video, iframe")).toHaveCount(0);
  await expect(video.getByRole("link", { name: "Kevin MacLeod" })).toHaveAttribute("href", "https://incompetech.com");
  await expect(video.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  await page.waitForLoadState("networkidle");
  expect(toHost).toEqual([]);
  // The CSP allows media from ImageKit's origin, and still no frames.
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toContain("media-src 'self' https://ik.imagekit.io");
  expect(csp).not.toContain("frame-src");

  // Pressing play mounts the browser's player (focused, our cover as poster) and asks ImageKit for the video.
  await play.click();
  const player = main.locator('video[aria-label="InkBoard walkthrough video"]');
  await expect(player).toBeVisible();
  await expect(player).toBeFocused();
  await expect(video).toHaveAttribute("data-walkthrough", "playing");
  expect(new URL((await player.getAttribute("poster")) ?? "", page.url()).pathname).toMatch(/^\/_next\/static\/.*walkthrough-cover-1920.*\.webp$/);
  await expect.poll(() => toHost.length).toBeGreaterThan(0);
  expect(toHost.every((u) => u.startsWith("https://ik.imagekit.io/kkldhhslb/inkboard-walkthrough-final.mp4"))).toBe(true);
  release();
  // Refused here, so it says it couldn't load, and the play button is back to try again.
  await expect(video.getByRole("alert")).toHaveText(/The video couldn’t load/);
  await expect(video).toHaveAttribute("data-walkthrough", "error");
  await expect(video.getByRole("button", { name: "Play the walkthrough" })).toBeVisible();

  // "What's new" (WHATS_NEW_VIDEO), below it: its own cover and play button, the same rule (nothing before play).
  const whatsNew = main.locator("[data-whats-new]");
  await expect(whatsNew).toHaveAttribute("data-whats-new", "ready");
  const playNew = whatsNew.getByRole("button", { name: "Play what’s new" });
  await expect(playNew).toBeVisible();
  const newCover = playNew.locator("img");
  await expect.poll(() => newCover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await newCover.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname)).toMatch(/^\/_next\/static\/.*whats-new-cover-\d+.*\.webp$/);
  await expect(whatsNew.locator("video")).toHaveCount(0);
  const before = toHost.length;
  await playNew.click();
  const newPlayer = main.locator('video[aria-label="What’s new in InkBoard video"]');
  await expect(newPlayer).toBeVisible();
  await expect(newPlayer).toBeFocused();
  expect(new URL((await newPlayer.getAttribute("poster")) ?? "", page.url()).pathname).toMatch(/^\/_next\/static\/.*whats-new-cover-1920.*\.webp$/);
  await expect.poll(() => toHost.length).toBeGreaterThan(before);
  expect(toHost.slice(before).every((u) => u.startsWith("https://ik.imagekit.io/kkldhhslb/whats-new-walkthrough-720p.mp4"))).toBe(true);
  await expect(whatsNew).toHaveAttribute("data-whats-new", "error");
  await expect(whatsNew.getByRole("button", { name: "Play what’s new" })).toBeVisible();

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
  // Services, including the video host (WALKTHROUGH_VIDEO is set), and no YouTube.
  for (const service of ["Vercel", "Neon", "Resend", "ImageKit"]) await expect(main.getByText(service, { exact: true }).first()).toBeVisible();
  await expect(main).toContainText("nothing is loaded from ImageKit before that");
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
