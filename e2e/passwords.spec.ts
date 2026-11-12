import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const passwordInput = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true }).filter({ visible: true });

async function writePrivate(page: Page, title: string, body: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  await page.getByRole("switch", { name: "Password protected" }).click();
  if (password) await passwordInput(page, "Password").fill(password);
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
}

async function setShared(page: Page, password: string) {
  await page.goto("/admin/settings");
  await page.getByRole("radio", { name: /One password for all my private poems/ }).click();
  const label = (await page.getByText("New shared password").count()) ? "New shared password" : "Shared password";
  await passwordInput(page, label).fill(password);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Shared password saved/)).toBeVisible();
}

async function readerUnlock(page: Page, path: string, password: string) {
  await page.goto(path);
  await passwordInput(page, "Password").fill(password);
  await page.getByRole("button", { name: "Unlock poem" }).click();
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

test("per-poem passwords: each poem opens with its own password only", async ({ page, browser }) => {
  const id = unique();
  const pen = `Per Poem ${id}`;
  await signUpAs(page, `pp-${id}@example.com`, pen);
  await writePrivate(page, `First ${id}`, `first secret ${id}`, "first-pass");
  await writePrivate(page, `Second ${id}`, `second secret ${id}`, "second-pass");
  const base = `/p/${slugify(pen)}`;

  const reader = await (await browser.newContext()).newPage();
  await readerUnlock(reader, `${base}/${slugify(`First ${id}`)}`, "second-pass");
  await expect(reader.locator("#poem-password-error")).toContainText("That password isn't right");
  expect(await reader.content()).not.toContain(`first secret ${id}`);

  await passwordInput(reader, "Password").fill("first-pass");
  await reader.getByRole("button", { name: "Unlock poem" }).click();
  await expect(reader.locator("article")).toContainText(`first secret ${id}`);
  await expect(reader.getByText("Unlocked on this device")).toBeVisible();

  // The other poem is still locked.
  await reader.goto(`${base}/${slugify(`Second ${id}`)}`);
  await expect(reader.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await reader.content()).not.toContain(`second secret ${id}`);
  await reader.context().close();
});

test("one shared password: set in Settings, unlocks all, revoked on change, reversible", async ({ page, browser }) => {
  const id = unique();
  const pen = `Shared ${id}`;
  await signUpAs(page, `sh-${id}@example.com`, pen);
  await writePrivate(page, `Old ${id}`, `old secret ${id}`, "old-own-pass");

  // Switch to one shared password.
  await setShared(page, "one-for-all");
  const mode = await sql(`SELECT password_mode FROM editors WHERE email = 'sh-${id}@example.com'`);
  expect(mode.rows[0].password_mode).toBe("shared");

  // The poem editor no longer asks for a password.
  await page.goto("/admin/poems/new");
  await page.getByRole("switch", { name: "Password protected" }).click();
  await expect(page.getByText("Uses your shared password for all private poems.")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await writePrivate(page, `New ${id}`, `new secret ${id}`);

  // A reader unlocks one poem and can read both.
  const base = `/p/${slugify(pen)}`;
  const ctx = await browser.newContext();
  const reader = await ctx.newPage();
  await reader.goto(`${base}/${slugify(`Old ${id}`)}`);
  await expect(reader.getByText(/uses one password for all their private poems/)).toBeVisible();
  await readerUnlock(reader, `${base}/${slugify(`Old ${id}`)}`, "old-own-pass");
  await expect(reader.locator("#poem-password-error")).toContainText("isn't right"); // old per-poem password no longer works
  await passwordInput(reader, "Password").fill("one-for-all");
  await reader.getByRole("button", { name: "Unlock poem" }).click();
  await expect(reader.locator("article")).toContainText(`old secret ${id}`);
  await reader.goto(`${base}/${slugify(`New ${id}`)}`);
  await expect(reader.locator("article")).toContainText(`new secret ${id}`);

  // Changing the shared password locks the reader out again.
  await setShared(page, "brand-new-pass");
  await reader.reload();
  await expect(reader.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await reader.content()).not.toContain(`new secret ${id}`);

  // Back to per-poem: each poem starts with the shared password as its own.
  await page.goto("/admin/settings");
  await page.getByRole("radio", { name: /A different password for each poem/ }).click();
  await expect(page.getByText(/will start with your current shared password/)).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Each private poem now has its own password.")).toBeVisible();

  await readerUnlock(reader, `${base}/${slugify(`New ${id}`)}`, "brand-new-pass");
  await expect(reader.locator("article")).toContainText(`new secret ${id}`);
  // ...but now per poem: the other one is still locked.
  await reader.goto(`${base}/${slugify(`Old ${id}`)}`);
  await expect(reader.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await ctx.close();

  // And the poem editor asks for per-poem passwords again.
  await page.goto("/admin");
  await page.getByRole("link", { name: `New ${id}` }).click();
  await expect(passwordInput(page, "New password")).toBeVisible();
});

test("wrong guesses are rate limited", async ({ page, browser }) => {
  const id = unique();
  const pen = `Limited ${id}`;
  await signUpAs(page, `rl-${id}@example.com`, pen);
  await writePrivate(page, `Guarded ${id}`, "guarded", "right-pass");
  const reader = await (await browser.newContext()).newPage();
  const path = `/p/${slugify(pen)}/${slugify(`Guarded ${id}`)}`;
  await reader.goto(path);
  for (let i = 0; i < 10; i++) {
    await passwordInput(reader, "Password").fill(`wrong-${i}`);
    await reader.getByRole("button", { name: "Unlock poem" }).click();
    await expect(reader.locator("#poem-password-error")).toContainText(/isn't right|Too many/);
  }
  await passwordInput(reader, "Password").fill("right-pass");
  await reader.getByRole("button", { name: "Unlock poem" }).click();
  await expect(reader.locator("#poem-password-error")).toContainText("Too many attempts");
  await reader.context().close();
});
