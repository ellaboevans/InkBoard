import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

// Collections (docs/PLAN.md, Phase 14): an editor groups poems into an ordered
// sequence; readers step through the published ones with previous/next.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, opts: { password?: string; draft?: boolean } = {}) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (opts.password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(opts.password);
  }
  await page.getByRole("button", { name: opts.draft ? "Save draft" : "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible({ timeout: 45_000 });
}

test("an editor builds an ordered collection; a reader steps through it", async ({ page }) => {
  const id = unique();
  const pen = `Cycle Poet ${id}`;
  const email = `cycle-${id}@example.com`;
  const cycle = `Harmattan ${id}`;
  const [one, two, three, draft] = [`One ${id}`, `Two ${id}`, `Three ${id}`, `Draft ${id}`];
  await signUpAs(page, email, pen);
  await publish(page, one, "first poem text");
  await publish(page, two, `secret two text ${id}`, { password: "two-pass" });
  await publish(page, three, "third poem text");
  await publish(page, draft, `draft text ${id}`, { draft: true });

  // Create the collection from the sidebar.
  await page.goto("/admin");
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();
  // A validation error keeps what was typed.
  const create = page.getByRole("region", { name: "New collection" });
  await create.getByRole("textbox", { name: /Intro/ }).fill("A sequence about dry wind.");
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(create.getByRole("alert")).toHaveText("Give the collection a title");
  await expect(create.getByRole("textbox", { name: /Intro/ })).toHaveValue("A sequence about dry wind.");
  await create.getByRole("textbox", { name: "Title" }).fill(cycle);
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Collection created" })).toBeVisible();
  const collectionUrl = new URL(page.url()).pathname;

  // Details: prefilled with the saved values; the intro can change.
  const details = page.getByRole("region", { name: "Details" });
  await expect(details.getByRole("textbox", { name: "Title" })).toHaveValue(cycle);
  await details.getByRole("textbox", { name: /Intro/ }).fill("Dry wind, seven days.");
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Collection saved" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("paragraph").filter({ hasText: "Dry wind, seven days." })).toBeVisible();

  // Add poems from the collection page: each goes to the end.
  const main = page.getByRole("main");
  const list = main.getByRole("list").filter({ has: page.getByRole("button", { name: /^Move / }) });
  const status = main.getByRole("status").filter({ hasText: /Moved|Added|Removed/ });
  for (const title of [one, three, draft]) {
    await page.getByRole("combobox", { name: "Add a poem" }).selectOption({ label: title });
    await page.getByRole("button", { name: "Add to collection" }).click();
    await expect(status).toHaveText(new RegExp(`Added “${title}”`));
  }
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(one), new RegExp(three), new RegExp(draft)]);

  // Order it from the keyboard: Three to the top. Focus stays on the button.
  const upThree = page.getByRole("button", { name: `Move “${three}” up` });
  await upThree.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`Moved “${three}” to position 1 of 3.`);
  // Checked at once, without retrying: the announcement arrives with the new
  // order and the focus move, never before them (a race a fast keyboard user hit).
  expect(await list.getByRole("listitem").first().textContent()).toContain(three);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(`Move “${three}” up`);
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(three), new RegExp(one), new RegExp(draft)]);
  await expect(upThree).toBeFocused();
  // Already first: nothing happens, focus stays.
  await expect(upThree).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(upThree).toBeFocused();
  // Space works too, on Move down.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: `Move “${three}” down` })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(status).toHaveText(`Moved “${three}” to position 2 of 3.`);
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(one), new RegExp(three), new RegExp(draft)]);
  await expect(page.getByRole("button", { name: `Move “${three}” down` })).toBeFocused();
  await page.getByRole("button", { name: `Move “${three}” up` }).focus();
  await page.keyboard.press("Enter");
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(three), new RegExp(one), new RegExp(draft)]);

  // Assign the private poem from the poem editor's Collection picker: it goes to the end.
  const { rows } = await sql(`SELECT p.id, p.slug, e.slug AS author FROM poems p JOIN editors e ON e.id = p.editor_id WHERE e.email = '${email}'`);
  const byTitle = (t: string) => rows.find((r) => r.slug === t.toLowerCase().replace(/ /g, "-"))!;
  const author = rows[0].author as string;
  await page.goto(`/admin/poems/${byTitle(two).id}`);
  await page.getByRole("combobox", { name: "Collection" }).selectOption({ label: cycle });
  await expect(page.getByText("Saving adds it at the end.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Saved and published" })).toBeVisible();
  await page.goto(collectionUrl);
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(three), new RegExp(one), new RegExp(draft), new RegExp(two)]);

  // Reader, in the board overlay: Three is part 1 of 3 (the draft doesn't count).
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.getByRole("link", { name: three, exact: true }).click();
  let dialog = page.getByRole("dialog", { name: three });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Part 1 of 3 · ${cycle}`);
  const nav = (d = dialog) => d.getByRole("navigation", { name: new RegExp(`^${cycle}, part`) });
  await expect(nav().getByRole("link", { name: /Previous/ })).toHaveCount(0);
  await nav().getByRole("link", { name: new RegExp(`^Next:\\s*${one}$`) }).click();

  dialog = page.getByRole("dialog", { name: one });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/p/${author}/${byTitle(one).slug}$`));
  await expect(dialog).toContainText("Part 2 of 3");
  // The private neighbour: title and lock only.
  const toTwo = nav().getByRole("link", { name: new RegExp(`^Next:\\s*${two}\\s*\\(password protected\\)$`) });
  await expect(toTwo).toBeVisible();
  await toTwo.click();
  dialog = page.getByRole("dialog", { name: two });
  await expect(dialog).toContainText("Part 3 of 3");
  await expect(dialog.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  expect(await page.content()).not.toContain(`secret two text ${id}`);
  await nav().getByRole("link", { name: new RegExp(`^Previous:\\s*${one}$`) }).click();
  await expect(page.getByRole("dialog", { name: one })).toBeVisible();
  // Closing the overlay returns to the board: the steps replaced history, not stacked it.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Full page: ordinary links, so Back returns to the previous part.
  await page.goto(`/p/${author}/${byTitle(two).slug}`);
  const pageNav = page.getByRole("main").getByRole("navigation", { name: new RegExp(`^${cycle}, part 3 of 3`) });
  await expect(page.getByRole("main")).toContainText(`Part 3 of 3 · ${cycle}`);
  await pageNav.getByRole("link", { name: new RegExp(`^Previous:\\s*${one}$`) }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${author}/${byTitle(one).slug}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Part 2 of 3");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/p/${author}/${byTitle(two).slug}$`));
  const html = await page.content();
  expect(html).not.toContain(draft);
  expect(html).not.toContain(`draft text ${id}`);
  expect(html).not.toContain(`secret two text ${id}`);
  expect(html).not.toContain(email);

  // Removing a poem closes the gap; deleting the collection keeps its poems.
  await page.goto(collectionUrl);
  await page.getByRole("button", { name: `Remove “${draft}” from the collection` }).click();
  await expect(status).toHaveText(new RegExp(`Removed “${draft}”`));
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(three), new RegExp(one), new RegExp(two)]);
  await page.getByRole("button", { name: "Delete collection" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections(\?.*)?$/, { timeout: 45_000 });
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Collection deleted" })).toBeVisible();
  await page.goto(`/p/${author}/${byTitle(one).slug}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: one })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Part 2");
});

test("another editor's collection is not found", async ({ page, browser }) => {
  const id = unique();
  await signUpAs(page, `cyc-own-${id}@example.com`, `Owner ${id}`);
  await page.goto("/admin/collections");
  const create = page.getByRole("region", { name: "New collection" });
  await create.getByRole("textbox", { name: "Title" }).fill(`Mine ${id}`);
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const url = new URL(page.url()).pathname;

  const other = await browser.newContext();
  const intruder = await other.newPage();
  await signUpAs(intruder, `cyc-intruder-${id}@example.com`, `Intruder ${id}`);
  await intruder.goto(url);
  await expect(intruder.getByRole("heading", { name: "Collection not found" })).toBeVisible();
  expect(await intruder.content()).not.toContain(`Mine ${id}`);
  await intruder.goto("/admin/collections/not-a-uuid");
  await expect(intruder.getByRole("heading", { name: "Collection not found" })).toBeVisible();
  await other.close();
});
