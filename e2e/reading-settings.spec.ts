import { expect, test, type Page } from "@playwright/test";
import { sql } from "./helpers";

/*
 * Reader settings on chapter pages (docs/PLAN.md, Phase 26), on a phone:
 * "Text settings" in the sticky bar changes the chapter text's size and
 * font at once, and only the text; the choice is kept in this browser
 * (reload, another chapter) and applied before the first paint; at 320 px
 * the largest size doesn't scroll sideways.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const LONG_WORD = "Ŋkekeɖekaɖekagbeɖeɖefiamɔnukpɔkpɔwɔwɔɖeɖenyuieŋutɔ";
const BODY = `^^Akua waited at the landing while the ferry came in slowly over the lake.\n\nƐyɛ adeɛ a ɛyɛ nwonwa: ɔbɛba ɛnnɛ anaa ɔkyena? Mɛ́tɔ̀ ɖé ɖevi.\n\n${LONG_WORD} is a word too long for a phone.`;

/** An author, a public novel and two published chapters, straight in the database (new slugs: nothing cached). */
async function novel() {
  const id = unique();
  const { rows } = await sql(
    `INSERT INTO editors (email, pen_name, slug) VALUES ('reading-${id}@example.com', 'Setting Reader ${id}', 'setting-reader-${id}') RETURNING id, slug`,
  );
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, language) VALUES ('${rows[0].id}', 'The Ferry', 'ferry', 'ak') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count)
    SELECT n.id, c.title, c.slug, c.body, c.position, 'published', now(), 20 FROM n,
      (VALUES ('Thursday', 'thursday', $$${BODY}$$, 1), ('The Landing', 'the-landing', 'The radio stayed on the table all night.', 2)) AS c(title, slug, body, position)`);
  return `/a/${rows[0].slug}/n/ferry`;
}

const textStyle = (page: Page) =>
  page
    .locator("[data-chapter-text]")
    .evaluate((el) => ({ size: `${Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10}px`, family: getComputedStyle(el).fontFamily }));
const px = (n: number) => `${Math.round(n * 10 + 1e-6) / 10}px`;
const uiStyle = (page: Page) =>
  page.evaluate(() => {
    const px = (sel: string) => getComputedStyle(document.querySelector(sel)!).fontSize;
    return { title: px("main h1"), bar: px("[data-chapter-of]"), links: px('nav[aria-label="Chapters"] a[rel="next"]') };
  });

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Text settings" }).click();
  const panel = page.getByRole("dialog", { name: "Text settings" });
  // Measure after the zoom-in animation.
  await expect.poll(() => panel.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  return panel;
}

test("text size and font change the chapter text only, at once, and stay for this browser", async ({ page }) => {
  test.slow();
  const hydrationErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|script tag/i.test(m.text())) hydrationErrors.push(m.text());
  });
  const base = await novel();
  await page.goto(`${base}/thursday`);
  await expect(page.locator("[data-chapter-text]")).toBeVisible();

  const before = await textStyle(page);
  expect(before.size).toBe("19px");
  expect(before.family).toMatch(/Newsreader/i);
  const ui = await uiStyle(page);

  const panel = await openSettings(page);
  const size = panel.getByRole("group", { name: "Text size" });
  await expect(size.getByRole("radio", { name: "Default" })).toBeChecked();
  await expect(panel.getByRole("group", { name: "Font" }).getByRole("radio", { name: "Book serif" })).toBeChecked();
  // 44 px targets.
  for (const label of await panel.locator("label").all()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await size.getByText("Largest", { exact: true }).click();
  await expect.poll(async () => (await textStyle(page)).size).toBe(px(19 * 1.3));
  await panel.getByText("Sans", { exact: true }).click();
  await expect.poll(async () => (await textStyle(page)).family).toMatch(/Geist/i);
  // The Ghanaian-letter font (Andika, next/font's `sansExt`) still comes straight after the main one.
  expect((await textStyle(page)).family).toMatch(/Geist[^,]*,\s*["']?sansExt/);
  // Keyboard: arrows move within the group and choose.
  await size.getByRole("radio", { name: "Largest" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(size.getByRole("radio", { name: "Larger" })).toBeChecked();
  await expect.poll(async () => (await textStyle(page)).size).toBe(px(19 * 1.15));
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await textStyle(page)).size).toBe(px(19 * 1.3));
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Only the text: title, bar and links keep their size.
  expect(await uiStyle(page)).toEqual(ui);

  // Reload: applied before the first paint (the inline script ran before the text was parsed).
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const el = document.querySelector("[data-chapter-text]");
      (window as unknown as { __firstSize?: string }).__firstSize = el ? `${Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10}px` : "none";
    });
  });
  await page.reload();
  await expect(page.locator("[data-chapter-text]")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __firstSize?: string }).__firstSize)).toBe(px(19 * 1.3));
  expect((await textStyle(page)).family).toMatch(/Geist/i);

  // Another chapter keeps it; the control shows the saved choice.
  await page.getByRole("link", { name: /Next chapter/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Landing" })).toBeVisible();
  expect(await textStyle(page)).toMatchObject({ size: px(19 * 1.3) });
  const again = await openSettings(page);
  await expect(again.getByRole("radio", { name: "Largest" })).toBeChecked();
  await expect(again.getByRole("radio", { name: "Sans" })).toBeChecked();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("inkboard-reading-text")))!)).toEqual({ v: 1, size: "largest", font: "sans" });

  // Back to the default: today's size and font exactly.
  await again.getByText("Default", { exact: true }).click();
  await again.getByText("Book serif", { exact: true }).click();
  await expect.poll(async () => (await textStyle(page)).size).toBe("19px");
  expect((await textStyle(page)).family).toMatch(/Newsreader/i);

  expect(hydrationErrors).toEqual([]);
});

test("no sideways scrolling at 320 px at the largest size, with a drop cap and a long word", async ({ page }) => {
  const base = await novel();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("inkboard-reading-text")) localStorage.setItem("inkboard-reading-text", JSON.stringify({ v: 1, size: "largest", font: "serif" }));
  });
  await page.goto(`${base}/thursday`);
  const text = page.locator("[data-chapter-text]");
  await expect(text).toBeVisible();
  expect((await textStyle(page)).size).toBe(px(18 * 1.3));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // The text stays inside the article's padding.
  const box = (await text.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  // A malformed value is the default, not an error.
  await page.evaluate(() => localStorage.setItem("inkboard-reading-text", "{oops"));
  await page.reload();
  await expect(text).toBeVisible();
  expect((await textStyle(page)).size).toBe("18px");
});
