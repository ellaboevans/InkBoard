import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql, expectBackOnList } from "./helpers";

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
  if (opts.draft) await expect(page.getByText("Poem created")).toBeVisible({ timeout: 45_000 });
  else await expectBackOnList(page);
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
  // "New collection" opens a dialog. A validation error keeps what was typed.
  const newButton = page.getByRole("button", { name: "New collection" });
  await newButton.click();
  let form = page.getByRole("dialog", { name: "New collection" });
  await expect(form.getByRole("textbox", { name: "Title" })).toBeFocused();
  await form.getByRole("textbox", { name: /Intro/ }).fill("A sequence about dry wind.");
  await form.getByRole("button", { name: "Create collection" }).click();
  await expect(form.getByRole("alert")).toHaveText("Give the collection a title");
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Couldn't create collection" })).toBeVisible();
  await expect(form.getByRole("textbox", { name: /Intro/ })).toHaveValue("A sequence about dry wind.");
  // Escape closes it and returns focus to the button.
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(newButton).toBeFocused();
  await newButton.click();
  form = page.getByRole("dialog", { name: "New collection" });
  await form.getByRole("textbox", { name: "Title" }).fill(cycle);
  await form.getByRole("textbox", { name: /Intro/ }).fill("A sequence about dry wind.");
  await form.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Collection created" })).toBeVisible();
  const collectionUrl = new URL(page.url()).pathname;
  // No stray code comments rendered as text.
  await expect(page.getByRole("main")).not.toContainText(/\/\/|minmax/);

  // "Edit details" opens a dialog prefilled with the saved values.
  const editButton = page.getByRole("button", { name: "Edit details" });
  await editButton.click();
  form = page.getByRole("dialog", { name: "Edit collection" });
  await expect(form.getByRole("textbox", { name: "Title" })).toHaveValue(cycle);
  await form.getByRole("textbox", { name: "Title" }).fill("");
  await form.getByRole("textbox", { name: /Intro/ }).fill("Edited intro.");
  await form.getByRole("button", { name: "Save details" }).click();
  await expect(form.getByRole("alert")).toHaveText("Give the collection a title");
  await expect(form.getByRole("textbox", { name: /Intro/ })).toHaveValue("Edited intro.");
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(editButton).toBeFocused();
  await editButton.click();
  await expect(form.getByRole("textbox", { name: "Title" })).toHaveValue(cycle); // nothing was saved
  await form.getByRole("textbox", { name: /Intro/ }).fill("Dry wind, seven days.");
  await form.getByRole("button", { name: "Save details" }).click();
  await expect(form).toHaveCount(0);
  await expect(editButton).toBeFocused();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Collection saved" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Dry wind, seven days.");

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

  // Drag by the grip handle: Draft to the top. The new order shows at once and is saved.
  const handle = page.locator(`[data-drag-handle]`).nth(2);
  const target = await list.getByRole("listitem").first().boundingBox();
  const from = (await handle.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, target!.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(draft), new RegExp(three), new RegExp(one)]);
  await expect(status).toHaveText(`Moved “${draft}” to position 1 of 3.`);
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(draft), new RegExp(three), new RegExp(one)]);

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
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(draft), new RegExp(three), new RegExp(one), new RegExp(two)]);

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
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Title" }).fill(`Mine ${id}`);
  await page.getByRole("dialog").getByRole("button", { name: "Create collection" }).click();
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

test("a dropped order that can't be saved rolls back with an error", async ({ page }) => {
  const id = unique();
  const email = `cyc-stale-${id}@example.com`;
  await signUpAs(page, email, `Stale ${id}`);
  for (const t of ["A", "B", "C"]) await publish(page, `${t} ${id}`, "x");
  await page.goto("/admin/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Title" }).fill(`Stale ${id}`);
  await page.getByRole("dialog").getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  for (const t of ["A", "B", "C"]) {
    await page.getByRole("combobox", { name: "Add a poem" }).selectOption({ label: `${t} ${id}` });
    await page.getByRole("button", { name: "Add to collection" }).click();
    await expect(page.getByRole("button", { name: `Remove “${t} ${id}” from the collection` })).toBeVisible();
  }
  // Behind the page's back (another tab, say), C leaves the collection.
  await sql(`UPDATE poems SET collection_id = NULL, collection_position = NULL WHERE title = 'C ${id}'`);

  const list = page.getByRole("main").getByRole("list").filter({ has: page.getByRole("button", { name: /^Move / }) });
  const from = (await page.locator("[data-drag-handle]").nth(1).boundingBox())!;
  const to = (await list.getByRole("listitem").first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Couldn't save the new order" })).toBeVisible();
  // Rolled back to what the server has: A, B (C has gone).
  await expect(list.getByRole("listitem")).toHaveText([new RegExp(`A ${id}`), new RegExp(`B ${id}`)]);
});

