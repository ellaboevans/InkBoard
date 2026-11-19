import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import {
  createRecoveryCodes,
  latestCode,
  latestStepUpCode,
  recoverySignIn,
  renderedToastTitle,
  requestCode,
  signUpAs,
  sql,
  toastContrast,
  expectBackOnList,
  virtualAuthenticator,
  chooseOption,
} from "./helpers";
import { fakePush, type FakePush } from "./push-stub";

/*
 * Automated accessibility checks (N7) with axe-core, against WCAG 2.2 A/AA.
 * Each test walks a flow and scans every screen it reaches (the app is
 * light-only). Scans use
 * expect.soft so one run reports every screen, not just the first failure.
 * Automated checks find roughly a third of issues; they complement, not
 * replace, manual keyboard and screen-reader passes.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function scan(page: Page, screen: string, include?: string) {
  // Measure final colours, not a menu or drawer mid-animation (ignores looping
  // spinners, and scroll-driven ones like a chapter's progress bar, which
  // "run" for as long as the page is open: their time is the scroll position).
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity || a.timeline !== document.timeline,
      ),
  );
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary })),
  }));
  expect.soft(summary, screen).toEqual([]);
}

async function publish(page: Page, title: string, body: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
}

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

test("sign-in and onboarding", async ({ page }) => {
  const email = `a11y-in-${unique()}@example.com`;
  await page.goto("/sign-in");
  await scan(page, "sign-in: email step");
  await requestCode(page, email);
  await scan(page, "sign-in: code step");
  await page.locator('input[name="code"]').fill("000000");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await scan(page, "sign-in: wrong code");
  await page.locator('input[name="code"]').fill(await latestCode(email));
  await expect(page).toHaveURL(/\/admin\/onboarding$/, { timeout: 45_000 });
  await scan(page, "onboarding");
});

test("recovery codes: sign-in, dashboard notices and the profile section", async ({ page }) => {
  // Sign-in side: the box ticked, the recovery form, and its generic error.
  await page.goto("/sign-in");
  await page.getByRole("checkbox", { name: "This isn't my device" }).check();
  await scan(page, "sign-in: this isn't my device ticked");
  await page.goto("/sign-in/recovery");
  await scan(page, "recovery sign-in");
  await recoverySignIn(page, `a11y-nobody-${unique()}@example.com`, "ABCD-EFGH-JKMN", { publicDevice: true });
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await scan(page, "recovery sign-in: wrong code");

  const id = unique();
  const email = `a11y-rec-${id}@example.com`;
  await signUpAs(page, email, `Recovery Poet ${id}`);
  // The standalone prompt shows once the welcome checklist (which replaces it) is hidden (Phase 20).
  await page.getByRole("region", { name: "Getting started" }).getByRole("button", { name: "Hide checklist" }).click();
  await expect(page.getByRole("region", { name: /^Set up recovery codes/ })).toBeVisible();
  await scan(page, "dashboard: recovery setup prompt");

  await page.goto("/admin/profile");
  await expect(page.getByRole("button", { name: "Create recovery codes" })).toBeVisible();
  await scan(page, "profile: recovery codes not set up");
  await createRecoveryCodes(page);
  await scan(page, "profile: new recovery codes");
  await page.getByRole("button", { name: "I've saved my codes" }).click();

  // An older sign-in: replacing asks first, then needs a confirmation code.
  await sql(
    `UPDATE sessions SET email_verified_at = now() - interval '11 minutes'
     WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`,
  );
  await page.reload();
  await page.getByRole("button", { name: "Make a new set" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "profile: replace recovery codes dialog");
  await page.getByRole("button", { name: "Replace my codes" }).click();
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await scan(page, "profile: confirm it's you");
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = await latestStepUpCode(email);
  await scan(page, "profile: confirmation code sent");
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(code === "000000" ? "111111" : "000000");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await scan(page, "profile: wrong confirmation code");
  await page.getByRole("button", { name: "Cancel" }).click();

  // Running low.
  await sql(`UPDATE recovery_codes SET used_at = now() WHERE id IN (
    SELECT r.id FROM recovery_codes r JOIN editors e ON e.id = r.editor_id WHERE e.email = '${email}' LIMIT 9)`);
  await page.goto("/admin");
  await expect(page.getByRole("region", { name: "Only 1 recovery code left" })).toBeVisible();
  await scan(page, "dashboard: recovery codes running low");
  await page.setViewportSize({ width: 375, height: 812 });
  await scan(page, "dashboard: recovery codes running low (phone)");
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("passkeys: sign-in, the profile section, its dialogs and the dashboard offer", async ({ page, browser }) => {
  await virtualAuthenticator(page);
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
  await scan(page, "sign-in: with the passkey button");

  const id = unique();
  const email = `a11y-pk-${id}@example.com`;
  await signUpAs(page, email, `Passkey Poet ${id}`);
  await page.goto("/admin/profile#passkeys");
  await expect(page.getByRole("button", { name: "Add a passkey" })).toBeVisible();
  await scan(page, "profile: no passkeys");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("list", { name: "Your passkeys" })).toBeVisible({ timeout: 45_000 });
  await scan(page, "profile: a passkey");
  await page.getByRole("button", { name: /^Rename / }).click();
  await expect(page.getByRole("dialog", { name: "Rename passkey" })).toBeVisible();
  await scan(page, "profile: rename passkey dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Remove / }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "profile: remove passkey dialog");
  await page.keyboard.press("Escape");

  // An older sign-in: the step-up card, now with "Use a passkey".
  await sql(`UPDATE sessions SET email_verified_at = now() - interval '11 minutes', passkey_verified_at = NULL
    WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await page.reload();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("button", { name: "Use a passkey" })).toBeVisible();
  await scan(page, "profile: confirm it's you, with a passkey option");

  // After a recovery-code sign-in: the dashboard's offer; on a public device, the explanation.
  await sql(`UPDATE sessions SET email_verified_at = now() WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await page.goto("/admin/profile");
  await createRecoveryCodes(page);
  const codes = (await page.getByRole("list", { name: "Recovery codes" }).innerText()).match(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/g)!;
  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  await virtualAuthenticator(laptop);
  await recoverySignIn(laptop, email, codes[0]);
  await expect(laptop.getByRole("region", { name: "Add a passkey on this computer?" })).toBeVisible({ timeout: 45_000 });
  await scan(laptop, "dashboard: add-a-passkey offer");
  await laptop.setViewportSize({ width: 375, height: 812 });
  await scan(laptop, "dashboard: add-a-passkey offer (phone)");
  await laptopContext.close();
  const libraryContext = await browser.newContext();
  const library = await libraryContext.newPage();
  await recoverySignIn(library, email, codes[1], { publicDevice: true });
  await expect(library).toHaveURL(/\/admin/, { timeout: 45_000 });
  await library.goto("/admin/profile#passkeys");
  await expect(library.getByRole("main")).toContainText("so a passkey can't be added here");
  await scan(library, "profile: passkeys on a public device");
  await libraryContext.close();
});

test("settings: download your poems and delete the account", async ({ page }) => {
  const id = unique();
  const email = `a11y-leave-${id}@example.com`;
  const pen = `Leaving Poet ${id}`;
  await signUpAs(page, email, pen);
  await page.goto("/admin/settings");
  await expect(page.getByRole("region", { name: "Download your poems" })).toBeVisible();
  await scan(page, "settings: password mode, download and delete");
  await page.setViewportSize({ width: 375, height: 812 });
  await scan(page, "settings: phone");
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
  await expect(dialog).toBeVisible();
  await scan(page, "settings: delete confirmation");
  await dialog.getByRole("textbox", { name: /Type your pen name/ }).fill(pen);
  await scan(page, "settings: delete confirmation, name typed");
  await page.keyboard.press("Escape");

  await sql(`UPDATE sessions SET email_verified_at = now() - interval '11 minutes'
    WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await page.reload();
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await scan(page, "settings: confirm it's you before deleting");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(await latestStepUpCode(email));
  await dialog.getByRole("textbox", { name: /Type your pen name/ }).fill(pen);
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Your account was deleted")).toBeVisible({ timeout: 45_000 });
  await scan(page, "board: after deleting an account");
});

test("sign-in link page", async ({ page }) => {
  await page.goto("/sign-in/link#" + "Q".repeat(44));
  await scan(page, "sign-in link: continue");
  await page.getByRole("button", { name: "Continue to InkBoard" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await scan(page, "sign-in link: expired");
});

test("novels in the dashboard: the list, a novel's page, the chapter editor (write, preview, History, device draft), phone and desktop", async ({ page }) => {
  test.slow();
  await signUpAs(page, `a11y-novels-${unique()}@example.com`, `Novel A11y ${unique()}`);
  await page.goto("/admin/novels");
  await expect(page.getByRole("heading", { level: 1, name: "Novels" })).toBeVisible();
  await scan(page, "novels: empty list");
  await page.getByRole("button", { name: "New novel" }).click();
  await expect(page.getByRole("dialog", { name: "New novel" })).toBeVisible();
  await scan(page, "novels: new novel dialog");
  // A Select's list open inside the dialog (it portals); Esc closes only the list.
  await page.getByRole("dialog").getByRole("combobox", { name: "Language" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await scan(page, "novels: new novel dialog, Language list open");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.getByRole("dialog", { name: "New novel" })).toBeVisible();
  await page.getByRole("dialog").getByRole("textbox", { name: "Title" }).fill("Asuo ne Ɔdɔ");
  await page.getByRole("dialog").getByRole("button", { name: "Create novel" }).click();
  await expect(page).toHaveURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const novelUrl = new URL(page.url()).pathname;
  await scan(page, "novel page: no chapters");

  for (const title of ["Thursday", ""]) {
    await page.goto(novelUrl);
    await page.getByRole("button", { name: "New chapter" }).click();
    await expect(page).toHaveURL(/\/chapters\//, { timeout: 45_000 });
    await page.getByRole("textbox", { name: /Chapter title/ }).fill(title);
    await page.getByRole("textbox", { name: "Text" }).fill("The ferry came late.\n\n* * *\n\n*Asuo yi*, she sang.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator("[data-sileo-toast]").getByText("Draft saved").first()).toBeVisible({ timeout: 45_000 });
  }
  const chapterUrl = new URL(page.url()).pathname;

  for (const size of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await page.goto("/admin/novels");
    await expect(page.locator("[data-novel-link]")).toHaveCount(1);
    await scan(page, `novels: list ${size.width}px`);
    await page.goto(novelUrl);
    await expect(page.locator("[data-chapter-link]")).toHaveCount(2);
    await scan(page, `novel page: chapters ${size.width}px`);
    await page.goto(chapterUrl);
    await expect(page.getByRole("textbox", { name: "Text" })).toBeVisible();
    await scan(page, `chapter editor: write ${size.width}px`);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByRole("article", { name: /Preview of/ })).toBeVisible();
    await scan(page, `chapter editor: preview ${size.width}px`);
  }

  // History's version dialog, and the device-draft offer.
  await page.getByRole("tab", { name: "Write" }).click();
  await page.getByRole("region", { name: "History" }).getByRole("link").last().click();
  await expect(page.getByRole("dialog", { name: /version, saved/ })).toBeVisible();
  await scan(page, "chapter editor: a saved version");
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("textbox", { name: "Text" }).fill("Typed, not saved.");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("inkboard-chapter-draft:")))).toBe(true);
  await page.reload();
  await expect(page.locator("[data-device-draft]")).toBeVisible();
  await scan(page, "chapter editor: a newer draft on this device");
  await page.getByRole("button", { name: "Delete chapter" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "chapter editor: delete chapter dialog");
});

test("novels for readers: the book card, author page, novel page (start and continue) and chapter page, phone and desktop", async ({ page }) => {
  const id = unique();
  const email = `a11y-reader-novel-${id}@example.com`;
  await signUpAs(page, email, `Reading Novelist ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const author = rows[0].slug as string;
  // Two published chapters (one untitled) and a draft, written straight to the database…
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, blurb, language)
      VALUES ('${rows[0].id}', 'Ɔdɔ ne Ɛkɔm', 'odo', 'A long blurb.
With a second paragraph.', 'ak') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT id, t.title, t.slug, t.body, t.pos, t.status::poem_status, CASE WHEN t.status = 'published' THEN now() END, 40, CASE WHEN t.status = 'published' THEN now() END FROM n,
      (VALUES ('Thursday', 'thursday', E'^^The ferry came *late*.\n\n* * *\n\n^^“Akua waited.”\nA kept line.', 1, 'published'),
              ('', 'chapter', 'Second chapter text.', 2, 'published'),
              ('Draft', 'draft', 'Draft text.', 3, 'draft')) AS t(title, slug, body, pos, status)`);
  // …then a poem through the app, which refreshes the board's cache.
  await publish(page, `Beside the novel ${id}`, "a line");

  await openBoard(page);
  await expect(page.getByRole("link", { name: "Ɔdɔ ne Ɛkɔm (novel)" })).toBeAttached();
  await scan(page, "board: a section with a book card");
  await page.goto(`/a/${author}`);
  await expect(page.getByRole("region", { name: "Novels" })).toBeVisible();
  await scan(page, "author page: with a novel");
  const novelUrl = `/a/${author}/n/odo`;
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    // A fresh start each time: no saved place in this browser.
    await page.evaluate(() => localStorage.removeItem("inkboard-reading"));
    await page.goto(novelUrl);
    await expect(page.getByRole("link", { name: "Start reading" })).toBeVisible();
    await scan(page, `novel page: start reading, ${width}px`);
    await page.goto(`${novelUrl}/thursday`);
    await expect(page.getByRole("navigation", { name: "Novel" })).toContainText("Chapter 1 of 2");
    await scan(page, `chapter page: first chapter, ${width}px`);
    await page.goto(`${novelUrl}/chapter`);
    await expect(page.getByRole("heading", { level: 1, name: "Chapter 2" })).toBeVisible();
    await scan(page, `chapter page: last chapter, untitled, ${width}px`);
    await page.goto(novelUrl);
    await expect(page.getByRole("link", { name: "Continue: Chapter 2" })).toBeVisible();
    await scan(page, `novel page: continue, ${width}px`);
  }
  // "Save this novel for offline" under next dev (no worker): it says so plainly.
  await page.goto(novelUrl);
  await page.getByRole("button", { name: "Save this novel for offline" }).click();
  await expect(page.locator("#save-novel-status")).toContainText("Offline saving isn’t available in this browser right now");
  await scan(page, "novel page: save for offline, unavailable");
  await page.goto(`${novelUrl}/draft`);
  await expect(page.getByRole("heading", { level: 1, name: "Chapter not found" })).toBeVisible();
  await scan(page, "chapter not found");
});

test("private novels: the writer's details form, the novel page and a locked chapter (wrong password, unlocked), phone and desktop", async ({ page, browser }) => {
  const id = unique();
  const email = `a11y-private-novel-${id}@example.com`;
  await signUpAs(page, email, `Private Novelist ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const author = rows[0].slug as string;
  // Two published chapters, written straight to the database; the details form then makes it private (and refreshes the cache).
  const { rows: made } = await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, blurb, language)
      VALUES ('${rows[0].id}', 'Ɔdɔ a Ɛyɛ Kumaa', 'locked', 'A public blurb.', 'ak') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT id, t.title, t.slug, t.body, t.pos, 'published'::poem_status, now(), 40, now() FROM n,
      (VALUES ('Thursday', 'thursday', E'The ferry came *late*.', 1), ('', 'chapter', 'Second chapter text.', 2)) AS t(title, slug, body, pos)
    RETURNING novel_id`);
  const adminUrl = `/admin/novels/${made[0].novel_id}`;
  await page.goto(adminUrl);
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("main").getByText("Private novels need a password readers can use")).toBeVisible();
  await scan(page, "writer's details: private, missing password");
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("a11y-novel-pass");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByLabel("New password", { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 45_000 });
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await scan(page, `writer's details: private with a password, ${width}px`);
  }

  const context = await browser.newContext();
  const reader = await context.newPage();
  const novelUrl = `/a/${author}/n/locked`;
  for (const width of [375, 1280]) {
    await reader.setViewportSize({ width, height: 800 });
    await reader.goto(novelUrl);
    await expect(reader.locator("[data-novel-private]")).toBeVisible();
    await scan(reader, `novel page: private, ${width}px`);
    await reader.goto(`${novelUrl}/thursday`);
    await expect(reader.getByRole("button", { name: "Unlock novel" })).toBeVisible();
    await scan(reader, `chapter page: locked, ${width}px`);
  }
  await reader.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("wrong-password");
  await reader.getByRole("button", { name: "Unlock novel" }).click();
  await expect(reader.getByRole("alert").filter({ hasText: "That password isn't right." })).toBeVisible({ timeout: 45_000 });
  await scan(reader, "chapter page: locked, wrong password");
  await reader.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("a11y-novel-pass");
  await reader.getByRole("button", { name: "Unlock novel" }).click();
  await expect(reader.locator("[data-chapter-text]")).toBeVisible({ timeout: 45_000 });
  await scan(reader, "chapter page: unlocked");
  await context.close();
});

test("novel covers: the details' cover panel, the 2:3 crop step and a saved cover, phone and desktop", async ({ page }) => {
  const id = unique();
  const email = `a11y-cover-${id}@example.com`;
  await signUpAs(page, email, `Cover Novelist ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const { rows: made } = await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, blurb)
      VALUES ('${rows[0].id}', 'Ɔdɔ ne Nsuo', 'covered', 'A blurb.') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT id, 'Thursday', 'thursday', 'The ferry came late.', 1, 'published'::poem_status, now(), 4, now() FROM n RETURNING novel_id`);
  const adminUrl = `/admin/novels/${made[0].novel_id}`;
  const picture = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 30, g: 90, b: 160 } } }).jpeg().toBuffer();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(adminUrl);
    await expect(page.locator('[data-cover-panel][data-ready="true"]')).toBeAttached();
    await scan(page, `novel details: drawn cover, ${width}px`);
    await page.locator("[data-cover-input]").setInputFiles({ name: "cover.jpg", mimeType: "image/jpeg", buffer: picture });
    await expect(page.getByRole("dialog", { name: "Crop the cover" })).toBeVisible();
    await scan(page, `cover crop step, ${width}px`);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  }
  await page.locator("[data-cover-input]").setInputFiles({ name: "cover.jpg", mimeType: "image/jpeg", buffer: picture });
  await page.getByRole("dialog", { name: "Crop the cover" }).getByRole("button", { name: "Save cover" }).click();
  await expect(page.getByRole("button", { name: "Change cover" })).toBeVisible({ timeout: 45_000 });
  await scan(page, "novel details: an uploaded cover");
  await page.getByRole("button", { name: "Remove cover" }).click();
  await expect(page.getByRole("alertdialog", { name: "Remove this cover?" })).toBeVisible();
  await scan(page, "remove cover dialog");
  await page.getByRole("button", { name: "Keep cover" }).click();
  await page.goto(`/a/${rows[0].slug}/n/covered`);
  await expect(page.getByRole("main").locator('[data-novel-cover="uploaded"]')).toBeVisible();
  await scan(page, "novel page: an uploaded cover");
});

test("scheduling a chapter: the schedule dialog and its calendar, a scheduled chapter's editor and the chapter list, phone and desktop", async ({ page }) => {
  const id = unique();
  const email = `a11y-schedule-${id}@example.com`;
  await signUpAs(page, email, `Schedule Novelist ${id}`);
  const { rows } = await sql(`SELECT id FROM editors WHERE email = '${email}'`);
  const { rows: made } = await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', 'Ɔdɔ ne Nsuo', 'scheduled') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position) SELECT id, 'Thursday', 'thursday', 'The ferry came late.', 1 FROM n
    RETURNING id, novel_id`);
  const editorUrl = `/admin/novels/${made[0].novel_id}/chapters/${made[0].id}`;
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: "Schedule…" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule this chapter" });
    await expect(dialog).toContainText("Goes live");
    await scan(page, `schedule dialog, ${width}px`);
    await dialog.getByRole("button", { name: "Day" }).click();
    await expect(page.locator("[data-day]").first()).toBeVisible();
    await scan(page, `schedule dialog: the calendar, ${width}px`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await sql(`UPDATE chapters SET status = 'published', release_at = now() + interval '2 days', published_at = now() + interval '2 days' WHERE id = '${made[0].id}'`);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(editorUrl);
    await expect(page.locator("[data-schedule-status]")).toContainText("Scheduled for");
    await scan(page, `a scheduled chapter's editor, ${width}px`);
    await page.goto(`/admin/novels/${made[0].novel_id}`);
    await expect(page.locator("[data-scheduled-time]")).toContainText("for ");
    await scan(page, `the chapter list with a scheduled chapter, ${width}px`);
  }
});

test("share a passage: the sheet with its passage picker (empty, picked and trimmed, over the cap), phone and desktop", async ({ browser }) => {
  const id = unique();
  const { rows } = await sql(`INSERT INTO editors (email, pen_name, slug) VALUES ('a11y-passage-${id}@example.com', 'Selorm Agbɔ ${id}', 'a11y-passage-${id}') RETURNING id`);
  const long = "Ŋkekea ɖe ɖeka la, èyi ƒuta kple eƒe nɔvi. ".repeat(18).trim();
  const body = ["Nùnyá, àdìdòé. Àsí mètúnɛ́ ò.", "The ferry came late. Akua waited.", long].join("\\n\\n");
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, language) VALUES ('${rows[0].id}', 'Ʋu la', 'vu', 'ee') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT id, 'Ŋkeke', 'nkeke', E'${body}', 1, 'published'::poem_status, now(), 80, now() FROM n`);
  const context = await browser.newContext();
  // No file sharing in headless Chrome: Download image is the sheet's main action.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  });
  const page = await context.newPage();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/a/a11y-passage-${id}/n/vu/nkeke`);
    await page.getByRole("button", { name: "Share a passage" }).click();
    const sheet = page.getByRole("dialog", { name: "Share a passage" });
    await expect(sheet.getByRole("checkbox", { name: /^Paragraph 1:/ })).toBeVisible();
    await scan(page, `share a passage: empty picker, ${width}px`);
    await sheet.getByRole("checkbox", { name: /^Paragraph 1:/ }).check();
    await sheet.getByRole("checkbox", { name: /^Paragraph 2:/ }).check();
    await chooseOption(sheet.getByLabel("Start at"), /^Sentence 2:/);
    await expect(sheet.getByRole("img", { name: /^Preview of the image/ })).toBeVisible({ timeout: 45_000 });
    await scan(page, `share a passage: picked and trimmed, ${width}px`);
    await sheet.getByLabel("End after").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await scan(page, `share a passage: End after list open, ${width}px`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Clear" }).click();
    await sheet.getByRole("checkbox", { name: /^Paragraph 3:/ }).check();
    await expect(sheet.locator("[data-passage-count]")).toContainText("too long");
    await scan(page, `share a passage: over the cap, ${width}px`);
    await page.keyboard.press("Escape");
  }
  await context.close();
});

test("admin screens", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-admin-${id}@example.com`, `Access Poet ${id}`);
  await scan(page, "dashboard: empty");

  await page.goto("/admin/poems/new");
  await scan(page, "new poem");
  // Special letters bar open: a language tab with tone marks, then IPA.
  await page.getByRole("button", { name: "Special letters" }).click();
  await page.getByRole("tab", { name: "Ewe" }).click();
  await scan(page, "new poem: special letters (Ewe)");
  await page.getByRole("tab", { name: "IPA" }).click();
  await scan(page, "new poem: special letters (IPA)");
  await page.getByRole("textbox", { name: "Poem" }).fill("a line\n\n  indented");
  await page.getByRole("region", { name: "Card preview" }).getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan(page, "new poem: card preview dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Poem" }).fill("");
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByRole("button", { name: "Publish to board" }).click();
  await scan(page, "new poem: validation errors");

  await publish(page, `Seen ${id}`, "a line\n  indented");
  await publish(page, `Hidden ${id}`, "kept", "a11y-pass");
  // Publishing lands on the list; open the poem again to edit it.
  await page.getByRole("link", { name: new RegExp(`^Hidden ${id}`) }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  await scan(page, "edit poem");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "delete confirmation");
  await page.keyboard.press("Escape");

  // History: a saved change makes an earlier version; open it to compare.
  await page.getByRole("textbox", { name: "Poem" }).fill("kept\n  and changed");
  await page.getByRole("button", { name: "Save changes" }).click();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("link")).toHaveCount(2);
  await scan(page, "edit poem: history panel");
  await history.getByRole("link").nth(1).click();
  const version = page.getByRole("dialog", { name: /^Earlier version/ });
  await expect(version.locator("ins, del").first()).toBeVisible();
  await scan(page, "edit poem: earlier version with changes marked");
  await page.keyboard.press("Escape");
  await expect(version).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByRole("link", { name: `Seen ${id}` })).toBeVisible();
  await scan(page, "dashboard: with poems");
  await page.getByRole("button", { name: `Actions for Seen ${id}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await scan(page, "dashboard: row menu");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await scan(page, "dashboard: phone");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan(page, "dashboard: phone drawer");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("/admin/settings");
  await scan(page, "settings: per poem");
  await page.getByRole("radio", { name: /One password for all/ }).click();
  await scan(page, "settings: shared selected");

  await page.goto("/admin/profile");
  await expect(page.getByRole("heading", { name: "Signed-in devices" })).toBeVisible();
  await scan(page, "profile");
  await page.getByRole("button", { name: "Special letters" }).click();
  await scan(page, "profile: special letters");
});

test("profile photo: the crop step and the profile with a photo, phone and desktop", async ({ page }) => {
  const sharp = (await import("sharp")).default;
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 90, b: 70 } } }).jpeg().toBuffer();
  await signUpAs(page, `a11y-photo-${unique()}@example.com`, `Photo A11y ${unique()}`);
  for (const size of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await page.goto("/admin/profile");
    await expect(page.locator('#photo[data-ready="true"]')).toBeAttached();
    await page.locator("[data-photo-input]").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: photo });
    const dialog = page.getByRole("dialog", { name: "Crop your photo" });
    await expect(dialog).toBeVisible();
    await scan(page, `profile photo: crop step ${size.width}px`);
    if (size.width === 375) {
      await dialog.getByRole("button", { name: "Save photo" }).click();
      await expect(page.locator("[data-sileo-toast]").getByText("Photo saved")).toBeVisible({ timeout: 45_000 });
    } else {
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }
    await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
    await scan(page, `profile with a photo ${size.width}px`);
  }
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByRole("alertdialog", { name: "Remove your photo?" })).toBeVisible();
  await scan(page, "profile photo: remove dialog");
});

test("collections: admin pages and the reading page's navigation", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-coll-${id}@example.com`, `Sequence Poet ${id}`);
  await publish(page, `First ${id}`, "one");
  await publish(page, `Second ${id}`, "two", "a11y-pass");
  await publish(page, `Third ${id}`, "three");

  await page.goto("/admin/collections");
  await scan(page, "collections: empty");
  await page.getByRole("button", { name: "New collection" }).click();
  const create = page.getByRole("dialog", { name: "New collection" });
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(create.getByRole("alert")).toBeVisible();
  await scan(page, "collections: new-collection dialog with an error");
  await create.getByRole("textbox", { name: "Title" }).fill(`Sequence ${id}`);
  await create.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await scan(page, "collection: empty");
  for (const t of [`First ${id}`, `Second ${id}`, `Third ${id}`]) {
    await chooseOption(page.getByRole("combobox", { name: "Add a poem" }), t);
    await page.getByRole("button", { name: "Add to collection" }).click();
    await expect(page.getByRole("button", { name: `Remove “${t}” from the collection` })).toBeVisible();
  }
  await page.getByRole("button", { name: `Move “Third ${id}” up` }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "Moved" })).toBeVisible();
  await scan(page, "collection: with poems, after a move");
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("dialog", { name: "Edit collection" })).toBeVisible();
  await scan(page, "collection: edit dialog");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 800 });
  await scan(page, "collection: phone, with drag handles");
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("dialog", { name: "Edit collection" })).toBeVisible();
  await scan(page, "collection: edit dialog on a phone");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "collection: delete confirmation");
  await page.keyboard.press("Escape");
  await page.goto("/admin/collections");
  await scan(page, "collections: with one");
  await page.goto("/admin/poems/new");
  await expect(page.getByRole("combobox", { name: "Collection" })).toBeVisible();
  await scan(page, "new poem: collection picker");

  // Readers: part n of m, previous/next (a private neighbour is title-only).
  const { rows } = await sql(`SELECT e.slug AS author, p.slug FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'Third ${id}'`);
  await page.goto(`/p/${rows[0].author}/${rows[0].slug}`);
  await expect(page.getByRole("main").getByRole("navigation", { name: new RegExp(`^Sequence ${id}, part`) })).toBeVisible();
  await scan(page, "poem page: collection navigation");
  // Public collection pages (round 2): the author page's list and the collection page.
  await page.goto(`/a/${rows[0].author}`);
  await expect(page.getByRole("region", { name: "Collections" })).toBeVisible();
  await scan(page, "author page: with collections");
  await page.getByRole("region", { name: "Collections" }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: `Sequence ${id}` })).toBeVisible();
  await scan(page, "collection page");
  await page.setViewportSize({ width: 320, height: 720 });
  await scan(page, "collection page: phone");
  await page.setViewportSize({ width: 1280, height: 720 });
  await openBoard(page);
  await page.getByRole("link", { name: `First ${id}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `First ${id}` });
  await expect(dialog.getByRole("navigation", { name: new RegExp(`^Sequence ${id}, part`) })).toBeVisible();
  await scan(page, "overlay: collection navigation");
  // After a step: the same dialog, now showing the next poem.
  await dialog.getByRole("navigation", { name: new RegExp(`^Sequence ${id}, part`) }).getByRole("link", { name: /^Next:/ }).click();
  await expect(page.getByRole("dialog", { name: /^(Second|Third)/ })).toBeVisible();
  await scan(page, "overlay: after stepping to the next poem");
  await page.keyboard.press("Escape");
});

test("board filtered by language", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-lang-${id}@example.com`, `Language Reader ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Ŋutifafa ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("Ŋutifafa na wò");
  await chooseOption(page.getByRole("combobox", { name: "Language" }), "Ewe");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);

  await page.goto("/?lang=ee");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(page.getByRole("button", { name: "Show all languages" })).toBeVisible();
  await scan(page, "board: filtered by language");
  await page.getByRole("combobox", { name: "Language" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  // Scoped to the list: while it's open Radix aria-hides the rest of the page and traps focus in the
  // list, and axe then flags the (focusable, but unreachable) board canvas. The board itself is scanned above.
  await scan(page, "board: language filter list open", '[role="listbox"]');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Follow new poems" })).toBeVisible();
  await scan(page, "board: subscribe popover");
  await page.keyboard.press("Escape");
  // Phone toolbar: icon-only buttons must still be named.
  await page.setViewportSize({ width: 320, height: 640 });
  await scan(page, "board: phone toolbar, filtered");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Follow new poems" })).toBeVisible();
  await scan(page, "board: subscribe popover on a phone");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "List view" }).click();
  await scan(page, "list view: filtered by language");
  await page.setViewportSize({ width: 1280, height: 720 });
  await scan(page, "list view: filtered by language, desktop");
});

test("board, list view, search and reading", async ({ page }) => {
  const id = unique();
  const pen = `Reader Poet ${id}`;
  await signUpAs(page, `a11y-board-${id}@example.com`, pen);
  await publish(page, `Open ${id}`, "first line\n    indented line");
  await publish(page, `Locked ${id}`, "secret", "a11y-pass");

  await openBoard(page);
  await scan(page, "board");
  await page.getByRole("button", { name: "List view" }).click();
  await scan(page, "list view");
  await page.getByRole("button", { name: "Board view" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search the board" });
  await expect(palette).toBeVisible();
  await scan(page, "search: empty");
  await palette.getByRole("combobox").fill(`reader poet ${id}`);
  await expect(palette.getByRole("option").first()).toBeVisible();
  await scan(page, "search: results");
  await palette.getByRole("combobox").fill("qxjzvwpkfy");
  await expect(palette.getByText(/No authors, novels or poems match/)).toBeVisible();
  await scan(page, "search: no results");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: `Open ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Open ${id}` })).toBeVisible();
  await scan(page, "overlay: public poem");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: `Locked ${id} (password protected)` }).click();
  const locked = page.getByRole("dialog", { name: `Locked ${id}` });
  await expect(locked.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await scan(page, "overlay: locked poem");
  await locked.getByLabel("Password", { exact: true }).fill("wrong-one");
  await locked.getByRole("button", { name: "Unlock poem" }).click();
  await expect(locked.getByRole("alert")).toBeVisible();
  await scan(page, "overlay: wrong password");

  // Full pages (hard loads).
  await page.reload();
  await expect(page.getByRole("link", { name: "Back to the board" })).toBeVisible();
  await scan(page, "poem page: locked");
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("a11y-pass");
  await page.getByRole("button", { name: "Unlock poem" }).click();
  await expect(page.locator("article")).toContainText("secret");
  await scan(page, "poem page: unlocked");
  await page.getByRole("main").getByRole("link", { name: pen, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: pen })).toBeVisible();
  await scan(page, "author page");

  await page.goto("/p/nobody/nothing");
  await expect(page.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  await scan(page, "poem not found");
});

test("share as image: the sheet loading, ready (share and no-share browsers) and failed, phone and desktop", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-share-${id}@example.com`, `Share Reader ${id}`);
  await publish(page, `Shared ${id}`, "first line\n    indented\n\n*second stanza*");
  const { rows } = await sql(`SELECT e.slug AS author, p.slug FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'Shared ${id}'`);
  const poemPage = `/p/${rows[0].author}/${rows[0].slug}`;
  const sheet = page.getByRole("dialog", { name: "Share as image" });
  const open = () => page.getByRole("main").getByRole("button", { name: "Share as image" }).click();

  await page.goto(poemPage);
  await scan(page, "poem page: public, with Share as image");

  // Loading: hold the image until the scan is done.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/share-image", async (route) => {
    await held;
    await route.continue();
  });
  await open();
  await expect(sheet.getByRole("status")).toHaveText("Making the image…");
  await scan(page, "share sheet: loading");
  release();
  await expect(sheet.getByRole("img", { name: /^Preview of the image/ })).toBeVisible();
  await scan(page, "share sheet: ready");
  await page.keyboard.press("Escape");
  await page.unroute("**/share-image");

  await page.route("**/share-image", (route) => route.fulfill({ status: 500, body: "" }));
  await open();
  await expect(sheet.getByText("Couldn't load the image", { exact: false })).toBeVisible();
  await scan(page, "share sheet: failed");
  await page.keyboard.press("Escape");
  await page.unroute("**/share-image");

  // A browser that can't share files: Download image, Copy link, Send on WhatsApp.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await open();
  await expect(sheet.getByRole("link", { name: "Send on WhatsApp" })).toBeVisible();
  await expect(sheet.getByRole("img", { name: /^Preview of the image/ })).toBeVisible();
  await scan(page, "share sheet: no file sharing, phone");
});

