import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectBackOnList, pushesFor, signUpAs, sql } from "./helpers";
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

// The board's one author (round 2's follow tests use their page).
let author = { slug: "", penName: "" };

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  // A poem on the board, so it isn't empty.
  const context = await browser.newContext();
  const page = await context.newPage();
  const id = unique();
  await sql("DELETE FROM rate_limits");
  author = { slug: "", penName: `Bell Poet ${id}` };
  await signUpAs(page, `notify-board-${id}@example.com`, author.penName);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Lamplight ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("one bulb over the stall,\nmoths keeping the hours");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  author.slug = (await sql(`SELECT slug FROM editors WHERE email = 'notify-board-${id}@example.com'`)).rows[0].slug;
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
  // Its last line leads to the Privacy page (Phase 19).
  await expect(dialog.getByRole("link", { name: "how InkBoard handles your data" })).toHaveAttribute("href", "/privacy");
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

// ---- Phase 18 round 2: following authors ------------------------------------

const followButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: `Notify me about new poems by ${author.penName}` });
async function openAuthor(page: Page) {
  await page.goto(`/a/${author.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: author.penName })).toBeVisible();
}
const deviceRow = async (endpoint: string | null) =>
  (
    await sql(
      `SELECT s.mode, array_remove(array_agg(e.slug), NULL) AS follows FROM push_subscriptions s
       LEFT JOIN push_follows f ON f.subscription_id = s.id LEFT JOIN editors e ON e.id = f.editor_id
       WHERE s.endpoint = '${(endpoint ?? "").replace(/'/g, "''")}' GROUP BY s.mode`,
    )
  ).rows[0] as { mode: string; follows: string[] } | undefined;

test("following an author from their page turns notifications on, only for authors I follow", async ({ browser }) => {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: width < 640 ? 812 : 800 } });
    await fakePush(context, { permission: "default" });
    const page = await context.newPage();
    await openAuthor(page);
    const button = followButton(page);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    expect((await pushRecord(page)).prompts).toBe(0); // never on load
    await shot(page, `author-follow-off-${width}`);

    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    expect(await pushRecord(page)).toMatchObject({ prompts: 1, subscribes: 1 }); // the tap was the permission request
    const endpoint = await endpointHere(page);
    await expect.poll(() => deviceRow(endpoint)).toEqual({ mode: "followed", follows: [author.slug] });
    await shot(page, `author-follow-on-${width}`);

    // Unfollow from the same button.
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => deviceRow(endpoint)).toEqual({ mode: "followed", follows: [] });
    await context.close();
    await sql(`DELETE FROM push_subscriptions WHERE endpoint = '${endpoint}'`);
  }
});

test("the Subscribe popover shows the mode and followed authors; Unfollow and switching modes reach the server", async ({ browser }) => {
  for (const width of [1280, 375]) {
    const context = await browser.newContext({ viewport: { width, height: width < 640 ? 812 : 800 } });
    await fakePush(context, { permission: "default" });
    const page = await context.newPage();
    await openAuthor(page);
    await followButton(page).click();
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "true");
    const endpoint = await endpointHere(page);

    await openBoard(page);
    const dialog = await openPopover(page);
    await expect(theSwitch(dialog)).toBeChecked();
    const modes = dialog.getByRole("radiogroup", { name: "Notify me about" });
    await expect(modes.getByRole("radio", { name: "Only authors I follow" })).toBeChecked();
    const list = dialog.getByRole("list", { name: "Authors you follow" });
    await expect(list.getByRole("listitem")).toHaveText([new RegExp(author.penName)]);
    await shot(page, `popover-follows-${width}`);

    // Switch to all new poems, and back.
    await modes.getByRole("radio", { name: "All new poems" }).click();
    await expect(modes.getByRole("radio", { name: "All new poems" })).toBeChecked();
    await expect.poll(async () => (await deviceRow(endpoint))?.mode).toBe("all");
    await modes.getByRole("radio", { name: "Only authors I follow" }).click();
    await expect.poll(async () => (await deviceRow(endpoint))?.mode).toBe("followed");

    // Unfollow from the list.
    await list.getByRole("button", { name: `Unfollow ${author.penName}` }).click();
    await expect(dialog.getByText("None yet. Follow an author from their page", { exact: false })).toBeVisible();
    await expect(dialog.getByText("Until you follow someone, this device gets no notifications.")).toBeVisible();
    await expect.poll(async () => (await deviceRow(endpoint))?.follows).toEqual([]);
    if (width === 1280) await shot(page, "popover-follows-empty-1280");
    await page.keyboard.press("Escape");

    // The author page agrees.
    await openAuthor(page);
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "false");
    await context.close();
    await sql(`DELETE FROM push_subscriptions WHERE endpoint = '${endpoint}'`);
  }
});

