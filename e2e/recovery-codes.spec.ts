import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  alertsFor,
  createRecoveryCodes,
  latestCode,
  latestStepUpCode,
  recoveryNoticesFor,
  recoverySignIn,
  requestCode,
  shownRecoveryCodes,
  signOut,
  signUpAs,
  sql,
  typeCode,
} from "./helpers";

/*
 * Recovery codes (docs/PLAN.md, Phase 16): made on the profile, used on
 * /sign-in/recovery from any computer, with the step-up rule and the
 * dashboard's setup and low-codes notices.
 */

// Every local request shares ::1, so per-IP limits would trip across tests.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const GENERIC_ERROR = "That email address and recovery code don't match, or the code was already used.";

const recoveryNotice = (page: Page) => page.getByRole("region", { name: /recovery code/i });

test("set up codes on the profile, copy and download them, then sign in with one on another computer", async ({
  browser,
}) => {
  const id = unique();
  const email = `recover-${id}@example.com`;
  const pen = `Keeper ${id}`;
  const phone = await browser.newContext();
  await phone.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await phone.newPage();
  await signUpAs(page, email, pen);

  // Just signed in, so no confirmation is needed: the codes appear straight away.
  const codes = await createRecoveryCodes(page);
  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);
  for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
  await expect(page.getByRole("heading", { name: "Your recovery codes" })).toBeFocused();
  await expect(page.getByRole("main")).toContainText("password manager");

  // Copy puts every code on the clipboard.
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Codes copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  for (const code of codes) expect(copied).toContain(code);

  // Download saves the same text as a .txt file.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download (.txt)" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("inkboard-recovery-codes.txt");
  const file = await readFile((await download.path())!, "utf8");
  for (const code of codes) expect(file).toContain(code);
  expect(file).toContain(email);
  expect(file).toContain("/sign-in/recovery");

  // Print prints only the codes.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void (window as unknown as { printed: number }).printed++;
  });
  await page.getByRole("button", { name: "Print" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-print-sheet]")).toBeVisible();
  await expect(page.locator("[data-print-sheet]")).toContainText(codes[0]);
  await expect(page.getByRole("main")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Done: the codes are gone from the page for good; the count stays.
  await page.getByRole("button", { name: "I've saved my codes" }).click();
  await expect(page.getByRole("list", { name: "Recovery codes" })).toHaveCount(0);
  await expect(page.getByTestId("recovery-status")).toHaveText("10 of 10 codes left");
  await expect.poll(() => recoveryNoticesFor(email)).toEqual([
    expect.objectContaining({ kind: "recovery-codes-changed", firstSet: true }),
  ]);
  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await phone.close();

  // A library computer: no session, no device cookie, a different network.
  const library = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.44" } });
  const lib = await library.newPage();
  await lib.goto("/sign-in");
  await lib.getByRole("link", { name: "Use a recovery code" }).click();
  await expect(lib).toHaveURL(/\/sign-in\/recovery$/);
  // Typed loosely: lower case, spaces instead of dashes.
  await recoverySignIn(lib, email, codes[2].toLowerCase().replace(/-/g, " "));
  await expect(lib).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  await expect(lib.getByRole("heading", { name: "Your poems" })).toBeVisible();

  // The editor hears about it twice: the new-device notice and the recovery notice.
  await expect.poll(() => recoveryNoticesFor(email)).toContainEqual(
    expect.objectContaining({ kind: "recovery-used", remaining: 9 }),
  );
  await expect.poll(() => alertsFor(email)).toEqual([expect.objectContaining({ ip: "198.51.100.44" })]);

  // The device list says how this session started.
  await lib.goto("/admin/profile");
  const current = lib.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem").first();
  await expect(current).toContainText("This device");
  await expect(current).toContainText("Recovery code");
  await expect(lib.getByTestId("recovery-status")).toHaveText("9 of 10 codes left");
  await signOut(lib);
  await library.close();

  // A used code fails the second time, with the same generic message as any wrong code.
  const again = await browser.newContext();
  const second = await again.newPage();
  await recoverySignIn(second, email, codes[2]);
  await expect(second.getByRole("main").getByRole("alert")).toContainText(GENERIC_ERROR);
  await expect(second).toHaveURL(/\/sign-in\/recovery$/);
  // The form keeps what was typed, so a typo can be fixed.
  await expect(second.getByRole("textbox", { name: "Email" })).toHaveValue(email);
  await again.close();
});

test("a wrong code, an unknown email and an editor without codes all get the same generic error", async ({ page, browser }) => {
  const id = unique();
  const email = `nocodes-${id}@example.com`;
  await signUpAs(page, email, `No Codes ${id}`);
  await signOut(page);

  const visitor = await browser.newContext();
  const p = await visitor.newPage();
  const messages: string[] = [];
  for (const who of [email, `nobody-${id}@example.com`]) {
    await recoverySignIn(p, who, "ABCD-EFGH-JKMN");
    const alert = p.getByRole("main").getByRole("alert");
    await expect(alert).toBeVisible();
    messages.push(await alert.innerText());
  }
  expect(messages[0]).toContain(GENERIC_ERROR);
  expect(messages[1]).toBe(messages[0]);
  await expect(p.locator("[data-sileo-toast]").getByText("Couldn't sign you in").first()).toBeVisible();
  await visitor.close();
});