test("share as image, round 2: the size toggle, the line picker (empty, picked, at the cap) and the writer's buttons", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `a11y-share2-${id}@example.com`, `Share Writer ${id}`);
  const body = ["Nùnyá, àdìdòé,", "àsí mètúnɛ́ ò.", "", ...Array.from({ length: 14 }, (_, i) => `line ${i + 4} of a long poem`)].join("\n");
  await publish(page, `Picked ${id}`, body);
  // The dashboard right after publishing: the just-published row with its Share as image button.
  await expect(page.locator("[data-just-published]").filter({ visible: true }).getByRole("button", { name: "Share as image" })).toBeVisible();
  await scan(page, "dashboard: just published, with Share as image");
  await page.getByRole("button", { name: `Actions for Picked ${id}` }).filter({ visible: true }).click();
  await expect(page.getByRole("menuitem", { name: "Share as image" })).toBeVisible();
  await scan(page, "dashboard: row menu with Share as image");
  await page.getByRole("menuitem", { name: "Share as image" }).click();
  const sheet = page.getByRole("dialog", { name: "Share as image" });
  await expect(sheet.getByRole("img", { name: /^Preview of the image/ })).toBeVisible();
  await scan(page, "share sheet from the dashboard");
  await page.keyboard.press("Escape");

  const { rows } = await sql(`SELECT e.slug AS author, p.slug FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'Picked ${id}'`);
  const choose = (name: RegExp) => sheet.locator("label").filter({ has: page.getByRole("radio", { name }) }).click();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: width < 1000 ? 812 : 900 });
    await page.goto(`/p/${rows[0].author}/${rows[0].slug}`);
    await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
    await choose(/^Chat/);
    await expect(sheet.getByRole("img", { name: /^Preview of the image/ })).toBeVisible();
    await scan(page, `share sheet: chat size, ${width}px`);
    await choose(/^Choose lines$/);
    const picker = sheet.getByRole("group", { name: "Lines for the image" });
    await expect(picker.getByRole("checkbox").first()).toBeVisible();
    await scan(page, `share sheet: picker, nothing picked, ${width}px`);
    await picker.getByRole("checkbox", { name: /^Line 2: / }).click();
    await picker.getByRole("checkbox", { name: /^Line 4: / }).click();
    await expect(sheet.getByRole("img", { name: /^Preview of the image: lines from/ })).toBeVisible();
    await scan(page, `share sheet: picker, two lines, ${width}px`);
    for (let n = 5; n <= 14; n++) await picker.getByRole("checkbox", { name: new RegExp(`^Line ${n}: `) }).click();
    await expect(picker.getByRole("status")).toHaveText("12 of 12 lines picked, the most for one image.");
    await expect(sheet.getByRole("img", { name: /^Preview of the image: lines from/ })).toBeVisible();
    await scan(page, `share sheet: picker at the cap, ${width}px`);
    await page.keyboard.press("Escape");
  }
});

