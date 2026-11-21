import { expect, test, type Locator, type Page } from "@playwright/test";
import { reportEmailsFor, sql } from "./helpers";

/*
 * Readers' reports (docs/PLAN.md, Phase 32 round 1), on a phone and a
 * desktop: report a poem from the board overlay and from its full page, and
 * a chapter; the owner's email lands in the outbox; "Something else" needs
 * details; closing the dialog puts focus back on the Report link.
 *
 * The author, poem and novel are written straight to the database under
 * fresh slugs, so no cached page holds an older copy.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function fixture() {
  const id = unique();
  const author = `reporter-${id}`;
  const { rows } = await sql(
    `INSERT INTO editors (email, pen_name, slug) VALUES ('report-${id}@example.com', 'Report Writer ${id}', '${author}') RETURNING id`,
  );
  const editorId = rows[0].id as string;
  await sql(`INSERT INTO poems (editor_id, title, slug, body, visibility, status, published_at)
    VALUES ('${editorId}', 'Dusk ${id}', 'dusk', 'The light goes.', 'public', 'published', now())`);
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${editorId}', 'Crossing ${id}', 'crossing') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, release_at, word_count)
    SELECT id, 'Landing', 'landing', 'It began on the shore.', 1, 'published'::poem_status, now(), now(), 5 FROM n`);
  return { id, author };
}

/** Pick a reason (click its label: the radio itself is small), maybe details, and send. */
async function fillAndSend(dialog: Locator, reason: string, details?: string) {
  await dialog.getByText(reason, { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: reason })).toBeChecked();
  if (details !== undefined) await dialog.getByRole("textbox", { name: /^Details/ }).fill(details);
  await dialog.getByRole("button", { name: "Send report" }).click();
}

async function expectThanksThenClose(page: Page, dialog: Locator, link: Locator) {
  await expect(dialog.getByRole("status")).toHaveText("Thanks. InkBoard's owner will look at it.", { timeout: 60_000 });
  await dialog.locator("[data-report-sent]").getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
}

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("a poem from its full page; 'Something else' needs details; Esc returns focus", async ({ page }) => {
      const { author, id } = await fixture();
      await page.goto(`/p/${author}/dusk`);
      const link = page.getByRole("button", { name: "Report this poem" });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);

      // Opened and closed with Esc: focus goes back to the link.
      await link.click();
      const dialog = page.getByRole("dialog", { name: "Report this poem" });
      await expect(dialog.getByRole("radio", { name: "Spam or advertising" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(link).toBeFocused();

      // "Something else" without details is refused in place, nothing sent.
      await link.click();
      await fillAndSend(dialog, "Something else");
      await expect(dialog.getByText("Tell us what’s wrong.")).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: /^Details/ })).toBeFocused();
      expect(await reportEmailsFor(`/p/${author}/dusk`)).toEqual([]);
      await dialog.getByRole("textbox", { name: /^Details/ }).fill("This is <b>my</b> poem, copied.");
      await dialog.getByRole("textbox", { name: /Your email/ }).fill("reader@example.org");
      await dialog.getByRole("button", { name: "Send report" }).click();
      await expectThanksThenClose(page, dialog, link);

      await expect.poll(() => reportEmailsFor(`/p/${author}/dusk`)).toEqual([
        {
          targetKind: "poem",
          title: `Dusk ${id}`,
          path: `/p/${author}/dusk`,
          reason: "other",
          details: "This is <b>my</b> poem, copied.",
          earlier: 0,
          hasReplyTo: true,
        },
      ]);
      // The reply address is never stored.
      const { rows } = await sql(`SELECT * FROM reports r JOIN poems p ON p.id = r.poem_id WHERE p.slug = 'dusk' AND p.title = 'Dusk ${id}'`);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain("reader@example.org");

      // A repeat from the same network: the same thank-you, no second email.
      await link.click();
      await fillAndSend(dialog, "Spam or advertising");
      await expectThanksThenClose(page, dialog, link);
      await page.waitForTimeout(500);
      expect(await reportEmailsFor(`/p/${author}/dusk`)).toHaveLength(1);
    });

    test("a poem from the board overlay", async ({ page }) => {
      const { author, id } = await fixture();
      await page.goto(`/a/${author}`);
      await page.getByRole("link", { name: `Dusk ${id}` }).click();
      const overlay = page.getByRole("dialog", { name: `Dusk ${id}` });
      await expect(overlay).toBeVisible();
      const link = overlay.getByRole("button", { name: "Report this poem" });
      await link.click();
      const dialog = page.getByRole("dialog", { name: "Report this poem" });
      await fillAndSend(dialog, "Copied from someone else");
      await expectThanksThenClose(page, dialog, link);
      // The overlay is still open underneath.
      await expect(overlay).toBeVisible();
      await expect.poll(async () => (await reportEmailsFor(`/p/${author}/dusk`)).map((m) => m.reason)).toEqual(["copied"]);
    });

    test("a chapter", async ({ page }) => {
      const { author, id } = await fixture();
      const path = `/a/${author}/n/crossing/landing`;
      await page.goto(path);
      const link = page.getByRole("button", { name: "Report this chapter" });
      await link.click();
      const dialog = page.getByRole("dialog", { name: "Report this chapter" });
      await fillAndSend(dialog, "Sexual or violent content", "Chapter one.");
      await expectThanksThenClose(page, dialog, link);
      await expect.poll(() => reportEmailsFor(path)).toEqual([
        {
          targetKind: "chapter",
          title: `Crossing ${id}, Landing`,
          path,
          reason: "sexual-violent",
          details: "Chapter one.",
          earlier: 0,
          hasReplyTo: false,
        },
      ]);
    });
  });
}
