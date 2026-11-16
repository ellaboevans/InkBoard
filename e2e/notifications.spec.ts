import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectBackOnList, signUpAs, sql } from "./helpers";
import { fakePush, pushRecord } from "./push-stub";

/*
 * "Notifications on this device" (docs/PLAN.md, Phase 18), against `next dev`.
 * The browser's push half is stubbed (e2e/push-stub.ts); the switch's
 * requests, the API and the database are real. The worker's display and
 * click handling run in the production spec (e2e-offline/notifications.spec.ts).
 */

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const SHOTS = "test-results/notification-screens";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  // A poem on the board, so it isn't empty.
  const context = await browser.newContext();
  const page = await context.newPage();
  const id = unique();
  await sql("DELETE FROM rate_limits");
  await signUpAs(page, `notify-board-${id}@example.com`, `Bell Poet ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Lamplight ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("one bulb over the stall,\nmoths keeping the hours");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  await context.close();
});

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}
async function openPopover(page: Page) {
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Follow new poems" });
  await expect(dialog).toBeVisible();
  return dialog;
}
const theSwitch = (scope: Page | ReturnType<Page["getByRole"]>) =>
  scope.getByRole("switch", { name: "Notifications on this device" });
const rows = async (endpoint?: string | null) =>
  Number(
    (
      await sql(
        endpoint
          ? `SELECT count(*) AS n FROM push_subscriptions WHERE endpoint = '${endpoint.replace(/'/g, "''")}'`
          : "SELECT count(*) AS n FROM push_subscriptions",
      )
    ).rows[0].n,
  );
const endpointHere = (page: Page) => page.evaluate(() => (window as unknown as { __pushEndpoint: () => string | null }).__pushEndpoint());

async function standalone(context: BrowserContext) {
  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => {
      const m = real(q);
      if (!q.includes("display-mode")) return m;
      return { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList;
    };
  });
}

async function shot(page: Page, name: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("the switch turns notifications on and off: permission asked only on the tap, the address stored and deleted", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(context, { permission: "default" });
  const page = await context.newPage();
  await openBoard(page);
  await page.waitForTimeout(500);
  expect((await pushRecord(page)).prompts).toBe(0); // never on page load

  const dialog = await openPopover(page);
  const sw = theSwitch(dialog);
  await expect(sw).not.toBeChecked();
  await expect(dialog.getByText(/We keep only what your browser needs to reach this device: no name, no email\./)).toBeVisible();
  await shot(page, "popover-off-1280");
  // The full wording sits behind the disclosure.
  await expect(dialog.getByText(/we don’t record what you read/)).toBeHidden();
  await dialog.getByRole("button", { name: "How notifications work" }).click();
  await expect(dialog.getByText(/is never sent for private poems/)).toBeVisible();
  expect((await pushRecord(page)).prompts).toBe(0);

  await sw.click();
  await expect(sw).toBeChecked();
  expect(await pushRecord(page)).toMatchObject({ prompts: 1, subscribes: 1 });
  const endpoint = await endpointHere(page);
  expect(endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);
  await expect.poll(() => rows(endpoint)).toBe(1);
  await dialog.getByRole("button", { name: "How notifications work" }).click(); // fold it back for the screenshot
  await shot(page, "popover-on-1280");

  // Turning off: unsubscribes here and deletes the row on the server.
  await sw.click();
  await expect(sw).not.toBeChecked();
  expect((await pushRecord(page)).unsubscribes).toBe(1);
  await expect.poll(() => rows(endpoint)).toBe(0);
  expect((await pushRecord(page)).prompts).toBe(1);
  await context.close();
});

test("a browser that already has notifications on shows the switch on", async ({ browser }) => {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: width < 640 ? 812 : 800 } });
    await fakePush(context, { permission: "granted", subscribed: true });
    const page = await context.newPage();
    await openBoard(page);
    const dialog = await openPopover(page);
    await expect(theSwitch(dialog)).toBeChecked();
    if (width === 375) await shot(page, "popover-on-375");
    await context.close();
  }
});