test("share as image, round 3: the design choice (Ink, Board) and the dashboard's visit count", async ({ page, request }) => {
  const id = unique();
  await signUpAs(page, `a11y-share3-${id}@example.com`, `Design Reader ${id}`);
  await publish(page, `Designed ${id}`, "Sɛ wo werɛ fi na wosankɔfa a,\nyɛnkyiri.");
  const { rows } = await sql(`SELECT p.id, e.slug AS author, p.slug FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = 'Designed ${id}'`);
  const sheet = page.getByRole("dialog", { name: "Share as image" });
  const choose = (name: RegExp) => sheet.locator("label").filter({ has: page.getByRole("radio", { name }) }).click();

  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: width < 1000 ? 720 : 900 });
    await page.goto(`/p/${rows[0].author}/${rows[0].slug}`);
    await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
    for (const design of [/^Ink$/, /^Board$/]) {
      await choose(design);
      await expect(sheet.locator(`[data-share-design="${design.source.replace(/[\^$]/g, "").toLowerCase()}"] img`)).toBeVisible();
      await scan(page, `share sheet: design ${design.source}, ${width}px`);
    }
    await page.keyboard.press("Escape");
  }

  // A visit through the short link, then the writer's row with its count.
  const { code } = (await sql(`SELECT code FROM short_links WHERE poem_id = '${rows[0].id}'`)).rows[0] as { code: string };
  await request.get(`/s/${code}`);
  await expect.poll(async () => (await sql(`SELECT visits FROM short_links WHERE poem_id = '${rows[0].id}'`)).rows[0].visits).toBe(1);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(page.locator("[data-share-visits]").filter({ visible: true })).toHaveText("1 visit from shared images");
    await scan(page, `dashboard: a poem's visit count, ${width}px`);
  }
});

