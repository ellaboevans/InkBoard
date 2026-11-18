import { expect, test, type Locator, type Page } from "@playwright/test";
import { chooseOption, signUpAs, sql } from "./helpers";

/*
 * The shared dropdown (shadcn/Radix Select, src/components/form-controls.tsx)
 * and the novel form's layout (owner's feedback after Phase 26):
 * - Language and Status line up: side by side from 640 px, the same top for
 *   both labels and both boxes; stacked on phones, the same edges and arrows.
 * - A choice survives "Save changes" and a second save (React resets a
 *   <form action> after every action, and Radix's Select answers that reset
 *   by going back to its value at mount), on the novel details and the poem
 *   editor.
 * - The list portals but behaves inside a dialog: Esc closes only the list.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function geometry(scope: Locator, prefix: string) {
  return scope.evaluate((root, p) => {
    const r = (sel: string) => root.querySelector(sel)!.getBoundingClientRect();
    const chevron = (id: string) => root.querySelector(`#${id} svg`)!.getBoundingClientRect();
    const one = (name: string) => {
      const box = r(`#${p}-${name}`);
      const label = r(`label[for="${p}-${name}"]`);
      return { labelTop: label.top, boxTop: box.top, boxLeft: box.left, boxRight: box.right, boxHeight: box.height, arrowFromRight: box.right - chevron(`${p}-${name}`).right };
    };
    return { language: one("language"), status: one("status") };
  }, prefix);
}

async function expectAligned(page: Page, scope: Locator, prefix: string, where: string) {
  const g = await geometry(scope, prefix);
  const wide = page.viewportSize()!.width >= 640;
  const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${where}: ${what} (${a} vs ${b})`).toBeLessThanOrEqual(0.5);
  near(g.language.boxHeight, g.status.boxHeight, "box heights");
  near(g.language.arrowFromRight, g.status.arrowFromRight, "arrow positions");
  if (wide) {
    near(g.language.labelTop, g.status.labelTop, "label tops");
    near(g.language.boxTop, g.status.boxTop, "box tops");
  } else {
    // Stacked: same left and right edges, Status below Language.
    near(g.language.boxLeft, g.status.boxLeft, "left edges");
    near(g.language.boxRight, g.status.boxRight, "right edges");
    expect(g.status.labelTop, `${where}: Status below Language`).toBeGreaterThan(g.language.boxTop);
  }
  if (!wide) expect(g.language.boxHeight, `${where}: 44 px on phones`).toBeGreaterThanOrEqual(44);
}

test("the novel form's Language and Status line up in the new novel dialog and the details card, phone and desktop", async ({ page }) => {
  test.slow();
  await signUpAs(page, `align-${unique()}@example.com`, `Align ${unique()}`);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/novels");
    await page.getByRole("button", { name: "New novel" }).click();
    const dialog = page.getByRole("dialog", { name: "New novel" });
    await expect(dialog.getByRole("combobox", { name: "Status" })).toHaveText("Ongoing");
    await expectAligned(page, dialog, "new-novel", `new novel dialog at ${width}px`);
    // No gap left by the special letters' empty status line: the blurb help sits right above the row.
    const gap = await dialog.evaluate((d) => {
      const button = [...d.querySelectorAll("button")].find((b) => b.textContent?.includes("Special letters"))!;
      return d.querySelector('label[for="new-novel-language"]')!.getBoundingClientRect().top - button.getBoundingClientRect().bottom;
    });
    expect(gap, `gap under Special letters at ${width}px`).toBeLessThanOrEqual(24);

    // The list portals out of the dialog; Esc closes only the list, then the dialog.
    const language = dialog.getByRole("combobox", { name: "Language" });
    await language.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(language).toBeFocused();
    if (width === 1280) {
      await dialog.getByRole("textbox", { name: "Title" }).fill(`Aligned ${unique()}`);
      await chooseOption(language, "Ewe");
      await dialog.getByRole("button", { name: "Create novel" }).click();
      await expect(page).toHaveURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 45_000 });
    } else {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  }
  const details = page.getByRole("region", { name: "Details" });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(details.getByRole("combobox", { name: "Language" })).toHaveText("Ewe");
    await expectAligned(page, details, "novel", `details card at ${width}px`);
  }
});

test("a Select's choice survives Save changes and a second save: novel details and poem editor", async ({ page }) => {
  test.slow();
  const id = unique();
  const email = `select-save-${id}@example.com`;
  await signUpAs(page, email, `Select Saver ${id}`);
  const { rows: who } = await sql(`SELECT id FROM editors WHERE email = '${email}'`);
  const editor = who[0].id as string;

  // Novel details: Language and Status.
  const { rows: n } = await sql(`INSERT INTO novels (editor_id, title, slug) VALUES ('${editor}', 'Lake ${id}', 'lake') RETURNING id`);
  const novel = async () => (await sql(`SELECT language, status, blurb FROM novels WHERE id = '${n[0].id}'`)).rows[0];
  await page.goto(`/admin/novels/${n[0].id}`);
  const details = page.getByRole("region", { name: "Details" });
  const language = details.getByRole("combobox", { name: "Language" });
  const status = details.getByRole("combobox", { name: "Status" });
  await chooseOption(language, "Ewe");
  await chooseOption(status, "Complete");
  async function saveDetails(expected: Record<string, unknown>) {
    await details.getByRole("button", { name: "Save details" }).click();
    await expect.poll(novel, { timeout: 45_000 }).toMatchObject(expected);
    await page.waitForTimeout(1000); // a reset-driven flip would show by now
    await expect(language).toHaveText("Ewe");
    await expect(status).toHaveText("Complete");
    await expect(details.locator('input[type="hidden"][name="language"]')).toHaveValue("ee");
    await expect(details.locator('input[type="hidden"][name="status"]')).toHaveValue("complete");
  }
  await saveDetails({ language: "ee", status: "complete" });
  // A second save (another field) keeps both.
  await details.getByRole("textbox", { name: /Blurb/ }).fill("Every Thursday the ferry crosses.");
  await saveDetails({ language: "ee", status: "complete", blurb: "Every Thursday the ferry crosses." });

  // Poem editor: Language and Collection.
  const { rows: c } = await sql(`INSERT INTO collections (editor_id, title, slug) VALUES ('${editor}', 'Harbour ${id}', 'harbour') RETURNING id`);
  const { rows: p } = await sql(`INSERT INTO poems (editor_id, title, slug, body, visibility, status, published_at)
    VALUES ('${editor}', 'Tide ${id}', 'tide', 'a line', 'public', 'published', now()) RETURNING id`);
  const poem = async () => (await sql(`SELECT language, collection_id, body FROM poems WHERE id = '${p[0].id}'`)).rows[0];
  await page.goto(`/admin/poems/${p[0].id}`);
  const poemLanguage = page.getByRole("combobox", { name: "Language" });
  const collection = page.getByRole("combobox", { name: "Collection" });
  await chooseOption(poemLanguage, "Ga");
  await chooseOption(collection, `Harbour ${id}`);
  async function savePoem(expected: Record<string, unknown>) {
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(poem, { timeout: 45_000 }).toMatchObject(expected);
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await page.waitForTimeout(1000);
    await expect(poemLanguage).toHaveText("Ga");
    await expect(collection).toHaveText(`Harbour ${id}`);
    await expect(page.locator('input[type="hidden"][name="language"]')).toHaveValue("gaa");
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  }
  await savePoem({ language: "gaa", collection_id: c[0].id });
  await page.getByRole("textbox", { name: "Poem" }).fill("a line, revised");
  await savePoem({ language: "gaa", collection_id: c[0].id, body: "a line, revised" });
});
