import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";
import { accountButton, signUpAs, sql, expectBackOnList } from "./helpers";

/*
 * The "install InkBoard" nudge (docs/PLAN.md, Phase 15). Chromium's
 * `beforeinstallprompt` is simulated by an init script; the per-browser
 * memory (visits, dismissals) is seeded in localStorage.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KEY = "inkboard-install";

const UA = {
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
};
const phone = (ua: string, width = 390, height = 844): BrowserContextOptions => ({
  userAgent: ua,
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
});

/** A synthetic `beforeinstallprompt` after load; prompt() is recorded on window. */
async function fakeInstallPrompt(context: BrowserContext, outcome: "accepted" | "dismissed" = "accepted") {
  await context.addInitScript((outcome) => {
    addEventListener("load", () => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
      e.prompt = async () => {
        (window as unknown as { __prompted: number }).__prompted = ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1;
      };
      e.userChoice = Promise.resolve({ outcome, platform: "web" });
      dispatchEvent(e);
    });
  }, outcome);
}

/** This load counts as a second visit (the first was an hour ago). Kept across reloads. */
async function returningReader(context: BrowserContext, extra: Record<string, unknown> = {}) {
  await context.addInitScript(
    ([key, extra]) => {
      if (localStorage.getItem(key)) return;
      const hourAgo = Date.now() - 3_600_000;
      localStorage.setItem(key, JSON.stringify({ visits: 1, visitStart: hourAgo, lastSeen: hourAgo, poems: [], ...extra }));
    },
    [KEY, extra] as const,
  );
}

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}
const card = (page: Page) => page.locator("[data-install-card]");
const prompted = (page: Page) => page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted ?? 0);
const installButton = (page: Page) => page.getByRole("button", { name: "Install InkBoard" });

/** A button's height in whole CSS px, once the card's entrance animation is over (it can measure 43.9999 mid-slide). */
async function touchHeight(l: Locator) {
  await l.page().waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  return Math.round((await box(l)).height);
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

// Two poems on the board for every test.
let poemTitles: string[] = [];
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const id = unique();
  await sql("DELETE FROM rate_limits");
  await signUpAs(page, `nudge-board-${id}@example.com`, `Nudge Poet ${id}`);
  poemTitles = [`Solstice ${id}`, `Lantern ${id}`];
  for (const title of poemTitles) {
    await page.goto("/admin/poems/new");
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Poem" }).fill("shortest day —\nthe cat follows\nthe last square of sun");
    await page.getByRole("button", { name: "Publish to board" }).click();
    await expectBackOnList(page);
  }
  await context.close();
});

