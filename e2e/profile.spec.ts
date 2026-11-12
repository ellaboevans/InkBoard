import { expect, test } from "@playwright/test";
import { latestCode, requestCode, signUpAs, sql, typeCode } from "./helpers";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test("renaming updates the board and header but keeps poem links working", async ({ page }) => {
  const id = unique();
  const pen = `Old Name ${id}`;
  const renamed = `New Name ${id}`;
  await signUpAs(page, `profile-${id}@example.com`, pen);

  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Kept ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("a line that stays");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  const { rows } = await sql(
    `SELECT e.slug, p.slug AS poem FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'Kept ${id}'`,
  );
  const poemUrl = `/p/${rows[0].slug}/${rows[0].poem}`;

  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  const penName = page.getByRole("textbox", { name: "Pen name" });
  await expect(penName).toHaveValue(pen);
  await penName.fill(renamed);
  await page.getByRole("textbox", { name: /Bio/ }).fill("Writes about rivers.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  // The shared admin header picks up the new name without a reload.
  await expect(page.locator("header")).toContainText(renamed);
  await expect(page.getByRole("button", { name: "Save profile" })).toBeDisabled();

  // Validation errors keep what was typed.
  await penName.fill("1234"); // passes the browser's minLength; the server needs a letter
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("at least one letter");
  await expect(penName).toHaveValue("1234");

  // Board shows the new label straight away (cache invalidated), old one is gone.
  await page.goto("/");
  await expect(page.getByRole("region", { name: `${renamed}, 1 poem` })).toBeAttached();
  await expect(page.getByRole("region", { name: new RegExp(pen) })).toHaveCount(0);

  // The old link still works and shows the new name.
  await page.goto(poemUrl);
  await expect(page.getByRole("heading", { level: 1, name: `Kept ${id}` })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(renamed);
});

test("an editor can see their devices and sign out the others", async ({ page, browser }) => {
  const id = unique();
  const email = `devices-${id}@example.com`;
  await signUpAs(page, email, `Device Poet ${id}`);

  // A second device signs in to the same account.
  const other = await browser.newContext();
  const phone = await other.newPage();
  await sql("DELETE FROM rate_limits"); // skip the resend cooldown
  const firstCode = await latestCode(email);
  await requestCode(phone, email);
  await expect.poll(() => latestCode(email)).not.toBe(firstCode);
  await typeCode(phone, await latestCode(email));
  await expect(phone).toHaveURL(/\/admin$/, { timeout: 45_000 });

  await page.goto("/admin/profile");
  const devices = page.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem");
  await expect(devices).toHaveCount(2);
  await expect(devices.first()).toContainText("This device");
  // The current device can't be signed out from the list (that's the Sign out button).
  await expect(devices.first().getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out all other devices" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Signed out 1 other device")).toBeVisible();
  await expect(devices).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Sign out all other devices" })).toHaveCount(0);

  // The other device is signed out on its next request; this one isn't.
  await phone.goto("/admin");
  await expect(phone).toHaveURL(/\/sign-in$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await other.close();
});
