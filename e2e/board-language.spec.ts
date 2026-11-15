import { expect, test, type Page } from "@playwright/test";
import { renderedToastTitle, signOut, signUpAs, sql, expectBackOnList } from "./helpers";

// Browsing the board by language (docs/PLAN.md, Phase 11c): a filter in the
// toolbar, kept in the URL (?lang=ee), followed by the list view and the
// Authors index; search still covers everything.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, language: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: language });
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page, 45_000);
}

async function openBoard(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

/** "Showing Ewe poem · 1" or "Showing Ewe poems · N": the noun agrees with the count. */
const EWE_STATUS = /^Showing Ewe (poem · 1|poems · (0|[2-9]|\d{2,}))$/;

const filter = (page: Page) => page.getByRole("combobox", { name: "Language" });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /^Showing / });
const card = (page: Page, title: string) =>
  page.locator("[data-card]").filter({ has: page.getByRole("link", { name: title, exact: true }) });

test("filtering the board by language, in the URL, the list view and the Authors index", async ({ page }) => {
  const id = unique();
  const ewePoet = `Ewe Poet ${id}`;
  const englishPoet = `English Poet ${id}`;
  await signUpAs(page, `lang-a-${id}@example.com`, ewePoet);
  await publish(page, `Ŋutifafa ${id}`, `Ŋutifafa na wò ${id}`, "Ewe");
  await publish(page, `Ɖoɖo ${id}`, `hidden ewe text ${id}`, "Ewe", "ewe-pass");
  await publish(page, `Morning ${id}`, "an English poem", "English");
  await signOut(page);
  await signUpAs(page, `lang-b-${id}@example.com`, englishPoet);
  await publish(page, `Evening ${id}`, "only English here", "English");

  await openBoard(page);
  // Only languages with poems are offered (nothing is tagged Ga).
  const offered = await filter(page).locator("option").allTextContents();
  expect(offered).toEqual(expect.arrayContaining(["All languages", "Ewe", "English"]));
  expect(offered).not.toContain("Ga");
  await expect(filter(page)).toHaveValue("");
  await expect(status(page)).toHaveCount(0);

  // Pick Ewe: the URL follows, other languages and emptied authors drop out.
  await filter(page).selectOption({ label: "Ewe" });
  await expect(page).toHaveURL(/\/\?lang=ee$/);
  await expect(status(page)).toContainText("Showing Ewe poems ·");
  await expect(card(page, `Ŋutifafa ${id}`)).toBeVisible();
  await expect(card(page, `Ɖoɖo ${id} (password protected)`)).toBeAttached();
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);
  await expect(page.locator(`[aria-label^="${englishPoet},"]`)).toHaveCount(0);
  await expect(page.getByRole("region", { name: `${ewePoet}, 2 poems` })).toBeAttached();
  // Private poems stay title-only (N1).
  expect(await page.content()).not.toContain(`hidden ewe text ${id}`);

  // The Authors index follows the filter.
  await page.getByRole("button", { name: /^Authors/ }).click();
  const authors = page.getByRole("navigation", { name: "Authors" });
  await expect(authors.getByRole("button", { name: new RegExp(ewePoet) })).toBeVisible();
  await expect(authors.getByRole("button", { name: new RegExp(englishPoet) })).toHaveCount(0);
  await page.getByRole("button", { name: /^Authors/ }).click();

  // Search still covers everything; a filtered-out author explains itself.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search the board" });
  await palette.getByRole("combobox").fill(englishPoet);
  await palette.getByRole("option", { name: new RegExp(englishPoet) }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: `${englishPoet} has no Ewe poems` })).toBeVisible();
  // Shown as written: a pen name and a language inside a sentence-case title.
  expect(await renderedToastTitle(page, `${englishPoet} has no Ewe poems`)).toBe(`${englishPoet} has no Ewe poems`);

  // Opening a poem and closing the overlay keeps the filter.
  await page.getByRole("link", { name: `Ŋutifafa ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Ŋutifafa ${id}` })).toBeVisible();
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/\?lang=ee$/);
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);

  // Reload keeps it; back returns to all.
  await page.reload();
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(filter(page)).toHaveValue("ee");
  await expect(card(page, `Morning ${id}`)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, `Morning ${id}`)).toBeVisible();

  // List view follows the filter, and can change it.
  await openBoard(page, "/?lang=ee");
  await page.getByRole("button", { name: "List view" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: new RegExp(`^Ŋutifafa ${id}`) })).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`^Morning ${id}`) })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: new RegExp(englishPoet) })).toHaveCount(0);
  await filter(page).selectOption({ label: "English" });
  await expect(page).toHaveURL(/\/\?lang=en$/);
  await expect(main.getByRole("link", { name: new RegExp(`^Evening ${id}`) })).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`^Ŋutifafa ${id}`) })).toHaveCount(0);

  // "Show all languages" removes the param and returns focus to the filter.
  await page.getByRole("button", { name: "Show all languages" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(filter(page)).toBeFocused();
  await expect(main.getByRole("link", { name: new RegExp(`^Ŋutifafa ${id}`) })).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`^Evening ${id}`) })).toBeVisible();
});

