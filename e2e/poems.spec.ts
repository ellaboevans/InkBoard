import { expect, test, type Page } from "@playwright/test";
import { signOut, signUpAs, sql } from "./helpers";

// All local requests share one client IP (::1), so per-IP sign-in limits
// would trip across tests. Rate limiting itself is covered by unit tests.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function writePoem(page: Page, title: string, body: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
}

const poemIdFromUrl = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

test("create a public draft, then publish it", async ({ page }) => {
  await signUpAs(page, `pub-${unique()}@example.com`, "Wren Public");
  await expect(page.getByText("No poems yet")).toBeVisible();

  const body = "The fog comes\n    on little cat feet.";
  await writePoem(page, "Fog", body);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page).toHaveURL(/\/admin\/poems\/[0-9a-f-]{36}$/); // ?created=1 cleaned up
  await expect(page.getByText("Poem created")).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  const id = poemIdFromUrl(page);

  // Indentation is preserved exactly.
  const { rows } = await sql(`SELECT body, status FROM poems WHERE id = '${id}'`);
  expect(rows[0]).toEqual({ body, status: "draft" });

  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

  await page.getByRole("link", { name: "All poems" }).click();
  const row = page.getByRole("row", { name: /Fog/ });
  await expect(row).toContainText("Published");
  await expect(row).toContainText("Public");
});

test("private poems require a password and never expose its hash", async ({ page }) => {
  await signUpAs(page, `priv-${unique()}@example.com`, "Wren Private");
  const title = `Locked Garden ${unique()}`;
  await writePoem(page, title, "A garden inclosed\nis my sister");
  await page.getByRole("switch", { name: "Password protected" }).click();

  // Client-side check blocks the request entirely.
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByRole("main").getByText("Private poems need a password readers can use")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true }).filter({ visible: true })).toBeFocused();
  expect((await sql(`SELECT count(*)::int AS n FROM poems WHERE title = '${title}'`)).rows[0].n).toBe(0);

  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("open-sesame");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  const id = poemIdFromUrl(page);

  const { rows } = await sql(`SELECT visibility, password_hash, password_version FROM poems WHERE id = '${id}'`);
  expect(rows[0].visibility).toBe("private");
  expect(rows[0].password_hash).toMatch(/^scrypt\$/);

  // Reload: the form knows a password exists, but the page carries no hash.
  await page.reload();
  await expect(page.getByLabel("New password").filter({ visible: true })).toHaveAttribute("placeholder", "Leave blank to keep current");
  expect(await page.content()).not.toContain(rows[0].password_hash);
  expect(await page.content()).not.toContain("scrypt$");

  // Saving with the field blank keeps the password.
  await page.getByRole("textbox", { name: "Poem" }).fill("A garden inclosed\nis my sister, my spouse");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  const after = (await sql(`SELECT password_hash, password_version FROM poems WHERE id = '${id}'`)).rows[0];
  expect(after).toEqual({ password_hash: rows[0].password_hash, password_version: rows[0].password_version });

  // Changing it bumps the version.
  await page.getByLabel("New password").filter({ visible: true }).fill("new-sesame");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(async () => (await sql(`SELECT password_version FROM poems WHERE id = '${id}'`)).rows[0].password_version)
    .toBe(rows[0].password_version + 1);

  await page.getByRole("link", { name: "All poems" }).click();
  await expect(page.getByRole("row", { name: new RegExp(title) })).toContainText("Private");
});

test("pressing Enter saves without publishing a draft", async ({ page }) => {
  await signUpAs(page, `enter-${unique()}@example.com`, "Wren Enter");

  // New poem: Enter in the title creates a *draft*.
  await writePoem(page, "Enter Key", "Not ready for readers yet");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect(page.getByText("Poem created")).toBeVisible();
  const id = poemIdFromUrl(page);
  const status = async () =>
    (await sql(`SELECT status FROM poems WHERE id = '${id}'`)).rows[0].status;
  expect(await status()).toBe("draft");

  // Existing draft: rename + Enter keeps it a draft.
  await page.getByRole("textbox", { name: "Title" }).fill("Enter Key, revised");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect(page.getByText("Draft saved")).toBeVisible();
  await expect.poll(async () =>
    (await sql(`SELECT title FROM poems WHERE id = '${id}'`)).rows[0].title,
  ).toBe("Enter Key, revised");
  expect(await status()).toBe("draft");

  // Published poem: Enter keeps it published.
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Enter Key, final");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect.poll(async () =>
    (await sql(`SELECT title FROM poems WHERE id = '${id}'`)).rows[0].title,
  ).toBe("Enter Key, final");
  expect(await status()).toBe("published");
});

test("the new-poem form starts empty after creating a poem", async ({ page }) => {
  await signUpAs(page, `fresh-${unique()}@example.com`, "Wren Fresh");
  await writePoem(page, "First of Many", "One");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();

  // Client-side navigation back to /new (the route is kept alive in <Activity>).
  await page.getByRole("link", { name: "All poems" }).click();
  await page.getByRole("link", { name: "New poem" }).click();
  await expect(page).toHaveURL(/\/admin\/poems\/new$/);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Poem" })).toHaveValue("");
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
});

test("signing out removes the editor's poems from the page", async ({ page }) => {
  await signUpAs(page, `shared-${unique()}@example.com`, "Wren Shared");
  const secret = `secret stanza ${unique()}`;
  await writePoem(page, "Diary", secret);
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("diary-key");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();

  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  // Not even in hidden (Activity-preserved) routes: think shared computers.
  expect(await page.content()).not.toContain(secret);

  // Back button can't bring it back either.
  await page.goBack();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.content()).not.toContain(secret);
});

test("validation errors keep what the editor typed", async ({ page }) => {
  await signUpAs(page, `val-${unique()}@example.com`, "Wren Valid");
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Poem" }).fill("Words I must not lose");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("main").getByText("Give your poem a title")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Poem" })).toHaveValue("Words I must not lose");
});

test("editors cannot open each other's poems", async ({ page, browser }) => {
  await signUpAs(page, `owner-${unique()}@example.com`, "Wren Owner");
  await writePoem(page, "Mine Alone", "Only mine");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  const id = poemIdFromUrl(page);

  const other = await browser.newContext();
  const intruder = await other.newPage();
  await signUpAs(intruder, `intruder-${unique()}@example.com`, "Wren Intruder");
  await intruder.goto(`/admin/poems/${id}`);
  await expect(intruder.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  await expect(intruder.getByText("Only mine")).toHaveCount(0);
  await intruder.goto("/admin");
  await expect(intruder.getByText("Mine Alone")).toHaveCount(0);
  await other.close();
});

test("delete asks for confirmation", async ({ page }) => {
  await signUpAs(page, `del-${unique()}@example.com`, "Wren Delete");
  await writePoem(page, "Ephemeral", "Here, then gone");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  const id = poemIdFromUrl(page);

  await page.getByRole("button", { name: "Delete poem" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete “Ephemeral”?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await sql(`SELECT count(*)::int AS n FROM poems WHERE id = '${id}'`)).rows[0].n).toBe(1);

  await page.getByRole("button", { name: "Delete poem" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete poem" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Poem deleted")).toBeVisible();
  await expect(page.getByText("No poems yet")).toBeVisible();
  expect((await sql(`SELECT count(*)::int AS n FROM poems WHERE id = '${id}'`)).rows[0].n).toBe(0);
});