test("About and Privacy pages, phone and desktop; a missing poem in the overlay", async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1, name: "About InkBoard" })).toBeVisible();
    await expect(page.locator("[data-walkthrough]")).toBeVisible();
    await scan(page, `about (with its videos, or "coming soon") at ${width}px`);
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await scan(page, `privacy at ${width}px`);
  }
  // The board with About beside Authors, and a poem gone since the board loaded (soft navigation into the overlay).
  const id = unique();
  await signUpAs(page, `a11y-about-${id}@example.com`, `About Poet ${id}`);
  await publish(page, `About board ${id}`, "so the board isn't empty");
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await scan(page, "board with About");
  await page.evaluate(() => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push("/p/nobody/nothing"));
  await expect(page.getByRole("dialog", { name: "Poem not found" })).toBeVisible();
  await scan(page, "overlay: poem not found");
});

test("the novels page (ongoing serials): empty, and with an ongoing, a private and a finished novel and a saved place, phone and desktop", async ({ page }) => {
  // Empty: no other test here makes a finished novel, and run alone (-g) nothing is published at all.
  await page.goto("/novels");
  await expect(page.getByText("No novel is finished yet.")).toBeVisible();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await scan(page, `novels page: empty sections, ${width}px`);
  }
  const id = unique();
  const email = `a11y-serials-${id}@example.com`;
  await signUpAs(page, email, `Serial Writer ${id}`);
  const { rows } = await sql(`SELECT id FROM editors WHERE email = '${email}'`);
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, status, visibility, password_hash, language, blurb) VALUES
      ('${rows[0].id}', 'Ɔdɔ ne Ɛkɔm', 'odo', 'ongoing', 'public', NULL, 'ak', 'Every Thursday the ferry crosses the lake.'),
      ('${rows[0].id}', 'The Locked Room', 'locked', 'ongoing', 'private', 'scrypt$16384$8$1$c2FsdA$aGFzaA', NULL, NULL),
      ('${rows[0].id}', 'The Finished Book', 'finished', 'complete', 'public', NULL, NULL, 'All done.') RETURNING id, slug)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, release_at, word_count)
    SELECT n.id, t.title, t.slug, 'Text.', t.pos, 'published', now() - t.ago, now() - t.ago, 900 FROM n,
      (VALUES ('Thursday', 'thursday', 1, interval '2 days'), ('', 'chapter', 2, interval '1 day')) AS t(title, slug, pos, ago)`);
  // A poem through the app refreshes the cached page.
  await publish(page, `Serials board ${id}`, "a line");
  const { rows: odo } = await sql(`SELECT id FROM novels WHERE editor_id = '${rows[0].id}' AND slug = 'odo'`);
  await page.goto("/novels");
  await page.evaluate((novelId) => {
    localStorage.setItem("inkboard-reading", JSON.stringify({ v: 1, novels: { [novelId]: { chapter: "thursday", at: new Date().toISOString() } } }));
  }, odo[0].id as string);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/novels");
    await expect(page.getByRole("link", { name: "The Locked Room (novel, password protected)" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue: Chapter 1" })).toBeVisible();
    await scan(page, `novels page: with novels, ${width}px`);
  }
});

test("install nudge: every card state", async ({ browser }) => {
  // Chromium's beforeinstallprompt, simulated; this load counts as a second visit.
  const prompt = () =>
    addEventListener("load", () => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
      e.prompt = async () => {};
      e.userChoice = Promise.resolve({ outcome: "dismissed" });
      dispatchEvent(e);
    });
  const returning = () => {
    if (localStorage.getItem("inkboard-install")) return;
    const hourAgo = Date.now() - 3_600_000;
    localStorage.setItem("inkboard-install", JSON.stringify({ visits: 1, visitStart: hourAgo, lastSeen: hourAgo, poems: [] }));
  };
  const id = unique();

  // A writer: their first publish shows the writer card (phone, Chromium).
  const writer = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  });
  await writer.addInitScript(prompt);
  let page = await writer.newPage();
  await signUpAs(page, `a11y-install-${id}@example.com`, `Install Poet ${id}`);
  await publish(page, `Night Letters ${id}`, "dear lamp,\nstay up with me");
  await expect(page.getByRole("region", { name: "Write from your home screen" })).toBeVisible();
  await scan(page, "install: writer card (phone)");
  await writer.close();

  const states: { name: string; region: string; options: Parameters<typeof browser.newContext>[0]; chromium: boolean }[] = [
    { name: "install: Chromium card, desktop", region: "Install InkBoard", options: { viewport: { width: 1280, height: 800 } }, chromium: true },
    {
      name: "install: Chromium card, phone",
      region: "Put InkBoard on your home screen",
      options: {
        viewport: { width: 375, height: 740 },
        isMobile: true,
        hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
      },
      chromium: true,
    },
    {
      name: "install: iPhone instructions",
      region: "Put InkBoard on your home screen",
      options: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      },
      chromium: false,
    },
    {
      name: "install: Mac Safari instructions",
      region: "Add InkBoard to your Dock",
      options: {
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
      },
      chromium: false,
    },
  ];
  for (const state of states) {
    const context = await browser.newContext(state.options);
    if (state.chromium) await context.addInitScript(prompt);
    await context.addInitScript(returning);
    page = await context.newPage();
    await openBoard(page);
    await expect(page.getByRole("region", { name: state.region })).toBeVisible();
    await scan(page, state.name);
    await context.close();
  }
});

test("toasts: success, error and info", async ({ page }) => {
  // Axe runs on each (colour-contrast included, via the WCAG tags), but it can't
  // judge toast text: the toast's fill is an SVG shape, so axe files the title
  // and description as "incomplete". toastContrast computes those ratios itself.
  const id = unique();
  await signUpAs(page, `a11y-toast-${id}@example.com`, `Toast Poet ${id}`);
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Solstice ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("shortest day —\nthe cat follows");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  // Back into the editor: a second save, so the History panel has a version to restore (for the info toast).
  await page.getByRole("link", { name: new RegExp(`^Solstice ${id}`) }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  await page.getByRole("textbox", { name: "Poem" }).fill("shortest day —\nthe cat follows\nthe last square of sun");
  await page.getByRole("button", { name: "Save changes" }).click();

  const check = async (title: string, screen: string) => {
    const ratios = await toastContrast(page, title);
    expect.soft(ratios.title, `${screen}: title contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(ratios.description ?? 0, `${screen}: description contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(await renderedToastTitle(page, title), `${screen}: title as written`).toBe(title);
    await scan(page, screen);
  };
  await check("Saved and published", "toast: success");

  await page.getByRole("textbox", { name: "Title" }).fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await check("Couldn't save the poem", "toast: error");
  await page.getByRole("textbox", { name: "Title" }).fill(`Solstice ${id}`);

  const versions = page.getByRole("region", { name: "History" }).getByRole("link");
  await expect(versions).toHaveCount(2);
  await versions.nth(1).click();
  await page.getByRole("dialog", { name: /^Earlier version, saved / }).getByRole("button", { name: "Restore this version" }).click();
  await check("Version restored in the editor", "toast: info");
});

test("offline: the indicator and the offline page", async ({ context, page }) => {
  const id = unique();
  await signUpAs(page, `a11y-offline-${id}@example.com`, `Offline Reader ${id}`);
  await publish(page, `Night Letters ${id}`, "dear lamp,\nstay up with me");

  // The calm indicator, on the board and on a poem page (the browser's offline event drives it).
  await openBoard(page);
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" }).first()).toBeVisible();
  await scan(page, "offline: board indicator");
  await context.setOffline(false);
  await page.getByRole("link", { name: `Night Letters ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Night Letters ${id}` })).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: /Open full page/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Night Letters ${id}` })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" }).first()).toBeVisible();
  await scan(page, "offline: poem page indicator");
  await context.setOffline(false);

  // The offline page with nothing saved (no worker under next dev)…
  await page.goto("/offline?from=%2Fp%2Fsomeone%2Fsomething");
  await expect(page.getByText("No poems saved yet.")).toBeVisible();
  await scan(page, "offline page: nothing saved");
  // …and with saved poems, written the way the worker writes its index.
  await page.evaluate(async () => {
    const cache = await caches.open("inkboard-pages-a11y");
    const index = [
      { url: "/p/odalys-moon/solstice", kind: "poem", title: "Solstice", author: "Odalys Moon", savedAt: 2 },
      { url: "/p/ines-calloway/salt", kind: "poem", title: "Salt", author: "Ines Calloway", savedAt: 1 },
      { url: "/", kind: "board", title: "The board", author: null, savedAt: 3 },
    ];
    await cache.put("/__inkboard/saved.json", new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
  });
  await page.reload();
  await expect(page.locator("[data-saved-poems]").getByRole("link")).toHaveCount(2);
  await scan(page, "offline page: saved poems");
  await page.setViewportSize({ width: 375, height: 740 });
  await scan(page, "offline page: saved poems, phone");
  await page.evaluate(() => caches.delete("inkboard-pages-a11y"));
});