test("Chromium: a returning reader gets the card; Install calls prompt(), and appinstalled hides everything", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeInstallPrompt(context);
  await returningReader(context);
  const page = await context.newPage();
  await openBoard(page);

  const region = page.getByRole("region", { name: "Install InkBoard" });
  await expect(region).toBeVisible();
  // Never steals focus.
  await expect(region).not.toBeFocused();
  expect(await region.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  // Wide screens: under the toolbar, hanging from the install button.
  await expect(page.locator('[data-install-slot="board-top"] [data-install-card]')).toBeVisible();
  await expect(installButton(page)).toBeVisible();

  await region.getByRole("button", { name: "Install" }).click();
  await expect.poll(() => prompted(page)).toBe(1);
  await expect(card(page)).toHaveCount(0);

  await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
  await expect(installButton(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.waitForTimeout(1000); // the synthetic prompt has fired by now
  await expect(card(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
  await context.close();
});

test("first visit: nothing at first; Esc and 'Not now' hide it for 30 days, across reloads", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeInstallPrompt(context);
  const page = await context.newPage();
  await openBoard(page);
  await page.waitForTimeout(1000);
  await expect(card(page)).toHaveCount(0); // a first visit: no card yet
  await expect(installButton(page)).toBeVisible(); // but installing is one click away

  // Now pretend it's a later visit.
  await page.evaluate((key) => {
    const hourAgo = Date.now() - 3_600_000;
    localStorage.setItem(key, JSON.stringify({ visits: 1, visitStart: hourAgo, lastSeen: hourAgo, poems: [] }));
  }, KEY);
  await page.reload();
  const region = page.getByRole("region", { name: "Install InkBoard" });
  await expect(region).toBeVisible();

  // Esc dismisses (like Not now).
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  const until = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).notNowUntil as number, KEY);
  expect(until - Date.now()).toBeGreaterThan(29 * 24 * 3_600_000);

  // Reset, then "Not now" folds it back into the toolbar button, which gets focus.
  await page.evaluate((key) => {
    const m = JSON.parse(localStorage.getItem(key)!);
    delete m.notNowUntil;
    m.lastSeen = Date.now() - 3_600_000;
    localStorage.setItem(key, JSON.stringify(m));
  }, KEY);
  await page.reload();
  await region.getByRole("button", { name: "Not now" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(installButton(page)).toBeFocused();

  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.waitForTimeout(1000);
  await expect(card(page)).toHaveCount(0);
  // The toolbar button still installs.
  await installButton(page).click();
  await expect.poll(() => prompted(page)).toBe(1);
  await context.close();
});

test("readers who open two poems get the card on the board (not in the first seconds)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeInstallPrompt(context);
  // A first visit that started a minute ago (past the grace period).
  await context.addInitScript((key) => {
    if (localStorage.getItem(key)) return;
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({ visits: 1, visitStart: now - 60_000, lastSeen: now, poems: [] }));
  }, KEY);
  const page = await context.newPage();
  await openBoard(page);
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);

  for (const title of poemTitles) {
    await page.getByRole("link", { name: title, exact: true }).click();
    // Wait for the poem itself (the dialog is named by its title once loaded), not the
    // "Loading poem" skeleton: a poem closed before it rendered was never read, so it isn't counted.
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
    await page.keyboard.press("Escape"); // closes the poem, not the (absent) card
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(page.getByRole("region", { name: "Install InkBoard" })).toBeVisible();
  await context.close();
});

test("iPhone Safari: the two-step instructions, below the zoom bar, pointing at Share; Got it is for good", async ({ browser }) => {
  const context = await browser.newContext(phone(UA.iphone));
  await returningReader(context);
  const page = await context.newPage();
  await openBoard(page);

  const region = page.getByRole("region", { name: "Put InkBoard on your home screen" });
  await expect(region).toBeVisible();
  await expect(region).toContainText("Tap Share in the bar below");
  await expect(region).toContainText("Choose Add to Home Screen");
  await expect(region.getByRole("button", { name: "Install" })).toHaveCount(0);
  await expect(region.locator("[data-install-pointer]")).toBeVisible();
  // Below the zoom bar, so the arrow has a clear line down.
  const zoom = await box(page.locator("[data-zoom-bar]"));
  expect((await box(region)).y).toBeGreaterThanOrEqual(zoom.y + zoom.height);
  // No toolbar button on phones.
  await expect(installButton(page)).toBeHidden();
  for (const name of ["Not now", "Got it"]) {
    expect(await touchHeight(region.getByRole("button", { name }))).toBeGreaterThanOrEqual(44);
  }

  await region.getByRole("button", { name: "Got it" }).click();
  await expect(card(page)).toHaveCount(0);
  const memory = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(memory.gotIt).toBe(true);
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);
  await context.close();
});

test("Mac Safari: the File › Add to Dock variant, opened from the toolbar button too", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: UA.macSafari, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await openBoard(page);
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0); // first visit
  await installButton(page).click();
  const region = page.getByRole("region", { name: "Add InkBoard to your Dock" });
  await expect(region).toBeVisible();
  await expect(region).toContainText("File");
  await expect(region).toContainText("Add to Dock…");
  await expect(installButton(page)).toHaveAttribute("aria-expanded", "true");
  await installButton(page).click(); // toggles it closed
  await expect(card(page)).toHaveCount(0);
  await context.close();
});

