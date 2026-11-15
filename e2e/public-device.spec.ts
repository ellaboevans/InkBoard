import { expect, test, type BrowserContext } from "@playwright/test";
import {
  createRecoveryCodes,
  latestCode,
  recoverySignIn,
  requestCode,
  signOut,
  signUpAs,
  sql,
  typeCode,
} from "./helpers";

/*
 * "This isn't my device" (docs/PLAN.md, Phase 16): a browser-session cookie
 * (no Expires / Max-Age), a 12-hour server session, no device cookie, and
 * "Public device" in the profile's device list. Unticked keeps 30 days.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((c) => c.name === name);
}

/** Hours between a session's creation and its server-side expiry. */
async function sessionHours(email: string): Promise<number[]> {
  const { rows } = await sql(
    `SELECT extract(epoch FROM s.expires_at - s.created_at) / 3600 AS h FROM sessions s
     JOIN editors e ON e.id = s.editor_id WHERE e.email = '${email}' ORDER BY s.created_at`,
  );
  return rows.map((r) => Math.round(Number(r.h)));
}

test("email code with 'This isn't my device': a session cookie, 12 hours, no device cookie", async ({ browser }) => {
  const id = unique();
  const email = `public-${id}@example.com`;
  // The editor's own laptop first (an ordinary 30-day sign-in).
  const own = await browser.newContext();
  const laptop = await own.newPage();
  await signUpAs(laptop, email, `Traveller ${id}`);
  const ownCookie = await cookie(own, "poemhub_session");
  expect(ownCookie?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
  expect(await cookie(own, "poemhub_device")).toBeDefined();

  // Then a library computer, with the box ticked on the email step.
  const library = await browser.newContext();
  const page = await library.newPage();
  await sql("DELETE FROM rate_limits"); // skip the resend cooldown
  const before = await latestCode(email);
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  const box = page.getByRole("checkbox", { name: "This isn't my device" });
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("main").getByText("We sent a 6-digit code to")).toBeVisible();
  // The choice carries over to the code step, where it can still be changed.
  await expect(page.getByRole("checkbox", { name: "This isn't my device" })).toBeChecked();
  await expect.poll(() => latestCode(email)).not.toBe(before);
  await typeCode(page, await latestCode(email));
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });

  const session = await cookie(library, "poemhub_session");
  expect(session).toBeDefined();
  expect(session!.expires).toBe(-1); // no Expires / Max-Age: gone when the browser closes
  expect(session!.httpOnly).toBe(true);
  expect(await cookie(library, "poemhub_device")).toBeUndefined();
  expect(await sessionHours(email)).toEqual([30 * 24, 12]);

  // Both sessions on the profile: the library one is marked as public.
  await page.goto("/admin/profile");
  const rows = page.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("This device");
  await expect(rows.first()).toContainText("Public device");
  await expect(rows.nth(1)).not.toContainText("Public device");
  await expect(page.getByRole("main")).toContainText("or 12 hours on a public device");

  await laptop.goto("/admin/profile");
  const fromLaptop = laptop.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem");
  await expect(fromLaptop.nth(1)).toContainText("Public device");
  await expect(fromLaptop.first()).not.toContainText("Public device");

  // "Closing the browser": dropping session cookies signs the library out.
  await library.clearCookies();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);
  await library.close();
  await own.close();
});

test("recovery code with 'This isn't my device', and unticked keeps today's behaviour", async ({ browser }) => {
  const id = unique();
  const email = `pubrec-${id}@example.com`;
  const own = await browser.newContext();
  const phone = await own.newPage();
  await signUpAs(phone, email, `Pocket ${id}`);
  const codes = await createRecoveryCodes(phone);
  await phone.getByRole("button", { name: "I've saved my codes" }).click();
  await signOut(phone);
  await own.close();

  const library = await browser.newContext();
  const page = await library.newPage();
  await recoverySignIn(page, email, codes[0], { publicDevice: true });
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  expect((await cookie(library, "poemhub_session"))!.expires).toBe(-1);
  expect(await cookie(library, "poemhub_device")).toBeUndefined();
  await page.goto("/admin/profile");
  const current = page.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem").first();
  await expect(current).toContainText("Public device");
  await expect(current).toContainText("Recovery code");
  await signOut(page);
  await library.close();

  // Unticked: a normal 30-day cookie and a device cookie, as before.
  const home = await browser.newContext();
  const desk = await home.newPage();
  await recoverySignIn(desk, email, codes[1]);
  await expect(desk).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  expect((await cookie(home, "poemhub_session"))!.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
  expect(await cookie(home, "poemhub_device")).toBeDefined();
  await home.close();
});

test("the email step keeps the box ticked after an error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("checkbox", { name: "This isn't my device" }).check();
  await page.getByRole("textbox", { name: "Email" }).fill("not-an-email@x");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Enter a valid email address.");
  await expect(page.getByRole("checkbox", { name: "This isn't my device" })).toBeChecked();
  // Sanity: requestCode still works from here.
  await requestCode(page, `ok-${unique()}@example.com`);
});
