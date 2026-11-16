import { expect, test, type Page } from "@playwright/test";
import { createRecoveryCodes, expectBackOnList, latestCode, requestCode, signUpAs, sql, typeCode } from "./helpers";

/*
 * The dashboard's welcome checklist (docs/PLAN.md, Phase 20): a new writer
 * sees 1 of 6 done, the steps tick as they act, the recovery-code setup
 * prompt isn't shown alongside it, "Hide checklist" holds on another device,
 * and "You're all set" shows once.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const checklist = (page: Page) => page.getByRole("region", { name: "Getting started" });
const progress = (page: Page) => checklist(page).getByRole("progressbar");
const SETUP_PROMPT = "Set up recovery codes so you can sign in without your email";

async function expectDone(page: Page, n: number) {
  await page.goto("/admin");
  await expect(checklist(page).getByText(`${n} of 6 done`)).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", String(n));
  await expect(progress(page)).toHaveAttribute("aria-valuetext", `${n} of 6 done`);
}

/** Unfold the checklist if it's folded. */
async function allSteps(page: Page) {
  const toggle = checklist(page).getByRole("button", { name: /Show all steps|Show fewer/ });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

const step = (page: Page, id: string) => checklist(page).locator(`[data-step="${id}"]`);

test("a new writer works through the checklist; 'You're all set' shows once", async ({ page, context }) => {
  test.slow(); // the whole journey: profile, a poem, recovery codes, sharing
  // A browser without the Web Share API, so Share copies the link.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = unique();
  const email = `checklist-${id}@example.com`;
  await signUpAs(page, email, `Checklist Poet ${id}`);

  // Fresh: 1 of 6 (the pen name), unfolded, and no separate recovery-code prompt.
  await expectDone(page, 1);
  await expect(step(page, "pen-name")).toContainText("(Done)");
  await expect(step(page, "avatar")).not.toContainText("(Done)");
  await expect(step(page, "share")).toContainText("(Not yet)");
  await expect(page.getByRole("heading", { name: SETUP_PROMPT })).toHaveCount(0);

  // Avatar: the step's link goes to the profile's avatars.
  await step(page, "avatar").getByRole("link", { name: "Choose an avatar" }).click();
  await expect(page).toHaveURL(/\/admin\/profile#avatar$/);
  // Even the face already shown (the default) counts once it's chosen.
  // (The radios are visually hidden behind their pictures, hence force.)
  await page.getByRole("group", { name: "Avatar" }).getByRole("radio", { checked: true }).click({ force: true });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  await expectDone(page, 2);

  // About: a tagline (saving it doesn't count as anything else).
  await page.goto("/admin/profile");
  await page.getByRole("textbox", { name: /Tagline/ }).fill("Poems for slow mornings");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  await expectDone(page, 3);
  // Folded from three steps on: the progress and the next step.
  await expect(checklist(page).getByText("Next:")).toBeVisible();
  await expect(checklist(page)).toContainText("Publish your first poem");

  // Publish.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`First ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("a first line");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  await expectDone(page, 4);

  // A way in without email.
  await createRecoveryCodes(page);
  await expectDone(page, 5);

  // Share: copies the absolute author page URL, with a toast; then all six are done.
  await allSteps(page);
  await expect(step(page, "share")).not.toContainText("(Not yet)");
  const slug = (await sql(`SELECT slug FROM editors WHERE email = '${email}'`)).rows[0].slug as string;
  await step(page, "share").getByRole("button", { name: "Share your author page" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/a/${slug}`, page.url()).href);
  await expect(page.locator("[data-checklist-all-set]")).toBeVisible();
  await expect(page.locator("[data-checklist-all-set]").getByRole("heading", { name: "You’re all set" })).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);

  // Once: not on reload, nor after a step comes undone.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your poems" })).toBeVisible();
  await expect(page.locator("[data-checklist-all-set]")).toHaveCount(0);
  await expect(checklist(page)).toHaveCount(0);
  await sql(`DELETE FROM recovery_codes WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your poems" })).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  // With the checklist gone, the recovery-code setup prompt is back as before.
  await expect(page.getByRole("heading", { name: SETUP_PROMPT })).toBeVisible();
});

test("'Hide checklist' is permanent and holds in another browser", async ({ page, browser }) => {
  const id = unique();
  const email = `hide-${id}@example.com`;
  await signUpAs(page, email, `Hide Poet ${id}`);
  await expectDone(page, 1);
  await checklist(page).getByRole("button", { name: "Hide checklist" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Checklist hidden")).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  // Hidden, the old recovery-code prompt takes its usual place.
  await expect(page.getByRole("heading", { name: SETUP_PROMPT })).toBeVisible();

  // A fresh code for the same email (the resend cooldown is a rate-limit row).
  await sql("DELETE FROM rate_limits");
  const other = await browser.newContext();
  const second = await other.newPage();
  await requestCode(second, email);
  await typeCode(second, await latestCode(email));
  await expect(second).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  await expect(second.getByRole("heading", { level: 1, name: "Your poems" })).toBeVisible();
  await expect(checklist(second)).toHaveCount(0);
  await other.close();
});

test("'Not now' on the recovery step skips its nudge, not the checklist", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `notnow-${id}@example.com`, `Not Now Poet ${id}`);
  await expectDone(page, 1);
  await step(page, "way-in").getByRole("button", { name: "Not now for recovery codes" }).click();
  await expect(step(page, "way-in")).toContainText("(Skipped for now)");
  await expect(checklist(page).getByText("1 of 6 done")).toBeVisible();
  await expect(step(page, "way-in").getByRole("link", { name: "Set up recovery codes or a passkey" })).toBeVisible();
});

test("phones: no sideways scrolling, and the poems stay close", async ({ browser }) => {
  for (const width of [320, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 740 } });
    const page = await ctx.newPage();
    const id = unique();
    await signUpAs(page, `phone-${width}-${id}@example.com`, `Phone Poet ${id}`);
    await expectDone(page, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBeLessThanOrEqual(width);
    // With a poem, it starts folded (progress and the next step), and the page still fits.
    await sql(
      `INSERT INTO poems (editor_id, title, slug, body, status, visibility, published_at)
       SELECT id, 'Ati ɖeka', 'ati-deka', 'a line', 'published', 'public', now() FROM editors WHERE pen_name = 'Phone Poet ${id}'`,
    );
    await expectDone(page, 2);
    await expect(checklist(page).getByRole("button", { name: "Show all steps" })).toHaveAttribute("aria-expanded", "false");
    const box = (await checklist(page).boundingBox())!;
    expect(box.height, `${width}px folded height`).toBeLessThan(260);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px with poems`).toBeLessThanOrEqual(width);
    await ctx.close();
  }
});