test("installed (standalone) or unable to install: nothing at all", async ({ browser }) => {
  // Running as the installed app, even with a prompt and a returning reader.
  const standalone = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await standalone.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => {
      const m = real(q);
      if (!q.includes("display-mode")) return m;
      return { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList;
    };
  });
  await fakeInstallPrompt(standalone);
  await returningReader(standalone);
  let page = await standalone.newPage();
  await openBoard(page);
  await page.waitForTimeout(1000);
  await expect(card(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
  await standalone.close();

  // A browser that never fires beforeinstallprompt (e.g. Firefox desktop).
  const firefoxLike = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await returningReader(firefoxLike);
  page = await firefoxLike.newPage();
  await openBoard(page);
  await page.waitForTimeout(1000);
  await expect(card(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
  await firefoxLike.close();
});

test("editors: the writer card right after their first-ever publish, not after later ones", async ({ browser }) => {
  const context = await browser.newContext(phone(UA.android));
  await fakeInstallPrompt(context);
  const page = await context.newPage();
  const id = unique();
  await signUpAs(page, `nudge-writer-${id}@example.com`, `Nudge Writer ${id}`);
  await expect(card(page)).toHaveCount(0);

  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Unwritten ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("blank page\nthe pen's\nlong pause");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  await expect(card(page)).toHaveCount(0); // a draft isn't a publish

  // Publishing the draft: back on the list (Phase 15's writer card follows the editor there).
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  const region = page.getByRole("region", { name: "Write from your home screen" });
  await expect(region).toBeVisible();
  await expect(region).toContainText("Your poems one tap away, ready when a line arrives.");
  await expect(page.locator('[data-install-slot="editor"] [data-install-card="writer"]')).toBeVisible();
  for (const name of ["Not now", "Install"]) {
    expect(await touchHeight(region.getByRole("button", { name }))).toBeGreaterThanOrEqual(44);
  }
  await region.getByRole("button", { name: "Install" }).click();
  await expect.poll(() => prompted(page)).toBe(1);
  await expect(card(page)).toHaveCount(0);

  // A second poem, published straight away: no card.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Second ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("another");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);
  await context.close();
});

test("first publish at creation shows the writer card on the list (flash param, stripped)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeInstallPrompt(context);
  const page = await context.newPage();
  const id = unique();
  await signUpAs(page, `nudge-new-${id}@example.com`, `Nudge New ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Straight out ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("published at once");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  await expect(page.locator('[data-install-slot="editor"] [data-install-card="writer"]')).toBeVisible();
  // Desktop copy for writers.
  await expect(page.getByRole("region", { name: "Install InkBoard" })).toContainText("Your poems in their own window");
  await expect(page).not.toHaveURL(/first-publish/);
  await context.close();
});

test("account menu: 'Install app' opens the browser's prompt, or the instructions", async ({ browser }) => {
  const chromium = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeInstallPrompt(chromium);
  let page = await chromium.newPage();
  const id = unique();
  await signUpAs(page, `nudge-menu-${id}@example.com`, `Nudge Menu ${id}`);
  await accountButton(page, `Nudge Menu ${id}`).click();
  await page.getByRole("menuitem", { name: "Install app" }).click();
  await expect.poll(() => prompted(page)).toBe(1);
  await chromium.close();

  const safari = await browser.newContext({ userAgent: UA.macSafari, viewport: { width: 1280, height: 800 } });
  page = await safari.newPage();
  await signUpAs(page, `nudge-menu-mac-${id}@example.com`, `Nudge Mac ${id}`);
  await accountButton(page, `Nudge Mac ${id}`).click();
  await page.getByRole("menuitem", { name: "Install app" }).click();
  const region = page.getByRole("region", { name: "Add InkBoard to your Dock" });
  await expect(region).toBeVisible();
  await expect(region).toContainText("Opens your poems in their own window.");
  await expect(page.locator('[data-install-slot="editor"] [data-install-card]')).toBeVisible();
  await region.getByRole("button", { name: "Got it" }).click();
  await expect(card(page)).toHaveCount(0);
  await safari.close();

  // Without a way to install, the item isn't there.
  const none = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await none.newPage();
  await signUpAs(page, `nudge-menu-none-${id}@example.com`, `Nudge None ${id}`);
  await accountButton(page, `Nudge None ${id}`).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Install app" })).toHaveCount(0);
  await none.close();
});

for (const width of [320, 375, 768, 1280]) {
  test(`layout at ${width}px: the card never covers the zoom bar or the minimap`, async ({ browser }) => {
    const narrow = width < 640;
    const context = await browser.newContext(
      narrow ? phone(UA.android, width, 740) : { viewport: { width, height: width === 768 ? 1024 : 800 } },
    );
    await fakeInstallPrompt(context);
    await returningReader(context);
    const page = await context.newPage();
    await openBoard(page);
    const region = card(page);
    await expect(region).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    const cardBox = await box(region);
    const zoom = await box(page.locator("[data-zoom-bar]"));
    expect(overlaps(cardBox, zoom), "card vs zoom bar").toBe(false);
    const minimap = page.locator("[data-minimap]");
    if (await minimap.isVisible()) expect(overlaps(cardBox, await box(minimap)), "card vs minimap").toBe(false);
    // Inside the screen, and no sideways scrolling.
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator(narrow ? '[data-install-slot="board-bottom"] [data-install-card]' : '[data-install-slot="board-top"] [data-install-card]')).toBeVisible();
    if (process.env.INSTALL_SHOTS) await page.screenshot({ path: `${process.env.INSTALL_SHOTS}/board-${width}.png` });
    await context.close();
  });
}

test("wide screens: with a language filter and the Authors list open, the card covers neither (and still points at its button)", async ({ browser }) => {
  // An Ewe poem, so the board can be filtered.
  const setup = await browser.newContext();
  const editor = await setup.newPage();
  const id = unique();
  await signUpAs(editor, `nudge-lang-${id}@example.com`, `Nudge Ewe ${id}`);
  await editor.goto("/admin/poems/new");
  await editor.getByRole("textbox", { name: "Title" }).fill(`Ŋdi ${id}`);
  await editor.getByRole("textbox", { name: "Poem" }).fill("ŋdi nyuie");
  await editor.getByRole("combobox", { name: "Language" }).selectOption({ label: "Ewe" });
  await editor.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(editor);
  await setup.close();

  for (const width of [640, 700, 768, 1024, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    await fakeInstallPrompt(context);
    await returningReader(context);
    const page = await context.newPage();
    await page.goto("/?lang=ee");
    await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
    const pill = page.locator("[data-filter-status]");
    await expect(pill).toBeVisible();
    const region = card(page);
    await expect(region).toBeVisible();
    await page.getByRole("button", { name: /^Authors/ }).click();
    const list = page.getByRole("navigation", { name: "Authors" });
    await expect(list).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));

    const cardBox = await box(region);
    expect(overlaps(cardBox, await box(pill)), `${width}px: card vs filter pill`).toBe(false);
    expect(overlaps(cardBox, await box(list)), `${width}px: card vs Authors list`).toBe(false);
    expect(overlaps(cardBox, await box(page.getByRole("button", { name: /^Authors/ }))), `${width}px: card vs Authors button`).toBe(false);
    // The tail still points at the toolbar's install button.
    const tail = await box(region.locator("[data-install-tail]"));
    const button = await box(installButton(page));
    expect(Math.abs(tail.x + tail.width / 2 - (button.x + button.width / 2)), `${width}px: tail under the button`).toBeLessThan(4);
    expect(tail.y).toBeGreaterThan(button.y + button.height);
    // The pill stays on screen, and nothing scrolls sideways.
    expect((await box(pill)).x).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (process.env.INSTALL_SHOTS) await page.screenshot({ path: `${process.env.INSTALL_SHOTS}/filter-${width}.png` });
    await context.close();
  }
});

test("Esc that closes a poem overlay doesn't dismiss the card", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeInstallPrompt(context);
  await returningReader(context);
  const page = await context.newPage();
  await openBoard(page);
  await expect(page.getByRole("region", { name: "Install InkBoard" })).toBeVisible();
  for (const title of poemTitles) {
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Install InkBoard" })).toBeVisible();
  }
  const memory = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(memory.notNowUntil).toBeUndefined();
  // With nothing else open, Esc is the card's.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await context.close();
});
