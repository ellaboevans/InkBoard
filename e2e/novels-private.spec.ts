import { expect, test, type Browser, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

/*
 * Private novels (docs/PLAN.md, Phase 25), on a phone-sized viewport: the
 * writer makes a novel private with a password in its details; a reader sees
 * the cover, blurb and chapter list, and chapter 1 asks for the password; a
 * wrong password fails, the right one opens it, and chapter 2 opens without
 * asking again; changing the password locks it again. No chapter text in the
 * locked page's HTML, never saved offline, no sideways scrolling at 320 px.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();
const passwordField = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });

const ONE = "SECRET-ONE The ferry came late.";
const TWO = "SECRET-TWO Kwabena did not come back.";

async function noSidewaysScroll(page: Page, where: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), where).toBeLessThanOrEqual(0);
}

async function addChapter(page: Page, novelAdminUrl: string, title: string, body: string) {
  await page.goto(novelAdminUrl);
  await page.getByRole("button", { name: "New chapter" }).click();
  await expect(page).toHaveURL(/\/chapters\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await page.getByRole("textbox", { name: /Chapter title/ }).fill(title);
  await page.getByRole("textbox", { name: "Text" }).fill(body);
  await page.getByRole("button", { name: "Publish chapter" }).click();
  await expect(toast(page, "Chapter published")).toBeVisible({ timeout: 45_000 });
}

/** The writer's details form: private with this password (the label says "New password" once one is set). */
async function setPassword(page: Page, novelAdminUrl: string, password: string, label: "Password" | "New password") {
  await page.goto(novelAdminUrl);
  const toggle = page.getByRole("switch", { name: "Password protected" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await passwordField(page, label).fill(password);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(toast(page, "Details saved")).toBeVisible({ timeout: 45_000 });
  await expect(passwordField(page, "New password")).toHaveValue("");
}

async function readerPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  return context.newPage();
}

test("a private novel: blurb and chapters for everyone, one password for every chapter, a new password locks it again", async ({ page, browser }) => {
  test.slow();
  const id = unique();
  const email = `private-novelist-${id}@example.com`;
  await signUpAs(page, email, `Private Novelist ${id}`);
  const { rows } = await sql(`SELECT slug FROM editors WHERE email = '${email}'`);
  const author = rows[0].slug as string;

  await page.goto("/admin/novels");
  await page.getByRole("button", { name: "New novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New novel" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("The Locked Ferry");
  await dialog.getByRole("textbox", { name: /Blurb/ }).fill("Every Thursday the ferry crosses the lake.");
  await dialog.getByRole("button", { name: "Create novel" }).click();
  await expect(page).toHaveURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const novelAdminUrl = new URL(page.url()).pathname;
  await addChapter(page, novelAdminUrl, "Thursday", ONE);
  await addChapter(page, novelAdminUrl, "The Landing", TWO);

  // The writer: private needs a password (checked before sending), then saves it.
  await page.goto(novelAdminUrl);
  await page.getByRole("switch", { name: "Password protected" }).click();
  await expect(page.getByText("Readers see the cover, title, blurb and chapter list. One password opens every chapter.")).toBeVisible();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("main").getByText("Private novels need a password readers can use")).toBeVisible();
  await setPassword(page, novelAdminUrl, "ferry-pass-1", "Password");
  await expect(page.getByRole("main").getByText(/Password protected: readers see its cover/)).toBeVisible();
  await noSidewaysScroll(page, "writer's details, private");

  // A reader, in their own browser.
  const reader = await readerPage(browser);
  const novelUrl = `/a/${author}/n/the-locked-ferry`;

  // The author page's book card says so.
  await reader.goto(`/a/${author}`);
  await expect(reader.getByRole("link", { name: "The Locked Ferry (novel, password protected)" })).toBeVisible();

  await reader.goto(novelUrl);
  await expect(reader.getByRole("heading", { level: 1, name: "The Locked Ferry" })).toBeVisible();
  await expect(reader.getByText("Every Thursday the ferry crosses the lake.")).toBeVisible();
  await expect(reader.locator("[data-novel-private]")).toContainText("Password protected.");
  const list = reader.getByRole("region", { name: "Chapters" });
  await expect(list.getByRole("link", { name: /Thursday/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /The Landing/ })).toBeVisible();
  await expect(reader.getByRole("button", { name: "Save this novel for offline" })).toHaveCount(0);
  await noSidewaysScroll(reader, "novel page, 375");

  // Chapter 1 is locked: the form, no text anywhere in what was sent, never saved offline.
  const response = await reader.goto(`${novelUrl}/thursday`);
  await expect(reader.getByRole("heading", { level: 1, name: "Thursday" })).toBeVisible();
  await expect(reader.getByText("This novel is password protected")).toBeVisible();
  await expect(reader.getByRole("navigation", { name: "Novel" })).toContainText("Chapter 1 of 2");
  expect(await response!.text()).not.toContain("SECRET-");
  expect(await reader.content()).not.toContain("SECRET-");
  await expect(reader.locator('meta[name="inkboard-offline"]')).toHaveAttribute("content", "never");
  // The unlock form is English UI.
  await expect(reader.locator("[data-chapter-locked] [lang]")).toHaveCount(0);

  await reader.setViewportSize({ width: 320, height: 700 });
  await noSidewaysScroll(reader, "locked chapter, 320");
  await reader.goto(novelUrl);
  await noSidewaysScroll(reader, "novel page, 320");
  await reader.goto(`${novelUrl}/thursday`);
  await reader.setViewportSize({ width: 375, height: 812 });

  // A wrong password fails…
  await passwordField(reader, "Password").fill("not-the-password");
  await reader.getByRole("button", { name: "Unlock novel" }).click();
  await expect(reader.getByRole("alert").filter({ hasText: "That password isn't right." })).toBeVisible({ timeout: 45_000 });
  await expect(reader.locator("[data-chapter-text]")).toHaveCount(0);

  // …the right one opens it…
  await passwordField(reader, "Password").fill("ferry-pass-1");
  await reader.getByRole("button", { name: "Unlock novel" }).click();
  await expect(toast(reader, "Novel unlocked")).toBeVisible({ timeout: 45_000 });
  await expect(reader.locator("[data-chapter-text]")).toContainText(ONE);
  await expect(reader.getByText("Unlocked on this device")).toBeVisible();
  // Unlocked, still never saved offline.
  await expect(reader.locator('meta[name="inkboard-offline"]')).toHaveAttribute("content", "never");

  // …and chapter 2 opens without asking again.
  await reader.getByRole("link", { name: /Next chapter/ }).click();
  await expect(reader).toHaveURL(new RegExp(`${novelUrl}/the-landing$`));
  await expect(reader.locator("[data-chapter-text]")).toContainText(TWO);
  await expect(reader.getByRole("button", { name: "Unlock novel" })).toHaveCount(0);

  // A new password locks it again, for every chapter.
  await setPassword(page, novelAdminUrl, "ferry-pass-2", "New password");
  await reader.reload();
  await expect(reader.getByRole("button", { name: "Unlock novel" })).toBeVisible();
  await expect(reader.locator("[data-chapter-text]")).toHaveCount(0);
  await passwordField(reader, "Password").fill("ferry-pass-1");
  await reader.getByRole("button", { name: "Unlock novel" }).click();
  await expect(reader.getByRole("alert").filter({ hasText: "That password isn't right." })).toBeVisible({ timeout: 45_000 });
  await passwordField(reader, "Password").fill("ferry-pass-2");
  await reader.getByRole("button", { name: "Unlock novel" }).click();
  await expect(reader.locator("[data-chapter-text]")).toContainText(TWO, { timeout: 45_000 });
  await reader.goto(`${novelUrl}/thursday`);
  await expect(reader.locator("[data-chapter-text]")).toContainText(ONE);

  // The feed has the chapters' titles, never their text.
  const feed = await reader.request.get(`${novelUrl}/feed.xml`);
  const xml = await feed.text();
  expect(xml).toContain("The Locked Ferry: Chapter 2 · The Landing");
  expect(xml).toContain("This novel is password protected.");
  expect(xml).not.toContain("SECRET-");
  await reader.context().close();
});
