import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { latestCode, requestCode, signUpAs, sql } from "./helpers";

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
  await page.getByRole("button", { name: "List view" }).click();
  await scan(page, "list view: filtered by language");
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
  await page.getByRole("main").getByRole("link", { name: pen }).click();
  await expect(page.getByRole("heading", { level: 1, name: pen })).toBeVisible();
  await scan(page, "author page");

  await page.goto("/p/nobody/nothing");
  await expect(page.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  await scan(page, "poem not found");
});