test("making codes after an old sign-in asks for an emailed confirmation code first", async ({ page }) => {
  const id = unique();
  const email = `stepup-${id}@example.com`;
  await signUpAs(page, email, `Careful ${id}`);
  const first = await createRecoveryCodes(page);
  await page.getByRole("button", { name: "I've saved my codes" }).click();

  // The sign-in is now older than ten minutes.
  await sql(
    `UPDATE sessions SET email_verified_at = now() - interval '11 minutes'
     WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`,
  );
  await page.reload();
  await expect(page.getByRole("main")).toContainText("We'll email you a code to confirm it's you first.");
  await page.getByRole("button", { name: "Make a new set" }).click();
  // Replacing asks first: the old codes stop working.
  const dialog = page.getByRole("alertdialog", { name: "Make a new set of recovery codes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace my codes" }).click();

  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeFocused();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("main")).toContainText(`We sent a 6-digit code to ${email}`);
  const code = await latestStepUpCode(email);
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(wrong);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("That code is incorrect. 4 attempts left.");
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(code);

  const fresh = await shownRecoveryCodes(page);
  expect(fresh.some((c) => first.includes(c))).toBe(false);
  await expect.poll(() => recoveryNoticesFor(email)).toEqual([
    expect.objectContaining({ kind: "recovery-codes-changed", firstSet: true }),
    expect.objectContaining({ kind: "recovery-codes-changed", firstSet: false }),
  ]);
  // The confirmation was a step-up email, not a sign-in email.
  const { rows } = await sql(`SELECT count(*)::int AS n FROM recovery_codes r JOIN editors e ON e.id = r.editor_id WHERE e.email = '${email}'`);
  expect(rows[0].n).toBe(10);
});

test("the dashboard prompts once to set up codes; 'Not now' is remembered on every device", async ({ page, browser }) => {
  const id = unique();
  const email = `prompt-${id}@example.com`;
  await signUpAs(page, email, `Prompted ${id}`);
  const prompt = page.getByRole("region", { name: "Set up recovery codes so you can sign in without your email" });
  // A new writer gets the welcome checklist instead, whose step replaces this
  // prompt (Phase 20); once the checklist is hidden, the prompt is back.
  const checklist = page.getByRole("region", { name: "Getting started" });
  await expect(checklist).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await checklist.getByRole("button", { name: "Hide checklist" }).click();
  await expect(checklist).toHaveCount(0);
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("link", { name: "Set up recovery codes" })).toHaveAttribute(
    "href",
    "/admin/profile#recovery-codes",
  );
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(recoveryNotice(page)).toHaveCount(0);

  // Another browser, same editor: still dismissed (stored on the server).
  const { rows } = await sql(`SELECT recovery_prompt_dismissed_at FROM editors WHERE email = '${email}'`);
  expect(rows[0].recovery_prompt_dismissed_at).not.toBeNull();
  const other = await browser.newContext();
  const laptop = await other.newPage();
  await sql("DELETE FROM rate_limits");
  const before = await latestCode(email);
  await requestCode(laptop, email);
  await expect.poll(() => latestCode(email)).not.toBe(before);
  await typeCode(laptop, await latestCode(email));
  await expect(laptop).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  await expect(laptop.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(recoveryNotice(laptop)).toHaveCount(0);
  await other.close();
});

test("the setup prompt leads to the profile section, and goes away once codes exist", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `setup-${id}@example.com`, `Setter ${id}`);
  // A new writer's prompt is the welcome checklist's step ("Set up recovery codes or a passkey", Phase 20).
  await page.getByRole("link", { name: "Set up recovery codes" }).click();
  await expect(page).toHaveURL(/\/admin\/profile#recovery-codes$/);
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeInViewport();
  await page.getByRole("button", { name: "Create recovery codes" }).click();
  await shownRecoveryCodes(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(recoveryNotice(page)).toHaveCount(0);
});

test("with two or fewer codes left, the dashboard says so and links to a new set", async ({ page }) => {
  const id = unique();
  const email = `low-${id}@example.com`;
  await signUpAs(page, email, `Low ${id}`);
  await createRecoveryCodes(page);
  await page.getByRole("button", { name: "I've saved my codes" }).click();

  const useUp = (n: number) =>
    sql(`UPDATE recovery_codes SET used_at = now() WHERE id IN (
      SELECT r.id FROM recovery_codes r JOIN editors e ON e.id = r.editor_id
      WHERE e.email = '${email}' AND r.used_at IS NULL LIMIT ${n})`);

  await useUp(7); // 3 left: no notice yet
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(recoveryNotice(page)).toHaveCount(0);

  await useUp(1); // 2 left
  await page.reload();
  const low = page.getByRole("region", { name: "Only 2 recovery codes left" });
  await expect(low).toBeVisible();
  await useUp(1); // 1 left
  await page.reload();
  await expect(page.getByRole("region", { name: "Only 1 recovery code left" })).toBeVisible();
  await useUp(1); // none left
  await page.reload();
  const none = page.getByRole("region", { name: "You've used all your recovery codes" });
  await expect(none).toBeVisible();
  // Not dismissible: it stays until there's a new set.
  await expect(none.getByRole("button")).toHaveCount(0);

  await none.getByRole("link", { name: "Make a new set" }).click();
  await expect(page).toHaveURL(/\/admin\/profile#recovery-codes$/);
  await expect(page.getByTestId("recovery-status")).toHaveText("0 of 10 codes left");
});