test("following while notifications are on for all new poems keeps 'all', and says so", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(context, { permission: "default" });
  const page = await context.newPage();
  await openBoard(page);
  const dialog = await openPopover(page);
  await theSwitch(dialog).click();
  await expect(dialog.getByRole("radio", { name: "All new poems" })).toBeChecked();
  const endpoint = await endpointHere(page);
  await page.keyboard.press("Escape");
  await openAuthor(page);
  await followButton(page).click();
  await expect(followButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("main").getByText(/This device gets every new poem/)).toBeVisible();
  await expect.poll(() => deviceRow(endpoint)).toEqual({ mode: "all", follows: [author.slug] });
  expect((await pushRecord(page)).prompts).toBe(0); // already on: following asks nothing
  await context.close();
  await sql(`DELETE FROM push_subscriptions WHERE endpoint = '${endpoint}'`);
});

test("the author page on an iPhone outside the Home Screen explains first; blocked browsers can't follow", async ({ browser }) => {
  for (const width of [375, 1280]) {
    const ios = await browser.newContext({ userAgent: IPHONE, viewport: { width, height: width < 640 ? 812 : 800 }, isMobile: width < 640, hasTouch: true });
    await fakePush(ios, { permission: "default", unsupported: true });
    const page = await ios.newPage();
    await openAuthor(page);
    await expect(page.getByRole("main").getByText(/add InkBoard to your Home Screen first/)).toBeVisible();
    await expect(followButton(page)).toHaveCount(0);
    await shot(page, `author-ios-not-installed-${width}`);
    await ios.close();
  }
  const blocked = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(blocked, { permission: "denied" });
  const page = await blocked.newPage();
  await openAuthor(page);
  await expect(followButton(page)).toHaveAttribute("aria-disabled", "true");
  await followButton(page).click({ force: true }); // aria-disabled (keeps focus), so Playwright would wait
  expect(await pushRecord(page)).toMatchObject({ prompts: 0, subscribes: 0 });
  await expect(page.getByRole("main").getByText(/Notifications are blocked for InkBoard/)).toBeVisible();
  await blocked.close();
});

// ---- Phase 24: new chapters go to followers only ---------------------------------

const subscriptionId = async (endpoint: string | null) =>
  (await sql(`SELECT id FROM push_subscriptions WHERE endpoint = '${(endpoint ?? "").replace(/'/g, "''")}'`)).rows[0]?.id as string;
const NOTE_SHOTS = process.env.NOTE_SHOTS ?? "/private/tmp/claude-501/-Users-user--cache-claude-hfi--Users-user-poemhub-oak/5eb20973-a314-4dbe-8393-541691d53b99/scratchpad/shots";

