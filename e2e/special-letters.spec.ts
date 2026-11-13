import { expect, test, type Page } from "@playwright/test";
import { latestCode, requestCode, sql, typeCode } from "./helpers";

// The Special letters bar (docs/PLAN.md, Phase 11b): Akan, Ewe, Ga and IPA,
// on the poem editor (title + poem), the profile (pen name + bio) and onboarding.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const NASAL = "̃";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const bar = (page: Page) => page.getByRole("button", { name: "Special letters" });
const insert = (page: Page, name: string) => page.getByRole("button", { name: `Insert ${name}`, exact: true }).click();

test("onboarding, poem editor and profile: letters, capitals, tone marks, undo, IPA", async ({ page }) => {
  const id = unique();
  const email = `letters-${id}@example.com`;

  // Onboarding: type a pen name with Akan letters.
  await requestCode(page, email);
  await typeCode(page, await latestCode(email));
  await expect(page).toHaveURL(/\/admin\/onboarding$/, { timeout: 45_000 });
  const penName = page.getByRole("textbox", { name: "Pen name" });
  await penName.fill("K");
  await bar(page).click();
  await expect(page.getByRole("tab", { name: "Akan" })).toHaveAttribute("aria-selected", "true");
  await insert(page, "open o");
  await penName.pressSequentially(`fi ${id}`);
  await expect(penName).toHaveValue(`Kɔfi ${id}`);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });

  // Poem editor: the bar types into the poem, or the title once it's been used.
  await page.goto("/admin/poems/new");
  await bar(page).click();
  await page.getByRole("tab", { name: "Ewe" }).click();
  const poem = page.getByRole("textbox", { name: "Poem" });
  await poem.fill("ŋutifafa ");
  await insert(page, "open o");
  await insert(page, "nasal"); // attaches to ɔ
  await expect(poem).toHaveValue(`ŋutifafa ɔ${NASAL}`);
  await page.getByRole("button", { name: "Capitals" }).click();
  await insert(page, "capital eng");
  await expect(page.getByRole("button", { name: "Capitals" })).toHaveAttribute("aria-pressed", "false"); // one letter, like Shift
  await expect(poem).toHaveValue(`ŋutifafa ɔ${NASAL}Ŋ`);
  await poem.press("ControlOrMeta+z");
  await expect(poem).toHaveValue(`ŋutifafa ɔ${NASAL}`);

  // A tone mark with nothing before the cursor is refused, with a message.
  await poem.fill("");
  await insert(page, "nasal");
  await expect(poem).toHaveValue("");
  await expect(page.getByText("Type or select a letter first, then add the mark.")).toBeVisible();

  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Ɖevi ");
  await insert(page, "Ewe f");
  await expect(title).toHaveValue("Ɖevi ƒ");

  // IPA: search, and IPA keys never turn into capitals.
  await page.getByRole("tab", { name: "IPA" }).click();
  await page.getByRole("searchbox", { name: "Search IPA symbols" }).fill("open-mid back rounded");
  await poem.click();
  await insert(page, "open-mid back rounded");
  await expect(poem).toHaveValue("ɔ");
  await page.getByRole("searchbox", { name: "Search IPA symbols" }).fill("zzz");
  await expect(page.getByText("No IPA symbol matches that.")).toBeVisible();

  // Profile: the last tab is remembered; letters go into the pen name or bio.
  await page.goto("/admin/profile");
  await bar(page).click();
  await expect(page.getByRole("tab", { name: "IPA" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Ga" }).click();
  await page.getByRole("textbox", { name: /Bio/ }).fill("Ŋmɛnɛ ");
  await insert(page, "open e");
  await expect(page.getByRole("textbox", { name: /Bio/ })).toHaveValue("Ŋmɛnɛ ɛ");
  await page.getByRole("textbox", { name: "Pen name" }).click();
  await page.getByRole("textbox", { name: "Pen name" }).press("End");
  await insert(page, "eng");
  await expect(page.getByRole("textbox", { name: "Pen name" })).toHaveValue(`Kɔfi ${id}ŋ`);
});
