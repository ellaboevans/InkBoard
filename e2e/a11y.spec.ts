import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { latestCode, renderedToastTitle, requestCode, signUpAs, sql, toastContrast } from "./helpers";

/*
 * Automated accessibility checks (N7) with axe-core, against WCAG 2.2 A/AA.
 * Each test walks a flow and scans every screen it reaches (the app is
 * light-only). Scans use
 * expect.soft so one run reports every screen, not just the first failure.
 * Automated checks find roughly a third of issues; they complement, not
 * replace, manual keyboard and screen-reader passes.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function scan(page: Page, screen: string, include?: string) {
  // Measure final colours, not a menu or drawer mid-animation (ignores looping spinners).
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary })),
  }));
  expect.soft(summary, screen).toEqual([]);
}

async function publish(page: Page, title: string, body: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
}

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

test("sign-in and onboarding", async ({ page }) => {
  const email = `a11y-in-${unique()}@example.com`;
  await page.goto("/sign-in");
  await scan(page, "sign-in: email step");
  await requestCode(page, email);
  await scan(page, "sign-in: code step");
  await page.locator('input[name="code"]').fill("000000");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await scan(page, "sign-in: wrong code");
  await page.locator('input[name="code"]').fill(await latestCode(email));
  await expect(page).toHaveURL(/\/admin\/onboarding$/, { timeout: 45_000 });
  await scan(page, "onboarding");
});

test("sign-in link page", async ({ page }) => {
  await page.goto("/sign-in/link#" + "Q".repeat(44));
  await scan(page, "sign-in link: continue");
  await page.getByRole("button", { name: "Continue to InkBoard" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await scan(page, "sign-in link: expired");
});

test("admin screens", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-admin-${id}@example.com`, `Access Poet ${id}`);
  await scan(page, "dashboard: empty");

  await page.goto("/admin/poems/new");
  await scan(page, "new poem");
  // Special letters bar open: a language tab with tone marks, then IPA.
  await page.getByRole("button", { name: "Special letters" }).click();
  await page.getByRole("tab", { name: "Ewe" }).click();
  await scan(page, "new poem: special letters (Ewe)");
  await page.getByRole("tab", { name: "IPA" }).click();
  await scan(page, "new poem: special letters (IPA)");
  await page.getByRole("textbox", { name: "Poem" }).fill("a line\n\n  indented");
  await page.getByRole("region", { name: "Card preview" }).getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan(page, "new poem: card preview dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Poem" }).fill("");
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByRole("button", { name: "Publish to board" }).click();
  await scan(page, "new poem: validation errors");

  await publish(page, `Seen ${id}`, "a line\n  indented");
  await publish(page, `Hidden ${id}`, "kept", "a11y-pass");
  await scan(page, "edit poem");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "delete confirmation");
  await page.keyboard.press("Escape");

  // History: a saved change makes an earlier version; open it to compare.
  await page.getByRole("textbox", { name: "Poem" }).fill("kept\n  and changed");
  await page.getByRole("button", { name: "Save changes" }).click();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("link")).toHaveCount(2);
  await scan(page, "edit poem: history panel");
  await history.getByRole("link").nth(1).click();
  const version = page.getByRole("dialog", { name: /^Earlier version/ });
  await expect(version.locator("ins, del").first()).toBeVisible();
  await scan(page, "edit poem: earlier version with changes marked");
  await page.keyboard.press("Escape");
  await expect(version).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByRole("link", { name: `Seen ${id}` })).toBeVisible();
  await scan(page, "dashboard: with poems");
  await page.getByRole("button", { name: `Actions for Seen ${id}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await scan(page, "dashboard: row menu");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await scan(page, "dashboard: phone");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan(page, "dashboard: phone drawer");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("/admin/settings");
  await scan(page, "settings: per poem");
  await page.getByRole("radio", { name: /One password for all/ }).click();
  await scan(page, "settings: shared selected");

  await page.goto("/admin/profile");
  await expect(page.getByRole("heading", { name: "Signed-in devices" })).toBeVisible();
  await scan(page, "profile");
  await page.getByRole("button", { name: "Special letters" }).click();
  await scan(page, "profile: special letters");
});

test("collections: admin pages and the reading page's navigation", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-coll-${id}@example.com`, `Sequence Poet ${id}`);
  await publish(page, `First ${id}`, "one");
  await publish(page, `Second ${id}`, "two", "a11y-pass");
  await publish(page, `Third ${id}`, "three");

  await page.goto("/admin/collections");
  await scan(page, "collections: empty");
  await page.getByRole("button", { name: "New collection" }).click();
  const create = page.getByRole("dialog", { name: "New collection" });
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(create.getByRole("alert")).toBeVisible();
  await scan(page, "collections: new-collection dialog with an error");
  await create.getByRole("textbox", { name: "Title" }).fill(`Sequence ${id}`);
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await scan(page, "collection: empty");
  for (const t of [`First ${id}`, `Second ${id}`, `Third ${id}`]) {
    await page.getByRole("combobox", { name: "Add a poem" }).selectOption({ label: t });
    await page.getByRole("button", { name: "Add to collection" }).click();
    await expect(page.getByRole("button", { name: `Remove “${t}” from the collection` })).toBeVisible();
  }
  await page.getByRole("button", { name: `Move “Third ${id}” up` }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "Moved" })).toBeVisible();
  await scan(page, "collection: with poems, after a move");
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("dialog", { name: "Edit collection" })).toBeVisible();
  await scan(page, "collection: edit dialog");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 800 });
  await scan(page, "collection: phone, with drag handles");
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("dialog", { name: "Edit collection" })).toBeVisible();
  await scan(page, "collection: edit dialog on a phone");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "collection: delete confirmation");
  await page.keyboard.press("Escape");
  await page.goto("/admin/collections");
  await scan(page, "collections: with one");
  await page.goto("/admin/poems/new");
  await expect(page.getByRole("combobox", { name: "Collection" })).toBeVisible();
  await scan(page, "new poem: collection picker");

  // Readers: part n of m, previous/next (a private neighbour is title-only).
  const { rows } = await sql(`SELECT e.slug AS author, p.slug FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'Third ${id}'`);
  await page.goto(`/p/${rows[0].author}/${rows[0].slug}`);
  await expect(page.getByRole("main").getByRole("navigation", { name: new RegExp(`^Sequence ${id}, part`) })).toBeVisible();
  await scan(page, "poem page: collection navigation");
  // Public collection pages (round 2): the author page's list and the collection page.
  await page.goto(`/a/${rows[0].author}`);
  await expect(page.getByRole("region", { name: "Collections" })).toBeVisible();
  await scan(page, "author page: with collections");
  await page.getByRole("region", { name: "Collections" }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: `Sequence ${id}` })).toBeVisible();
  await scan(page, "collection page");
  await page.setViewportSize({ width: 320, height: 720 });
  await scan(page, "collection page: phone");
  await page.setViewportSize({ width: 1280, height: 720 });
  await openBoard(page);
  await page.getByRole("link", { name: `First ${id}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `First ${id}` });
  await expect(dialog.getByRole("navigation", { name: new RegExp(`^Sequence ${id}, part`) })).toBeVisible();
  await scan(page, "overlay: collection navigation");
  // After a step: the same dialog, now showing the next poem.
  await dialog.getByRole("navigation", { name: new RegExp(`^Sequence ${id}, part`) }).getByRole("link", { name: /^Next:/ }).click();
  await expect(page.getByRole("dialog", { name: /^(Second|Third)/ })).toBeVisible();
  await scan(page, "overlay: after stepping to the next poem");
  await page.keyboard.press("Escape");
});

test("board filtered by language", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-lang-${id}@example.com`, `Language Reader ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Ŋutifafa ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("Ŋutifafa na wò");
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "Ewe" });
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();

  await page.goto("/?lang=ee");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(page.getByRole("button", { name: "Show all languages" })).toBeVisible();
  await scan(page, "board: filtered by language");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Follow new poems" })).toBeVisible();
  await scan(page, "board: subscribe popover");
  await page.keyboard.press("Escape");
  // Phone toolbar: icon-only buttons must still be named.
  await page.setViewportSize({ width: 320, height: 640 });
  await scan(page, "board: phone toolbar, filtered");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Follow new poems" })).toBeVisible();
  await scan(page, "board: subscribe popover on a phone");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "List view" }).click();
  await scan(page, "list view: filtered by language");
  await page.setViewportSize({ width: 1280, height: 720 });
  await scan(page, "list view: filtered by language, desktop");
});

test("board, list view, search and reading", async ({ page }) => {
  const id = unique();
  const pen = `Reader Poet ${id}`;
  await signUpAs(page, `a11y-board-${id}@example.com`, pen);
  await publish(page, `Open ${id}`, "first line\n    indented line");
  await publish(page, `Locked ${id}`, "secret", "a11y-pass");

  await openBoard(page);
  await scan(page, "board");
  await page.getByRole("button", { name: "List view" }).click();
  await scan(page, "list view");
  await page.getByRole("button", { name: "Board view" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search the board" });
  await expect(palette).toBeVisible();
  await scan(page, "search: empty");
  await palette.getByRole("combobox").fill(`reader poet ${id}`);
  await expect(palette.getByRole("option").first()).toBeVisible();
  await scan(page, "search: results");
  await palette.getByRole("combobox").fill("qxjzvwpkfy");
  await expect(palette.getByText(/No authors or poems match/)).toBeVisible();
  await scan(page, "search: no results");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: `Open ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Open ${id}` })).toBeVisible();
  await scan(page, "overlay: public poem");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: `Locked ${id} (password protected)` }).click();
  const locked = page.getByRole("dialog", { name: `Locked ${id}` });
  await expect(locked.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await scan(page, "overlay: locked poem");
  await locked.getByLabel("Password", { exact: true }).fill("wrong-one");
  await locked.getByRole("button", { name: "Unlock poem" }).click();
  await expect(locked.getByRole("alert")).toBeVisible();
  await scan(page, "overlay: wrong password");

  // Full pages (hard loads).
  await page.reload();
  await expect(page.getByRole("link", { name: "Back to the board" })).toBeVisible();
  await scan(page, "poem page: locked");
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("a11y-pass");
  await page.getByRole("button", { name: "Unlock poem" }).click();
  await expect(page.locator("article")).toContainText("secret");
  await scan(page, "poem page: unlocked");
  await page.getByRole("main").getByRole("link", { name: pen, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: pen })).toBeVisible();
  await scan(page, "author page");

  await page.goto("/p/nobody/nothing");
  await expect(page.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  await scan(page, "poem not found");
});

test("install nudge: every card state", async ({ browser }) => {
  // Chromium's beforeinstallprompt, simulated; this load counts as a second visit.
  const prompt = () =>
    addEventListener("load", () => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
      e.prompt = async () => {};
      e.userChoice = Promise.resolve({ outcome: "dismissed" });
      dispatchEvent(e);
    });
  const returning = () => {
    if (localStorage.getItem("inkboard-install")) return;
    const hourAgo = Date.now() - 3_600_000;
    localStorage.setItem("inkboard-install", JSON.stringify({ visits: 1, visitStart: hourAgo, lastSeen: hourAgo, poems: [] }));
  };
  const id = unique();

  // A writer: their first publish shows the writer card (phone, Chromium).
  const writer = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  });
  await writer.addInitScript(prompt);
  let page = await writer.newPage();
  await signUpAs(page, `a11y-install-${id}@example.com`, `Install Poet ${id}`);
  await publish(page, `Night Letters ${id}`, "dear lamp,\nstay up with me");
  await expect(page.getByRole("region", { name: "Write from your home screen" })).toBeVisible();
  await scan(page, "install: writer card (phone)");
  await writer.close();

  const states: { name: string; region: string; options: Parameters<typeof browser.newContext>[0]; chromium: boolean }[] = [
    { name: "install: Chromium card, desktop", region: "Install InkBoard", options: { viewport: { width: 1280, height: 800 } }, chromium: true },
    {
      name: "install: Chromium card, phone",
      region: "Put InkBoard on your home screen",
      options: {
        viewport: { width: 375, height: 740 },
        isMobile: true,
        hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
      },
      chromium: true,
    },
    {
      name: "install: iPhone instructions",
      region: "Put InkBoard on your home screen",
      options: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      },
      chromium: false,
    },
    {
      name: "install: Mac Safari instructions",
      region: "Add InkBoard to your Dock",
      options: {
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
      },
      chromium: false,
    },
  ];
  for (const state of states) {
    const context = await browser.newContext(state.options);
    if (state.chromium) await context.addInitScript(prompt);
    await context.addInitScript(returning);
    page = await context.newPage();
    await openBoard(page);
    await expect(page.getByRole("region", { name: state.region })).toBeVisible();
    await scan(page, state.name);
    await context.close();
  }
});

test("toasts: success, error and info", async ({ page }) => {
  // Axe runs on each (colour-contrast included, via the WCAG tags), but it can't
  // judge toast text: the toast's fill is an SVG shape, so axe files the title
  // and description as "incomplete". toastContrast computes those ratios itself.
  const id = unique();
  await signUpAs(page, `a11y-toast-${id}@example.com`, `Toast Poet ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Solstice ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("shortest day —\nthe cat follows");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  // A second save, so the History panel has a version to restore (for the info toast).
  await page.getByRole("textbox", { name: "Poem" }).fill("shortest day —\nthe cat follows\nthe last square of sun");
  await page.getByRole("button", { name: "Save changes" }).click();

  const check = async (title: string, screen: string) => {
    const ratios = await toastContrast(page, title);
    expect.soft(ratios.title, `${screen}: title contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(ratios.description ?? 0, `${screen}: description contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(await renderedToastTitle(page, title), `${screen}: title as written`).toBe(title);
    await scan(page, screen);
  };
  await check("Saved and published", "toast: success");

  await page.getByRole("textbox", { name: "Title" }).fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await check("Couldn't save the poem", "toast: error");
  await page.getByRole("textbox", { name: "Title" }).fill(`Solstice ${id}`);

  const versions = page.getByRole("region", { name: "History" }).getByRole("link");
  await expect(versions).toHaveCount(2);
  await versions.nth(1).click();
  await page.getByRole("dialog", { name: /^Earlier version, saved / }).getByRole("button", { name: "Restore this version" }).click();
  await check("Version restored in the editor", "toast: info");
});

test("offline: the indicator and the offline page", async ({ context, page }) => {
  const id = unique();
  await signUpAs(page, `a11y-offline-${id}@example.com`, `Offline Reader ${id}`);
  await publish(page, `Night Letters ${id}`, "dear lamp,\nstay up with me");

  // The calm indicator, on the board and on a poem page (the browser's offline event drives it).
  await openBoard(page);
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" }).first()).toBeVisible();
  await scan(page, "offline: board indicator");
  await context.setOffline(false);
  await page.getByRole("link", { name: `Night Letters ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Night Letters ${id}` })).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: /Open full page/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Night Letters ${id}` })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" }).first()).toBeVisible();
  await scan(page, "offline: poem page indicator");
  await context.setOffline(false);

  // The offline page with nothing saved (no worker under next dev)…
  await page.goto("/offline?from=%2Fp%2Fsomeone%2Fsomething");
  await expect(page.getByText("No poems saved yet.")).toBeVisible();
  await scan(page, "offline page: nothing saved");
  // …and with saved poems, written the way the worker writes its index.
  await page.evaluate(async () => {
    const cache = await caches.open("inkboard-pages-a11y");
    const index = [
      { url: "/p/odalys-moon/solstice", kind: "poem", title: "Solstice", author: "Odalys Moon", savedAt: 2 },
      { url: "/p/ines-calloway/salt", kind: "poem", title: "Salt", author: "Ines Calloway", savedAt: 1 },
      { url: "/", kind: "board", title: "The board", author: null, savedAt: 3 },
    ];
    await cache.put("/__inkboard/saved.json", new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
  });
  await page.reload();
  await expect(page.locator("[data-saved-poems]").getByRole("link")).toHaveCount(2);
  await scan(page, "offline page: saved poems");
  await page.setViewportSize({ width: 375, height: 740 });
  await scan(page, "offline page: saved poems, phone");
  await page.evaluate(() => caches.delete("inkboard-pages-a11y"));
});
