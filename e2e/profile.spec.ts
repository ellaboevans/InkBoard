import { expect, test } from "@playwright/test";
import { accountButton, latestCode, requestCode, signUpAs, sql, typeCode, expectBackOnList } from "./helpers";

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
  await expectBackOnList(page);
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
  await expect(accountButton(page, renamed)).toBeVisible();
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

test("rich profile: avatar, tagline, links and a pinned poem", async ({ page }) => {
  const id = unique();
  const pen = `Rich Poet ${id}`;
  await signUpAs(page, `rich-${id}@example.com`, pen);
  for (const title of [`Pin Me ${id}`, `Other ${id}`]) {
    await page.goto("/admin/poems/new");
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Poem" }).fill("a line");
    await page.getByRole("button", { name: "Publish to board" }).click();
    await expectBackOnList(page);
  }

  // Pin from the poems list.
  await page.goto("/admin");
  await page.getByRole("button", { name: `Actions for Pin Me ${id}` }).click();
  await page.getByRole("menuitem", { name: "Pin to profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Pinned to your profile")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Pin Me ${id}`) })).toContainText("Pinned");

  // Profile shows it, plus stats; pick an avatar, tagline and links.
  await page.goto("/admin/profile");
  await expect(page.getByRole("combobox", { name: "Pinned poem" })).toHaveValue(/.+/);
  await expect(page.getByRole("main")).toContainText(`Pinned: “Pin Me ${id}”`);
  await page.getByRole("radio", { name: "Avatar 7" }).check({ force: true });
  await page.getByRole("textbox", { name: /Tagline/ }).fill("Poems about   rivers");
  await page.getByRole("textbox", { name: "Website" }).fill("example.com/rich");
  await page.getByRole("textbox", { name: "Link 2" }).fill("http://insecure.example");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("main").getByText("isn't a valid https link")).toBeVisible();
  // What was typed survives the validation error.
  await expect(page.getByRole("textbox", { name: /Tagline/ })).toHaveValue("Poems about   rivers");

  await page.getByRole("textbox", { name: "Link 2" }).fill("");
  await page.getByRole("combobox", { name: "Pinned poem" }).selectOption({ label: `Other ${id}` });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  // The stored, normalised values come back.
  await expect(page.getByRole("textbox", { name: /Tagline/ })).toHaveValue("Poems about rivers");
  await expect(page.getByRole("textbox", { name: "Website" })).toHaveValue("https://example.com/rich");
  await expect(page.getByRole("main")).toContainText(`Pinned: “Other ${id}”`);
  // The sidebar shows the chosen avatar.
  await expect(accountButton(page, pen).locator("img")).toHaveAttribute("src", "/avatars/a07");

  const { rows } = await sql(`SELECT avatar, tagline, links FROM editors WHERE email = 'rich-${id}@example.com'`);
  expect(rows[0]).toEqual({ avatar: "a07", tagline: "Poems about rivers", links: ["https://example.com/rich"] });
});

test("dashboard filters, search and the phone drawer", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `dash-${id}@example.com`, `Dash Poet ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Draft ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("not yet");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Live ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("out now");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);

  await page.goto("/admin");
  const stats = page.getByRole("main").locator("dl");
  await expect(stats).toContainText("Published1");
  await expect(stats).toContainText("Drafts1");
  await page.getByRole("button", { name: /^Drafts/ }).click();
  await expect(page.getByRole("link", { name: `Draft ${id}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Live ${id}` })).toHaveCount(0);
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByRole("searchbox", { name: "Search your poems by title" }).fill("live");
  await expect(page.getByRole("link", { name: `Live ${id}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Draft ${id}` })).toHaveCount(0);

  // Phones: the sidebar is a drawer, and Sign out is reachable from it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Settings" })).toBeVisible();
  // Following a link closes the drawer, so the new page isn't hidden behind it.
  await page.getByRole("dialog").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Same for the links in the account menu.
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Account menu:/ }).click();
  await page.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/admin\/profile$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Account menu:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in\?signed-out=1$/);
});