test("dashboard: the row of a poem just published", async ({ browser }) => {
  // Reduced motion keeps the tint (it fades otherwise), so axe measures the tinted row.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const id = unique();
  await signUpAs(page, `a11y-published-${id}@example.com`, `Listed Poet ${id}`);
  await publish(page, `Night Letters ${id}`, "dear lamp,\nstay up with me");
  await expect(page.locator("[data-just-published]").filter({ visible: true })).toContainText("Just published");
  await scan(page, "dashboard: just published");
  await page.setViewportSize({ width: 375, height: 740 });
  await expect(page.locator("[data-just-published]").filter({ visible: true })).toContainText("Just published");
  await scan(page, "dashboard: just published, phone");
  await context.close();
});

test("notifications on this device: every state of the switch, and the after-install offer", async ({ browser, page: writer }) => {
  test.setTimeout(300_000);
  const id = unique();
  await signUpAs(writer, `a11y-notify-${id}@example.com`, `Bell Poet ${id}`);
  await publish(writer, `Lamplight ${id}`, "one bulb over the stall,\nmoths keeping the hours");
  // The browser's push half is stubbed (e2e/push-stub.ts); the UI is real.
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const states: [string, FakePush, Record<string, unknown>?][] = [
    ["off", { permission: "default" }],
    ["on", { permission: "granted", subscribed: true }],
    ["blocked", { permission: "denied" }],
    ["unsupported", { permission: "default", unsupported: true }],
    ["iPhone, not installed", { permission: "default", unsupported: true }, { userAgent: IPHONE, isMobile: true, hasTouch: true }],
  ];
  for (const [name, push, extra] of states) {
    for (const width of [375, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, ...extra });
      await fakePush(context, push);
      const page = await context.newPage();
      await openBoard(page);
      await page.getByRole("button", { name: "Subscribe", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Follow new poems" });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-push-setting]")).toBeVisible();
      const how = dialog.getByRole("button", { name: "How notifications work" });
      if (name !== "unsupported") await how.click();
      await scan(page, `subscribe popover, notifications ${name}, ${width}px`);
      await context.close();
    }
  }

  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await fakePush(context, { permission: "default" });
  const page = await context.newPage();
  await openBoard(page);
  await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("region", { name: "Get notified about new poems" })).toBeVisible();
  await scan(page, "notifications offer after installing, phone");
  await context.close();
});

