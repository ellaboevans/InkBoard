import { expect, test, type Page } from "@playwright/test";
import { chooseOption, signUpAs, sql } from "./helpers";

/*
 * Scheduled chapters (docs/PLAN.md, Phase 28), on a phone: the writer picks a
 * day (the calendar, in a Popover) and a time (the shadcn Select, 15-minute
 * steps) in their own time zone; readers see nothing until then; when the time
 * comes the chapter is simply there. The browser here is in New York, so the
 * test also checks that the stored instant is the writer's local 18:00.
 *
 * "Its time passes" is set through the database: right after scheduling (whose
 * updateTag dropped every older cache entry) its time is brought to 90 seconds
 * from now, before any reader page is loaded, as real time would bring it. The
 * reader pages then cache only until the release (release-cache.ts) and show
 * the chapter by themselves, with nothing run and no cache cleared.
 */

test.use({ viewport: { width: 375, height: 812 }, timezoneId: "America/New_York" });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();

/** A writer with a novel: chapter 1 published, chapter 2 a draft with text. Returns the editor's paths. */
async function writer(page: Page) {
  const id = unique();
  const email = `scheduler-${id}@example.com`;
  await signUpAs(page, email, `Scheduler ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const { rows: made } = await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', 'The Ferry at Yeji', 'ferry') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT id, t.title, t.slug, t.body, t.pos, t.status::poem_status, CASE WHEN t.status = 'published' THEN now() END, 6,
           CASE WHEN t.status = 'published' THEN now() END FROM n,
      (VALUES ('Thursday', 'thursday', 'The ferry came late.', 1, 'published'),
              ('The Landing', 'the-landing', 'SCHEDULED TEXT: Akua waited at the landing.', 2, 'draft')) AS t(title, slug, body, pos, status)
    RETURNING id, novel_id, slug`);
  const landing = made.find((r) => r.slug === "the-landing")!;
  return {
    author: rows[0].slug as string,
    landingId: landing.id as string,
    novelAdmin: `/admin/novels/${landing.novel_id}`,
    editorUrl: `/admin/novels/${landing.novel_id}/chapters/${landing.id}`,
  };
}

/** Pick a day (two days ahead) and a time in the schedule dialog, then press its button. */
async function schedule(page: Page, time: string, button: "Schedule" | "Reschedule", daysAhead = 2) {
  const dialog = page.getByRole("dialog", { name: button === "Schedule" ? "Schedule this chapter" : "Reschedule this chapter" });
  await expect(dialog).toBeVisible();
  const day = new Date(Date.now() + daysAhead * 86_400_000);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  await dialog.getByRole("button", { name: "Day" }).click(); // the Day field's trigger (named by its label)
  const cell = page.locator(`[data-day="${key}"] button`).first();
  if (!(await cell.isVisible())) await page.getByRole("button", { name: /next month/i }).click();
  await cell.click();
  await chooseOption(dialog.getByRole("combobox", { name: "Time" }), time);
  await expect(dialog).toContainText("Goes live");
  await dialog.getByRole("button", { name: button, exact: true }).click();
  return key;
}