test("blocked in the browser: the switch is off and disabled, and says how to fix it", async ({ browser }) => {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: width < 640 ? 812 : 800 } });
    await fakePush(context, { permission: "denied" });
    const page = await context.newPage();
    await openBoard(page);
    const dialog = await openPopover(page);
    await expect(theSwitch(dialog)).toBeDisabled();
    await expect(theSwitch(dialog)).not.toBeChecked();
    await expect(dialog.getByText(/blocked for InkBoard in this browser.*allow notifications for this site in your browser’s site settings/)).toBeVisible();
    await shot(page, `popover-blocked-${width}`);
    expect((await pushRecord(page)).prompts).toBe(0);
    await context.close();
  }

  // Blocking from the prompt itself lands in the same state.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(context, { permission: "default", answer: "denied" });
  const page = await context.newPage();
  await openBoard(page);
  const dialog = await openPopover(page);
  await theSwitch(dialog).click();
  await expect(theSwitch(dialog)).toBeDisabled();
  await expect(dialog.getByText(/blocked for InkBoard in this browser/)).toBeVisible();
  expect(await pushRecord(page)).toMatchObject({ prompts: 1, subscribes: 0 });
  await context.close();
});

test("unsupported browsers say so; iPhone Safari explains the Home Screen first", async ({ browser }) => {
  const plain = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(plain, { permission: "default", unsupported: true });
  let page = await plain.newPage();
  await openBoard(page);
  let dialog = await openPopover(page);
  await expect(dialog.getByText("This browser can’t show notifications from websites.", { exact: false })).toBeVisible();
  await expect(theSwitch(dialog)).toHaveCount(0);
  await plain.close();

  for (const width of [375, 1280]) {
    const ios = await browser.newContext({ userAgent: IPHONE, viewport: { width, height: width < 640 ? 812 : 800 }, isMobile: width < 640, hasTouch: true });
    await fakePush(ios, { permission: "default", unsupported: true });
    page = await ios.newPage();
    await openBoard(page);
    dialog = await openPopover(page);
    await expect(dialog.getByText(/Add InkBoard to your Home Screen first: tap Share, then Add to Home Screen/)).toBeVisible();
    await expect(theSwitch(dialog)).toHaveCount(0);
    await shot(page, `popover-ios-not-installed-${width}`);
    await ios.close();
  }
});

test("after installing: a one-time offer with the same switch; 'Not now' is remembered", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(context, { permission: "default" });
  const page = await context.newPage();
  await openBoard(page);
  const offer = page.getByRole("region", { name: "Get notified about new poems" });
  await page.waitForTimeout(500);
  await expect(offer).toHaveCount(0); // not installed: no offer

  await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
  await expect(offer).toBeVisible();
  await expect(theSwitch(offer)).not.toBeChecked();
  expect((await pushRecord(page)).prompts).toBe(0); // an offer, not a prompt
  await shot(page, "offer-after-install-1280");
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.waitForTimeout(500);
  await expect(offer).toHaveCount(0);
  await context.close();
});

test("the installed app offers it once on a phone; turning it on there subscribes and ends the offer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await standalone(context);
  await fakePush(context, { permission: "default" });
  const page = await context.newPage();
  await openBoard(page);
  const offer = page.getByRole("region", { name: "Get notified about new poems" });
  await expect(offer).toBeVisible();
  await expect(page.locator('[data-install-slot="board-bottom"] [data-push-offer]')).toBeVisible();
  expect((await pushRecord(page)).prompts).toBe(0);
  await shot(page, "offer-installed-375");

  await theSwitch(offer).click();
  await expect(offer).toHaveCount(0);
  expect(await pushRecord(page)).toMatchObject({ prompts: 1, subscribes: 1 });
  const endpoint = await endpointHere(page);
  await expect.poll(() => rows(endpoint)).toBe(1);
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.waitForTimeout(500);
  await expect(offer).toHaveCount(0);
  await context.close();
  await sql(`DELETE FROM push_subscriptions WHERE endpoint = '${endpoint}'`);
});