test("following authors: the author page toggle and the popover's mode and follow list", async ({ browser, page: writer }) => {
  test.setTimeout(300_000);
  const id = unique();
  const pen = `Follow Poet ${id}`;
  await signUpAs(writer, `a11y-follow-${id}@example.com`, pen);
  await publish(writer, `Harmattan ${id}`, "dust on the louvres,\nthe radio humming");
  const { slug } = (await sql(`SELECT slug FROM editors WHERE email = 'a11y-follow-${id}@example.com'`)).rows[0] as { slug: string };
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const follow = (page: Page) => page.getByRole("main").getByRole("button", { name: `Notify me about new poems by ${pen}` });

  for (const width of [375, 1280]) {
    const states: [string, FakePush, Record<string, unknown>?][] = [
      ["not following", { permission: "default" }],
      ["blocked", { permission: "denied" }],
      ["iPhone, not installed", { permission: "default", unsupported: true }, { userAgent: IPHONE, isMobile: true, hasTouch: true }],
    ];
    for (const [name, push, extra] of states) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, ...extra });
      await fakePush(context, push);
      const page = await context.newPage();
      await page.goto(`/a/${slug}`);
      await expect(page.getByRole("heading", { level: 1, name: pen })).toBeVisible();
      await expect(page.locator("[data-follow-author]")).toBeVisible();
      await scan(page, `author page follow toggle, ${name}, ${width}px`);
      await context.close();
    }

    // Following: the toggle on, then the popover with the mode and the list (and empty).
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    await fakePush(context, { permission: "default" });
    const page = await context.newPage();
    await page.goto(`/a/${slug}`);
    await follow(page).click();
    await expect(follow(page)).toHaveAttribute("aria-pressed", "true");
    await scan(page, `author page follow toggle, following, ${width}px`);
    await openBoard(page);
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Follow new poems" });
    await expect(dialog.getByRole("list", { name: "Authors you follow" })).toBeVisible();
    await scan(page, `subscribe popover, following one author, ${width}px`);
    await dialog.getByRole("button", { name: `Unfollow ${pen}` }).click();
    await expect(dialog.getByText("Until you follow someone, this device gets no notifications.")).toBeVisible();
    await scan(page, `subscribe popover, followed mode with nobody followed, ${width}px`);
    await dialog.getByRole("radio", { name: "All new poems" }).click();
    await expect(dialog.getByRole("radio", { name: "All new poems" })).toBeChecked();
    await scan(page, `subscribe popover, all new poems, ${width}px`);
    await context.close();
  }
});

