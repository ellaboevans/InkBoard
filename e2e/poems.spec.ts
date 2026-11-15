import { expect, test, type Page } from "@playwright/test";
import { renderedToastTitle, signOut, signUpAs, sql } from "./helpers";

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

test("the editor shows a live card preview that opens the full poem", async ({ page }) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await signUpAs(page, `preview-${id}@example.com`, `Preview Poet ${id}`);
  await page.goto("/admin/poems/new");
  const preview = page.getByRole("region", { name: "Card preview" });
  await page.getByRole("textbox", { name: "Title" }).fill(`Tide ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("one\ntwo\n\n    three, indented\nfour\nfive\nsix");
  // Same excerpt rule as the board: five lines kept as typed, then "…".
  await expect(preview.locator("[data-card] p")).toHaveText("one\ntwo\n\n    three, indented\nfour\n…", { useInnerText: true });

  // Clicking the card opens the full poem and doesn't submit the form.
  await preview.getByRole("button", { name: new RegExp(`Tide ${id}`) }).click();
  const dialog = page.getByRole("dialog", { name: `Tide ${id}` });
  await expect(dialog).toContainText(`by Preview Poet ${id}`);
  await expect(dialog).toContainText("six");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/admin\/poems\/new$/);

  // Password protected: the card shows what readers see before unlocking.
  await page.getByRole("switch", { name: "Password protected" }).click();
  await expect(preview.locator("[data-card]")).toContainText("Enter the password to read");
  await expect(preview.locator("[data-card]")).not.toContainText("three, indented");
});

test("history: view an earlier version, restore it, save; readers never see history", async ({ page, browser, request }) => {
  const id = unique();
  const pen = `History Poet ${id}`;
  const email = `history-${id}@example.com`;
  const good = `first draft line ${id}\n  second line`;
  const bad = `a bad paste ${id}`;
  await signUpAs(page, email, pen);
  await writePoem(page, `Kept ${id}`, good);
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible({ timeout: 45_000 });
  const poemId = poemIdFromUrl(page);
  const history = page.getByRole("region", { name: "History" });
  await expect(history).toContainText("Earlier versions appear here");

  // A mistaken paste, saved.
  await page.getByRole("textbox", { name: "Poem" }).fill(bad);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Saved and published" })).toBeVisible();
  await expect(history).toContainText("1 earlier version");
  const versions = history.getByRole("link");
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText("Current");
  await expect(versions.first()).toContainText(bad);
  await expect(versions.nth(1)).toContainText(`first draft line ${id}`);

  // Open the earlier version from the keyboard: read-only, with the differences marked.
  await versions.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?version=[0-9a-f-]{36}$/);
  const dialog = page.getByRole("dialog", { name: /^Earlier version, saved / });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("3 lines differ");
  await expect(dialog.locator("ins")).toHaveText([`Only in this version: first draft line ${id}`, "Only in this version:   second line"]);
  await expect(dialog.locator("del")).toHaveText([`Only in the editor: ${bad}`]);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  // Escape closes it and puts focus back on that version.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/admin/poems/${poemId}$`));
  await expect(versions.nth(1)).toBeFocused();

  // Until the restore is saved, readers still get the current text, and never the history.
  const poemUrl = (await sql(`SELECT e.slug, p.slug AS poem FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.id = '${poemId}'`))
    .rows.map((r) => `/p/${r.slug}/${r.poem}`)[0];

  // Restore: it goes into the editor as unsaved changes.
  await versions.nth(1).click();
  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Poem" })).toHaveValue(good);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Version restored in the editor" })).toBeVisible();
  const before = await (await request.get(poemUrl)).text();
  expect(before).toContain(`a bad paste ${id}`);
  expect(before).not.toContain(`first draft line ${id}`);

  // Saving as usual keeps it, as a new version (so the restore can be undone too).
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Saved and published" })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await expect(versions).toHaveCount(3);
  await expect(versions.first()).toContainText(`first draft line ${id}`);
  await expect(versions.nth(1)).toContainText(bad);
  // The published poem kept its URL.
  expect((await request.get(poemUrl)).status()).toBe(200);

  // Readers: the reading page, the board, the author page, the feeds and search show only the current text.
  const { rows } = await sql(`SELECT slug FROM editors WHERE email = '${email}'`);
  for (const path of [poemUrl, "/", `/a/${rows[0].slug}`, "/feed.xml", `/a/${rows[0].slug}/feed.xml`, `/api/search?q=${encodeURIComponent(`a bad paste ${id}`)}`]) {
    const res = await request.get(path);
    const text = await res.text();
    expect(text, path).not.toContain(`a bad paste ${id}`);
    if (path !== "/" && !path.startsWith("/api/")) expect(text, path).toContain(`first draft line ${id}`);
  }

  // A malformed or someone else's version id just shows the editor.
  await page.goto(`/admin/poems/${poemId}?version=not-a-uuid`);
  await expect(page.getByRole("textbox", { name: "Poem" })).toHaveValue(good);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const versionId = (await sql(`SELECT id FROM poem_revisions WHERE poem_id = '${poemId}' ORDER BY saved_at LIMIT 1`)).rows[0].id;
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUpAs(otherPage, `history-other-${id}@example.com`, `Other Poet ${id}`);
  await otherPage.goto(`/admin/poems/${poemId}?version=${versionId}`);
  await expect(otherPage.getByRole("heading", { name: /not found/i })).toBeVisible();
  expect(await otherPage.content()).not.toContain(`first draft line ${id}`);
  await other.close();
});

test("toast titles appear exactly as written, not title-cased", async ({ page }) => {
  // Titles are sentence case on purpose (Sileo would show "Saved And Published").
  // renderedToastTitle reads innerText, which applies CSS text-transform.
  await signUpAs(page, `case-${unique()}@example.com`, "Wren Case");
  await writePoem(page, `Solstice ${unique()}`, "shortest day —\nthe cat follows");
  await page.getByRole("button", { name: "Save draft" }).click();
  expect(await renderedToastTitle(page, "Poem created")).toBe("Poem created");

  await page.getByRole("button", { name: "Publish to board" }).click();
  expect(await renderedToastTitle(page, "Saved and published")).toBe("Saved and published");

  // An error toast, from the editor's own validation.
  await page.getByRole("textbox", { name: "Title" }).fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(await renderedToastTitle(page, "Couldn't save the poem")).toBe("Couldn't save the poem");
});
