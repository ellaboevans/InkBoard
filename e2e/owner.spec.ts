import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER_EMAIL } from "../playwright.config";
import { latestStepUpCode, signInAsOwner, signUpAs, sql } from "./helpers";

/*
 * The owner's page (docs/PLAN.md, Phase 32 round 3), on a phone: anyone else
 * gets a real 404 at /admin/owner and no sidebar item; the owner (OWNER_EMAIL
 * on the E2E server) sees a reader's report, confirms it's them with an
 * emailed code (step-up), hides the poem (its page is then a 404), finds it
 * under "Hidden now", restores it, and marks the report reviewed.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();

/** The phone sidebar is a drawer: open it to see its links. */
async function openSidebar(page: Page) {
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Poems" })).toBeVisible();
}

test("anyone but the owner gets a 404 and no Owner item", async ({ page }) => {
  test.setTimeout(300_000);
  const id = unique();
  await signUpAs(page, `not-owner-${id}@example.com`, `Not Owner ${id}`);
  const res = await page.goto("/admin/owner");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Reports" })).toHaveCount(0);
  await page.goto("/admin");
  await openSidebar(page);
  await expect(page.getByRole("dialog").getByRole("link", { name: "Reports" })).toHaveCount(0);
});

test("the owner reviews a report: step-up, hide (a 404), Hidden now, restore, mark reviewed", async ({ page }) => {
  test.setTimeout(600_000);
  const id = unique();
  // A writer with two poems; a reader reported one of them.
  const slug = `owner-case-${id}`;
  const { rows } = await sql(
    `INSERT INTO editors (email, pen_name, slug) VALUES ('owner-case-${id}@example.com', 'Reported Writer ${id}', '${slug}') RETURNING id`,
  );
  const title = `Dusk ${id}`;
  const { rows: made } = await sql(`INSERT INTO poems (editor_id, title, slug, body, visibility, status, published_at) VALUES
      ('${rows[0].id}', '${title}', 'dusk', 'The light goes.', 'public', 'published', now()),
      ('${rows[0].id}', 'Still here ${id}', 'still-here', 'Another line.', 'public', 'published', now())
    RETURNING id, slug`);
  const duskId = made.find((r) => r.slug === "dusk")!.id as string;
  await sql(`INSERT INTO reports (poem_id, reason, details) VALUES ('${duskId}', 'copied', 'This is <b>mine</b>, from my blog.')`);
  const path = `/p/${slug}/dusk`;

  await signInAsOwner(page, E2E_OWNER_EMAIL);
  // The sidebar's Owner item, for the owner only.
  await openSidebar(page);
  await page.getByRole("dialog").getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/admin\/owner$/);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();

  // Make the sign-in older than the step-up window: every change must ask again.
  await sql(`UPDATE sessions SET email_verified_at = now() - interval '11 minutes'
    WHERE editor_id = (SELECT id FROM editors WHERE email = '${E2E_OWNER_EMAIL}')`);
  await page.reload();

  const group = page.locator("[data-report-group]").filter({ has: page.getByRole("heading", { name: title }) });
  await expect(group).toBeVisible();
  await expect(group).toContainText("Copied from someone else");
  // The reader's words as text, never HTML.
  await expect(group).toContainText("This is <b>mine</b>, from my blog.");
  await expect(group.getByRole("link", { name: new RegExp(`${path}$`) })).toBeVisible();

  // Hide: confirm it's you (a code), then the dialog says what will happen.
  await group.getByRole("button", { name: /^Hide poem/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(await latestStepUpCode(E2E_OWNER_EMAIL));
  const dialog = page.getByRole("alertdialog", { name: `Hide “${title}”?` });
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(dialog).toContainText("Nothing is deleted");
  await dialog.getByRole("button", { name: "Hide poem" }).click();
  await expect(toast(page, "Hidden from readers")).toBeVisible({ timeout: 45_000 });
  await expect(group.getByText("Hidden now", { exact: true })).toBeVisible();
  expect((await page.request.get(path)).status()).toBe(404);

  // Hidden now, and restore from there (no second step-up: the session is fresh now).
  await page.getByRole("tab", { name: /Hidden now/ }).click();
  const item = page.locator("[data-hidden-item]").filter({ hasText: title });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: /^Restore/ }).click();
  const restore = page.getByRole("alertdialog", { name: `Restore “${title}”?` });
  await restore.getByRole("button", { name: "Restore poem" }).click();
  await expect(toast(page, "Restored")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-hidden-item]").filter({ hasText: title })).toHaveCount(0);
  expect((await page.request.get(path)).status()).toBe(200);

  // Mark as reviewed: the group leaves "Open" and shows under "Reviewed".
  await page.getByRole("tab", { name: /Open/ }).click();
  await group.getByRole("button", { name: /^Mark as reviewed/ }).click();
  await expect(toast(page, "Marked as reviewed")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("tabpanel").locator("[data-report-group]").filter({ hasText: title })).toHaveCount(0);
  await page.getByRole("tab", { name: /Reviewed/ }).click();
  await expect(page.getByRole("tabpanel").locator("[data-report-group]").filter({ hasText: title })).toContainText("reviewed");
  const { rows: left } = await sql(`SELECT reviewed_at FROM reports WHERE poem_id = '${duskId}'`);
  expect(left[0].reviewed_at).not.toBeNull();
});