test("dashboard welcome checklist: fresh, part done (folded and open), all set", async ({ page }) => {
  const id = unique();
  const email = `a11y-checklist-${id}@example.com`;
  await signUpAs(page, email, `Checklist A11y ${id}`);
  const region = page.getByRole("region", { name: "Getting started" });
  const where = `(SELECT id FROM editors WHERE email = '${email}')`;
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(region.getByText("1 of 6 done")).toBeVisible();
    await scan(page, `checklist fresh at ${width}px`);
  }
  // Part done (set up directly: this test is about what's on screen).
  await sql(`UPDATE editors SET avatar = 'a02', tagline = 'Short lines' WHERE email = '${email}'`);
  await publish(page, `Checklist poem ${id}`, "a line");
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(region.getByText("4 of 6 done")).toBeVisible();
    await scan(page, `checklist part done, folded at ${width}px`);
    await region.getByRole("button", { name: "Show all steps" }).click();
    await scan(page, `checklist part done, open at ${width}px`);
  }
  // All set: the one render that shows it.
  await sql(`INSERT INTO recovery_codes (editor_id, code_hash) VALUES (${where}, 'a11y-${id}')`);
  await sql(`UPDATE editors SET author_page_shared_at = now() WHERE email = '${email}'`);
  await page.goto("/admin");
  await expect(page.locator("[data-checklist-all-set]")).toBeVisible();
  await scan(page, "checklist all set");
});

