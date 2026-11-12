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
  // Cards are stretched title links: the link is named by the title, and the
  // excerpt is plain text in the card around it.
  const card = (name: string) =>
    section.locator("[data-card]").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(card(`Open ${id}`)).toContainText(`first line ${id}`);
  await expect(card(`Locked ${id} (password protected)`)).toContainText("Private");
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
  // The whole card (the title link is stretched over it) is panned into view.
  await expect(card.locator("xpath=ancestor::div[@data-card]")).toBeInViewport({ ratio: 1 });
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

test("poems open in an overlay over the board; Esc returns to the same spot", async ({ page }) => {
  const id = unique();
  const pen = `Overlay Poet ${id}`;
  await signUpAs(page, `ov-${id}@example.com`, pen);
  await publish(page, `Overlay ${id}`, `overlay line ${id}\n    indented`);
  await publish(page, `Overlay Locked ${id}`, `overlay secret ${id}`, "overlay-pass");
  await openBoard(page);

  const card = page.getByRole("link", { name: `Overlay ${id}`, exact: true });
  await page.getByRole("button", { name: "Fit" }).click();
  const camera = await world(page).getAttribute("style");
  await card.click();

  const dialog = page.getByRole("dialog", { name: `Overlay ${id}` });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/p/overlay-poet-.*/overlay-${id.replace(/[^a-z0-9]+/g, "-")}$`));
  expect(await dialog.locator("article").innerText()).toContain(`overlay line ${id}\n    indented`);
  // The board is still mounted underneath.
  await expect(page.locator('[aria-label="Poem board"]')).toBeAttached();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(await world(page).getAttribute("style")).toBe(camera);

  // Back/forward reopen and close it.
  await page.goForward();
  await expect(page.getByRole("dialog", { name: `Overlay ${id}` })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Refreshing a poem URL shows the full page instead of the overlay.
  await page.goForward();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to the board" })).toBeVisible();
  await expect(page.locator("article")).toContainText(`overlay line ${id}`);

  // Private poems unlock inside the overlay, with a toast; text never leaks before.
  await openBoard(page);
  await page.getByRole("link", { name: `Overlay Locked ${id} (password protected)` }).click();
  const locked = page.getByRole("dialog", { name: `Overlay Locked ${id}` });
  await expect(locked.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await page.content()).not.toContain(`overlay secret ${id}`);
  await locked.getByLabel("Password", { exact: true }).fill("not-it");
  await locked.getByRole("button", { name: "Unlock poem" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Couldn't unlock this poem")).toBeVisible();
  await locked.getByLabel("Password", { exact: true }).fill("overlay-pass");
  await locked.getByRole("button", { name: "Unlock poem" }).click();
  await expect(locked.locator("article")).toContainText(`overlay secret ${id}`);
  await expect(page.locator("[data-sileo-toast]").getByText("Poem unlocked")).toBeVisible();

  // Leaving via a link clears the overlay.
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Editor sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