test("stepping through a collection in the overlay keeps the same dialog open and still", async ({ page }) => {
  test.setTimeout(240_000); // two widths, a private poem to unlock, and cold Server Actions
  const id = unique();
  const email = `cyc-step-${id}@example.com`;
  const cycle = `Steps ${id}`;
  const [one, two, three] = [`First ${id}`, `Second ${id}`, `Third ${id}`];
  await signUpAs(page, email, `Step Poet ${id}`);
  await publish(page, one, "first poem text");
  await publish(page, two, `secret second text ${id}`, { password: "second-pass" });
  await publish(page, three, "third poem text");
  await page.goto("/admin/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Title" }).fill(cycle);
  await page.getByRole("dialog").getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  for (const t of [one, three, two]) {
    await page.getByRole("combobox", { name: "Add a poem" }).selectOption({ label: t });
    await page.getByRole("button", { name: "Add to collection" }).click();
    await expect(page.getByRole("button", { name: `Remove “${t}” from the collection` })).toBeVisible();
  }

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
    const world = page.locator("[data-lod]");
    // From the board via search, which flies to the card and focuses it: a
    // click can't reach a card outside the viewport (the board is shared with
    // the other tests' poems).
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search the board" });
    await palette.getByRole("combobox").fill(one);
    await palette.getByRole("option", { name: new RegExp(one) }).press("Enter");
    const card = page.getByRole("link", { name: one, exact: true });
    await expect(card).toBeFocused();
    // Wait for the camera to settle, then remember where it is.
    await expect.poll(async () => {
      const a = await world.evaluate((el) => (el as HTMLElement).style.transform);
      await page.waitForTimeout(150);
      return a === (await world.evaluate((el) => (el as HTMLElement).style.transform));
    }).toBe(true);
    const camera = await world.evaluate((el) => (el as HTMLElement).style.transform);

    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: one });
    await expect(dialog).toBeVisible();
    // Opening animates, as before. Then tag the dialog node and count any replayed animation.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    await page.evaluate(() => {
      const el = document.querySelector('[data-slot="dialog-content"]') as HTMLElement & { __tag?: string };
      el.__tag = "same-node";
      const w = window as unknown as { __replays: number };
      w.__replays = 0;
      document.addEventListener(
        "animationstart",
        (e) => {
          const t = e.target as HTMLElement;
          if (t.matches('[data-slot="dialog-content"], [data-slot="dialog-overlay"]')) w.__replays++;
        },
        true,
      );
    });
    const sameNode = () =>
      page.evaluate(() => (document.querySelector('[data-slot="dialog-content"]') as HTMLElement & { __tag?: string }).__tag);
    const focusedText = () => page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.textContent}`);
    await expect.poll(focusedText).toBe(`H1:${one}`);

    const nav = () => page.getByRole("dialog").getByRole("navigation", { name: new RegExp(`^${cycle}, part`) });
    const where = `at ${width}px`;

    // Next: same dialog node, no replayed animation, named by the new poem, focus on its title.
    await nav().getByRole("link", { name: new RegExp(`^Next:\\s*${three}$`) }).click();
    await expect(page.getByRole("dialog", { name: three }), where).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(`Part 2 of 3 · ${cycle}`);
    await expect.poll(focusedText, where).toBe(`H1:${three}`);
    expect(await sameNode(), where).toBe("same-node");
    expect(await page.evaluate(() => (window as unknown as { __replays: number }).__replays), where).toBe(0);
    // Only one dialog is exposed, and it's scrolled to the top.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(await page.locator("[data-poem-scroll]").evaluate((el) => el.scrollTop)).toBe(0);
    // The title's description is its "Part n of m" line.
    await expect(page.getByRole("dialog").getByRole("heading", { level: 1, name: three })).toHaveAccessibleDescription(`Part 2 of 3 · ${cycle}`);

    // Onto the private poem: title only, then unlock it right there.
    await nav().getByRole("link", { name: new RegExp(`^Next:\\s*${two}`) }).click();
    const locked = page.getByRole("dialog", { name: two });
    await expect(locked).toContainText("Part 3 of 3");
    await expect.poll(focusedText, where).toBe(`H1:${two}`);
    if (width === 375) {
      // Not unlocked yet: its text is nowhere in the page (N1).
      expect(await page.content()).not.toContain(`secret second text ${id}`);
      await locked.getByLabel("Password", { exact: true }).fill("second-pass");
      await locked.getByRole("button", { name: "Unlock poem" }).click();
      await expect(locked).toContainText(`secret second text ${id}`);
    } else {
      // Unlocked on this device already (the 375px pass): the text shows.
      await expect(locked).toContainText(`secret second text ${id}`);
    }
    expect(await sameNode(), where).toBe("same-node");

    // Previous, twice: back to the first poem, still the same dialog.
    await nav().getByRole("link", { name: new RegExp(`^Previous:\\s*${three}$`) }).click();
    await expect(page.getByRole("dialog", { name: three })).toBeVisible();
    await expect.poll(focusedText, where).toBe(`H1:${three}`);
    await nav().getByRole("link", { name: new RegExp(`^Previous:\\s*${one}$`) }).click();
    await expect(page.getByRole("dialog", { name: one })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(`Part 1 of 3 · ${cycle}`);
    await expect.poll(focusedText, where).toBe(`H1:${one}`);
    expect(await sameNode(), where).toBe("same-node");
    expect(await page.evaluate(() => (window as unknown as { __replays: number }).__replays), where).toBe(0);

    // Escape (at 375) or Back (at 1280): one step back to the board, same pan and zoom.
    if (width === 375) await page.keyboard.press("Escape");
    else await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await world.evaluate((el) => (el as HTMLElement).style.transform), where).toBe(camera);
  }
});