test("a new chapter reaches a device that follows its author, not an 'all new poems' device that doesn't", async ({ browser }) => {
  test.slow();
  const id = unique();
  const writer = { email: `chapter-writer-${id}@example.com`, penName: `Serial Writer ${id}` };
  const writerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const w = await writerContext.newPage();
  await signUpAs(w, writer.email, writer.penName);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${writer.email}'`);
  const [editorId, slug] = [rows[0].id as string, rows[0].slug as string];

  // A novel with its first chapter published before anyone subscribes (announced to nobody).
  await w.goto("/admin/novels");
  await w.getByRole("button", { name: "New novel" }).click();
  const dialog = w.getByRole("dialog", { name: "New novel" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(`The Ferry ${id}`);
  await dialog.getByRole("button", { name: "Create novel" }).click();
  await expect(w).toHaveURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const novelAdmin = new URL(w.url()).pathname;
  const publishChapter = async (title: string) => {
    await w.goto(novelAdmin);
    await w.getByRole("button", { name: "New chapter" }).click();
    await expect(w).toHaveURL(/\/chapters\/[0-9a-f-]{36}/, { timeout: 45_000 });
    await w.getByRole("textbox", { name: /Chapter title/ }).fill(title);
    await w.getByRole("textbox", { name: "Text" }).fill(`SECRET CHAPTER TEXT ${title}`);
    await w.getByRole("button", { name: "Publish chapter" }).click();
    await expect(w.locator("[data-sileo-toast]").getByText("Chapter published", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
    return new URL(w.url()).pathname;
  };
  await publishChapter("Thursday");

  // Device 1 follows the writer from their page (which says chapters go to followers only).
  const followerContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await fakePush(followerContext, { permission: "default" });
  const f = await followerContext.newPage();
  await f.goto(`/a/${slug}`);
  const follow = f.getByRole("main").getByRole("button", { name: `Notify me about new poems by ${writer.penName}` });
  await expect(f.getByRole("main")).toContainText(`New chapters of ${writer.penName}’s novels go only to devices that follow them.`);
  await f.screenshot({ path: `${NOTE_SHOTS}/follow-note-375.png` });
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const follower = await subscriptionId(await endpointHere(f));
  expect(follower).toBeTruthy();

  // Device 2: notifications on for "All new poems", following nobody.
  const allContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePush(allContext, { permission: "default" });
  const a = await allContext.newPage();
  await openBoard(a);
  const popover = await openPopover(a);
  await theSwitch(popover).click();
  await expect(theSwitch(popover)).toBeChecked();
  const everything = await subscriptionId(await endpointHere(a));
  await expect.poll(async () => (await deviceRow(await endpointHere(a)))?.mode).toBe("all");
  await expect(popover.getByText("New chapters of novels come only from authors you follow, in either choice.")).toBeVisible();
  await a.screenshot({ path: `${NOTE_SHOTS}/popover-chapters-note-1280.png` });
  await a.setViewportSize({ width: 375, height: 812 });
  await a.screenshot({ path: `${NOTE_SHOTS}/popover-chapters-note-375.png` });
  await f.setViewportSize({ width: 1280, height: 800 });
  await f.screenshot({ path: `${NOTE_SHOTS}/follow-note-1280.png` });

  // Chapter 2 is published: the follower is told (the same five fields as a poem, no text); the other device isn't.
  const chapterAdmin = await publishChapter("The Landing");
  await expect.poll(() => pushesFor(follower), { timeout: 30_000 }).toEqual([
    {
      title: `New chapter: The Ferry ${id}, Chapter 2`,
      author: writer.penName,
      url: `/a/${slug}/n/the-ferry-${id}/the-landing`,
      tag: `author:${editorId}`,
      count: 1,
    },
  ]);
  expect(JSON.stringify(await pushesFor(follower))).not.toContain("SECRET");

  // A poem by the same writer: both devices hear (the "all" device as today); for the follower it
  // joins the chapter's notification (shared limits and grouping: one per author per 12 hours).
  await w.goto("/admin/poems/new");
  await w.getByRole("textbox", { name: "Title" }).fill(`Harbour ${id}`);
  await w.getByRole("textbox", { name: "Poem" }).fill("boats like tired dogs");
  await w.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(w);
  await expect.poll(async () => (await pushesFor(everything)).map((p) => p.title), { timeout: 30_000 }).toEqual([`Harbour ${id}`]);
  await expect.poll(async () => (await pushesFor(follower)).map((p) => [p.count, p.url]), { timeout: 30_000 }).toEqual([
    [1, `/a/${slug}/n/the-ferry-${id}/the-landing`],
    [2, `/a/${slug}`],
  ]);

  // Unpublishing chapter 2 and publishing it again announces nothing more, to anyone.
  await w.goto(chapterAdmin);
  await w.getByRole("button", { name: "Unpublish" }).click();
  await expect(w.locator("[data-sileo-toast]").getByText("Chapter unpublished", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await w.getByRole("button", { name: "Publish chapter" }).click();
  // Not a first publish, so the editor says "Chapter saved".
  await expect(w.locator("[data-sileo-toast]").getByText("Chapter saved", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await sql(`SELECT status FROM chapters WHERE slug = 'the-landing' AND novel_id IN (SELECT id FROM novels WHERE editor_id = '${editorId}')`)).rows[0].status).toBe("published");
  await w.waitForTimeout(1500);
  expect(await pushesFor(follower)).toHaveLength(2);
  expect((await pushesFor(everything)).map((p) => p.title)).toEqual([`Harbour ${id}`]);

  for (const c of [writerContext, followerContext, allContext]) await c.close();
  await sql(`DELETE FROM push_subscriptions WHERE id IN ('${follower}', '${everything}')`);
});