test("a writer schedules a chapter; readers see nothing of it until its time, then all of it", async ({ page, browser }) => {
  test.slow();
  const w = await writer(page);
  await page.goto(w.editorUrl);
  await expect(page.getByRole("heading", { name: /Chapter 2/ }).or(page.getByRole("textbox", { name: /Chapter title/ })).first()).toBeVisible();

  await page.getByRole("button", { name: "Schedule…" }).click();
  const day = await schedule(page, "18:00", "Schedule");
  await expect(toast(page, "Chapter scheduled")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("dialog")).toBeHidden();
  // Shown back in the writer's own zone, and stored as that instant (18:00 in New York).
  await expect(page.locator("[data-schedule-status]")).toContainText(/Scheduled for \w{3} \d{1,2} \w{3}, 18:00/);
  const { rows } = await sql(`SELECT to_char(release_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI') AS local, status FROM chapters WHERE id = '${w.landingId}'`);
  expect(rows[0]).toEqual({ local: `${day} 18:00`, status: "published" });
  await expect(page.getByRole("button", { name: "Publish now" })).toBeVisible();
  // Its time is now 90 seconds away (set in the database, before any reader looks).
  await sql(`UPDATE chapters SET release_at = now() + interval '90 seconds', published_at = now() + interval '90 seconds' WHERE id = '${w.landingId}'`);

  // The chapter list shows it as scheduled, with its time.
  await page.goto(w.novelAdmin);
  await expect(page.getByRole("main")).toContainText("2 chapters · 1 published · 1 scheduled");
  await expect(page.locator("[data-scheduled-time]")).toContainText(/for \w{3} \d{1,2} \w{3}, \d{2}:\d{2}/);

  // Readers: nothing, exactly like a draft.
  const reader = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  const novelPage = `/a/${w.author}/n/ferry`;
  const chapterPage = `${novelPage}/the-landing`;
  expect((await reader.goto(chapterPage))!.status()).toBe(404);
  await reader.goto(novelPage);
  await expect(reader.getByRole("main")).toContainText("Thursday");
  await expect(reader.getByRole("main")).not.toContainText("The Landing");
  await expect(reader.getByRole("main")).toContainText("1 chapter");
  expect(await (await reader.request.get(`${novelPage}/feed.xml`)).text()).not.toContain("The Landing");

  // Its time comes. The pages loaded above cache until then, and no longer.
  await expect(async () => {
    await reader.goto(novelPage);
    await expect(reader.getByRole("main")).toContainText("The Landing", { timeout: 1_000 });
  }).toPass({ timeout: 240_000, intervals: [5_000] });
  await expect(reader.getByRole("main")).toContainText("2 chapters");
  expect((await reader.goto(chapterPage))!.status()).toBe(200);
  await expect(reader.getByRole("heading", { level: 1, name: "The Landing" })).toBeVisible();
  await expect(reader.getByRole("main")).toContainText("SCHEDULED TEXT");
  await expect(reader.getByRole("main")).toContainText("Chapter 2 of 2");
  await reader.context().close();

  // And for the writer it is simply published now.
  await page.goto(w.editorUrl);
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
});

test("reschedule and cancel: the time changes, then the chapter is a draft again and readers still see nothing", async ({ page, browser }) => {
  test.slow();
  const w = await writer(page);
  await page.goto(w.editorUrl);
  await page.getByRole("button", { name: "Schedule…" }).click();
  await schedule(page, "09:30", "Schedule");
  await expect(toast(page, "Chapter scheduled")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-schedule-status]")).toContainText(", 09:30");

  // An edit keeps the schedule.
  await page.getByRole("textbox", { name: /Chapter title/ }).fill("At the Landing");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, "Chapter saved")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-schedule-status]")).toContainText(", 09:30");

  await page.getByRole("button", { name: "Reschedule…" }).click();
  const day = await schedule(page, "20:15", "Reschedule", 3);
  await expect(toast(page, "Schedule changed")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-schedule-status]")).toContainText(", 20:15");
  const { rows } = await sql(`SELECT to_char(release_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI') AS local FROM chapters WHERE id = '${w.landingId}'`);
  expect(rows[0].local).toBe(`${day} 20:15`);

  await page.getByRole("button", { name: "Cancel schedule" }).click();
  await expect(toast(page, "Schedule cancelled")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Publish chapter" })).toBeVisible();
  await expect(page.locator("[data-schedule-status]")).toHaveCount(0);
  const { rows: after } = await sql(`SELECT status, release_at, published_at, slug FROM chapters WHERE id = '${w.landingId}'`);
  // Never out: back to a draft whose slug follows its title.
  expect(after[0]).toEqual({ status: "draft", release_at: null, published_at: null, slug: "at-the-landing" });

  const reader = await (await browser.newContext()).newPage();
  expect((await reader.goto(`/a/${w.author}/n/ferry/at-the-landing`))!.status()).toBe(404);
  await reader.goto(`/a/${w.author}/n/ferry`);
  await expect(reader.getByRole("main")).not.toContainText("At the Landing");
  await reader.context().close();
});