test("an unknown or unused language behaves like All", async ({ page }) => {
  for (const url of ["/?lang=zz", "/?lang=gaa", "/?lang="]) {
    await openBoard(page, url);
    await expect(filter(page)).toHaveValue("");
    await expect(status(page)).toHaveCount(0);
  }
});

test("the filter works from the keyboard", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `lang-kb-${id}@example.com`, `Keyboard Poet ${id}`);
  await publish(page, `Akwaaba ${id}`, "Akwaaba", "Akan (Twi, Fante, Nzema)");
  await openBoard(page, "/?lang=ak");
  await expect(status(page)).toContainText(/Showing Akan poems? ·/);
  // The filter is a native <select> (keyboard-operable by the browser);
  // check it's focusable and that "Show all" works with Enter.
  await filter(page).focus();
  await expect(filter(page)).toBeFocused();
  const showAll = page.getByRole("button", { name: "Show all languages" });
  await showAll.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(filter(page)).toBeFocused();
  await expect(status(page)).toHaveCount(0);
});

/**
 * The filter indicator and toolbar at phone and desktop widths. The indicator
 * used to be an absolute box centred with left-1/2, which only gets half the
 * screen to size itself in, so on phones its text wrapped one word per line.
 */
test("the filter indicator stays one tidy line from phones to desktops", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `lang-fit-${id}@example.com`, `Narrow Screen Poet ${id}`);
  await publish(page, `Ŋkɔ ${id}`, "Ŋutifafa", "Ewe");

  /** Rects of the indicator, its text and button, and every other control it must not cover. */
  const measure = () =>
    page.locator("[data-filter-status]").filter({ visible: true }).evaluate((pill) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
      };
      const text = pill.querySelector("[data-filter-status-text]")!;
      const button = pill.querySelector("button")!;
      const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const others = [...document.querySelectorAll("header a, header button, header select, button[aria-controls='authors-list']")]
        .filter((el) => visible(el) && !pill.contains(el))
        .map(box);
      return {
        viewport: window.innerWidth,
        pill: box(pill),
        text: { ...box(text), lineHeight: parseFloat(getComputedStyle(text).lineHeight), clipped: text.scrollWidth > text.clientWidth },
        button: { ...box(button), lineHeight: parseFloat(getComputedStyle(button).lineHeight) },
        others,
      };
    });

  const expectTidy = async (where: string) => {
    const m = await measure();
    // One line each: the bug made the text three lines tall.
    expect(m.text.height, `${where}: text on one line`).toBeLessThan(m.text.lineHeight * 1.5);
    expect(m.text.clipped, `${where}: text not cut off`).toBe(false);
    expect(m.button.height, `${where}: button on one line`).toBeLessThan(m.button.lineHeight * 2.5);
    // Inside the screen.
    expect(m.pill.left, `${where}: left edge`).toBeGreaterThanOrEqual(0);
    expect(m.pill.right, `${where}: right edge`).toBeLessThanOrEqual(m.viewport);
    // Not covering the toolbar or the Authors button.
    for (const o of m.others) {
      const overlaps = o.left < m.pill.right && m.pill.left < o.right && o.top < m.pill.bottom && m.pill.top < o.bottom;
      expect(overlaps, `${where}: overlaps a control at ${JSON.stringify(o)}`).toBe(false);
    }
    // Every toolbar control is on screen too.
    for (const o of m.others) expect(o.right, `${where}: control off screen`).toBeLessThanOrEqual(m.viewport);
  };

  const statusText = () => page.locator("[data-filter-status-text]").filter({ visible: true });

  /** The toolbar's controls: on screen, not overlapping, each on one line, in at most two rows. */
  const expectToolbar = async (where: string) => {
    const m = await page.locator("[data-board-toolbar]").filter({ visible: true }).evaluate((bar) => {
      const controls = [...bar.querySelectorAll("a, button, select")].filter((el) => (el as HTMLElement).offsetParent !== null);
      return {
        viewport: window.innerWidth,
        boxes: controls.map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName, left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
        }),
      };
    });
    expect(m.boxes.length, `${where}: toolbar has controls`).toBeGreaterThan(2);
    const rows = new Set(m.boxes.map((b) => Math.round(b.top / 8)));
    expect(rows.size, `${where}: toolbar rows ${JSON.stringify(m.boxes)}`).toBeLessThanOrEqual(2);
    for (const [i, a] of m.boxes.entries()) {
      expect(a.left, `${where}: ${a.name} off screen (left)`).toBeGreaterThanOrEqual(0);
      expect(a.right, `${where}: ${a.name} off screen (right)`).toBeLessThanOrEqual(m.viewport);
      expect(a.height, `${where}: ${a.name} on one line`).toBeLessThanOrEqual(36);
      for (const b of m.boxes.slice(i + 1)) {
        const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `${where}: ${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  };

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    // Unfiltered: the toolbar with Subscribe in it fits.
    await openBoard(page, "/");
    await expectToolbar(`board toolbar at ${width}px`);

    await openBoard(page, "/?lang=ee");
    await expectToolbar(`filtered board toolbar at ${width}px`);
    await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeVisible();
    // Shortened on phones, but read in full.
    await expect(statusText()).toHaveText(EWE_STATUS);
    const showAll = page.getByRole("button", { name: "Show all languages", exact: true });
    await expect(showAll).toBeVisible();
    await expect(page.getByRole("button", { name: "List view", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fit", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Editor sign in", exact: true })).toBeVisible();
    await expectTidy(`board at ${width}px`);

    // With the Authors index open, the indicator still doesn't cover it.
    await page.getByRole("button", { name: /^Authors/ }).click();
    await expect(page.getByRole("navigation", { name: "Authors" })).toBeVisible();
    await expectTidy(`board with Authors open at ${width}px`);
    await page.getByRole("button", { name: /^Authors/ }).click();

    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(page.getByRole("button", { name: "Board view" })).toBeVisible();
    await expect(statusText()).toHaveText(EWE_STATUS);
    await expectTidy(`list view at ${width}px`);
    await expectToolbar(`list view toolbar at ${width}px`);
    await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Board view", exact: true })).toBeVisible();

    // "Show all" still hands focus back to the filter.
    await page.getByRole("button", { name: "Show all languages", exact: true }).click();
    await expect(filter(page)).toBeFocused();
    await expect(status(page)).toHaveCount(0);
  }
});

test("one author and one poem read in the singular", async ({ page }) => {
  // Ga is used by no other spec; clear any left from a retry so the filtered board has exactly one poem.
  await sql("UPDATE poems SET language = NULL WHERE language = 'gaa'");
  const id = unique();
  await signUpAs(page, `lang-one-${id}@example.com`, `Single Poet ${id}`);
  await publish(page, `Ŋmɛ ${id}`, "Ŋmɛ", "Ga");

  await openBoard(page, "/?lang=gaa");
  await expect(page.getByRole("link", { name: "InkBoard 1 author · 1 poem", exact: true })).toBeVisible();
  await expect(page.locator("#board-help")).toHaveText(/^1 Ga poem by 1 author\. Drag/);
  await expect(page.getByRole("region", { name: `Single Poet ${id}, 1 poem` })).toBeAttached();
  await expect(page.locator("[data-filter-status-text]").filter({ visible: true })).toHaveText("Showing Ga poem · 1");
});
