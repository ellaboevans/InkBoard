import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

const world = (page: Page) => page.locator("[data-lod]");

/** Open the board and wait until it's hydrated and positioned. */
async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}
const zoomLabel = (page: Page) => page.getByRole("button", { name: /^Zoom \d+%/ });
const zoomPercent = async (page: Page) => Number((await zoomLabel(page).textContent())!.replace("%", ""));

test("published poems appear in their author's section; private text never reaches the page", async ({ page }) => {
  const id = unique();
  const pen = `Board Poet ${id}`;
  const secret = `secret line ${id}`;
  await signUpAs(page, `board-${id}@example.com`, pen);
  await publish(page, `Open ${id}`, `first line ${id}\n    indented line`);
  await publish(page, `Locked ${id}`, `${secret}\nmore`, "board-pass");
  // A draft must not appear.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Draft ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("not yet");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();

  await page.goto("/");
  const section = page.getByRole("region", { name: `${pen}, 2 poems` });
  await expect(section).toBeAttached();
  await expect(section.getByRole("link", { name: `Open ${id}` })).toContainText(`first line ${id}`);
  await expect(section.getByRole("link", { name: `Locked ${id} (password protected)` })).toContainText("Private");
  await expect(page.getByText(`Draft ${id}`)).toHaveCount(0);

  const html = await page.content();
  expect(html).not.toContain(secret);
  expect(html).not.toContain("scrypt$");

  // Reading pages
  await page.goto("/");
  await section.getByRole("link", { name: `Open ${id}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Open ${id}` })).toBeVisible();
  await expect(page.locator("article").getByText("indented line")).toBeVisible();
  expect(await page.locator("article").innerText()).toContain(`first line ${id}\n    indented line`);

  await page.goBack();
  await page.getByRole("region", { name: `${pen}, 2 poems` }).getByRole("link", { name: /Locked/ }).click();
  await expect(page.getByText("This poem is password protected")).toBeVisible();
  expect(await page.content()).not.toContain(secret);
});

test("pan, zoom and fit", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `pan-${id}@example.com`, `Pan Poet ${id}`);
  await publish(page, `Pan ${id}`, "drag me");
  await openBoard(page);

  // Zoom buttons
  const start = await zoomPercent(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(start);
  await page.getByRole("button", { name: /reset to 100%/ }).click();
  await expect.poll(() => zoomPercent(page)).toBe(100);

  // Ctrl + wheel zooms around the pointer
  const vp = page.getByRole("region", { name: "Poem board" });
  const box = (await vp.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomPercent(page)).toBeLessThan(100);

  // Dragging a card pans the board and does NOT open the poem
  const card = page.getByRole("link", { name: `Pan ${id}` });
  await page.getByRole("button", { name: "Fit" }).click();
  await card.scrollIntoViewIfNeeded().catch(() => {});
  const before = await world(page).getAttribute("style");
  const cb = (await card.boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 120, cb.y + cb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => world(page).getAttribute("style")).not.toBe(before);
  await expect(page).toHaveURL(/\/$/);

  // ...but a plain click does open it
  const cb2 = (await card.boundingBox())!;
  await page.mouse.click(cb2.x + cb2.width / 2, cb2.y + cb2.height / 2);
  await expect(page).toHaveURL(/\/p\/pan-poet-/);
});

test("keyboard: zoom keys, and tabbing brings cards into view", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `kb-${id}@example.com`, `Keys Poet ${id}`);
  await publish(page, `Keys ${id}`, "tab to me");
  await openBoard(page);
  const vp = page.getByRole("region", { name: "Poem board" });
  await vp.focus();
  await page.keyboard.press("1");
  await expect.poll(() => zoomPercent(page)).toBe(100);
  await page.keyboard.press("-");
  await expect.poll(() => zoomPercent(page)).toBe(80);

  const card = page.getByRole("link", { name: `Keys ${id}` });
  await card.focus(); // what Tab would do; focus-visible comes from the keyboard
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport({ ratio: 1 });
});

test("list view shows the same catalogue", async ({ page }) => {
  const id = unique();
  const pen = `List Poet ${id}`;
  await signUpAs(page, `list-${id}@example.com`, pen);
  await publish(page, `Listed ${id}`, "in a list");
  await openBoard(page);
  await page.getByRole("button", { name: "List view" }).click();
  const section = page.getByRole("region", { name: new RegExp(pen) });
  await expect(section.getByRole("heading", { name: new RegExp(pen) })).toBeVisible();
  await expect(section.getByRole("link", { name: new RegExp(`Listed ${id}`) })).toBeVisible();
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.getByRole("region", { name: "Poem board" })).toBeVisible();
});

test("unknown poems show not-found and are not indexed", async ({ page }) => {
  // The page streams, so the status is already 200 when notFound() runs;
  // Next marks the page noindex instead.
  await page.goto("/p/nobody/nothing");
  await expect(page.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
});