test("chapter text settings: the open control, the default and the largest sans text, phone and desktop", async ({ page }) => {
  const id = unique();
  const { rows } = await sql(
    `INSERT INTO editors (email, pen_name, slug) VALUES ('a11y-reading-${id}@example.com', 'Reading A11y ${id}', 'reading-a11y-${id}') RETURNING id, slug`,
  );
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', 'Settings', 'settings') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT id, 'One', 'one', '^^The ferry came late.' || chr(10) || chr(10) || 'Akua waited.', 1, 'published', now(), 5, now() FROM n`);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/a/${rows[0].slug}/n/settings/one`);
    await page.getByRole("button", { name: "Text settings" }).click();
    const panel = page.getByRole("dialog", { name: "Text settings" });
    await expect(panel.getByRole("radio", { name: "Default" })).toBeChecked();
    await scan(page, `text settings open at ${width}px`);
    await panel.getByText("Largest", { exact: true }).click();
    await panel.getByText("Sans", { exact: true }).click();
    await expect(panel.getByRole("radio", { name: "Sans" })).toBeChecked();
    await scan(page, `text settings largest sans at ${width}px`);
    await page.keyboard.press("Escape");
    await scan(page, `chapter at the largest sans at ${width}px`);
    await page.evaluate(() => localStorage.removeItem("inkboard-reading-text"));
  }
});

test("writer's stats: empty and with links, a novel and followers, phone and desktop", async ({ page }) => {
  test.slow();
  const id = unique();
  const email = `a11y-stats-${id}@example.com`;
  await signUpAs(page, email, `Stats A11y ${id}`);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/stats");
    await expect(page.getByRole("main").getByText("No shared links yet.")).toBeVisible();
    await scan(page, `stats: empty at ${width}px`);
  }
  const { rows } = await sql(`SELECT id FROM editors WHERE email = '${email}'`);
  const ed = rows[0].id as string;
  await sql(`WITH p AS (INSERT INTO poems (editor_id, title, slug, body, status, published_at) VALUES ('${ed}', 'Ŋutifafa', 'nutifafa', 'a line', 'published', now()) RETURNING id)
    INSERT INTO short_links (poem_id, code, visits) SELECT id, 'k${id.slice(-5).replace(/[^2-9b-df-hj-np-tv-xz]/g, "k")}', 12 FROM p`);
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, visibility, password_hash) VALUES ('${ed}', 'Ʋu la', 'vu', 'private', 'scrypt$1$1$1$x$y') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at) SELECT id, 'Ŋkeke', 'nkeke', 'Text.', 1, 'published', now(), 1200, now() FROM n`);
  for (let i = 0; i < 4; i++) {
    await sql(`WITH s AS (INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('https://fcm.googleapis.com/fcm/send/a11y-${id}-${i}', 'k', 'a') RETURNING id)
      INSERT INTO push_follows (subscription_id, editor_id) SELECT id, '${ed}' FROM s`);
  }
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/stats");
    await expect(page.getByRole("main").locator("[data-link-row]")).toHaveCount(1);
    await expect(page.getByRole("main").locator('[data-stat="followers"]')).toHaveText("4");
    await scan(page, `stats: with data at ${width}px`);
  }
});
