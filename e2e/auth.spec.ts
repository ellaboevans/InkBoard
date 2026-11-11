import { expect, test } from "@playwright/test";
import { latestCode, requestCode, sql, typeCode } from "./helpers";

const EMAIL = `poet-${Date.now()}@example.com`;

test("admin is not reachable while signed out", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("first sign-in creates the editor, onboarding, sign-out, and return sign-in", async ({
  page,
  context,
}) => {
  // 1. Request and enter a code → new account → onboarding
  await requestCode(page, EMAIL);
  await typeCode(page, await latestCode(EMAIL));
  await expect(page).toHaveURL(/\/admin\/onboarding$/);

  // Session cookie is httpOnly and SameSite=Lax
  const cookie = (await context.cookies()).find((c) => c.name === "poemhub_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  // 2. Choose a pen name → dashboard
  await page.getByLabel("Pen name").fill("Ada Verse");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Welcome, Ada Verse" })).toBeVisible();
  // The shared header picks up the new pen name without a reload.
  await expect(page.locator("header")).toContainText("Ada Verse");

  // Signed-in editors visiting /sign-in go straight to the dashboard
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/admin$/);

  // 3. Sign out → session revoked
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);
  const { rows } = await sql("SELECT count(*)::int AS n FROM sessions");
  expect(rows[0].n).toBe(0);

  // 4. Return visit: a *new* code signs into the *same* account
  await sql("DELETE FROM rate_limits"); // skip the 60s resend cooldown
  const firstCode = await latestCode(EMAIL);
  await requestCode(page, EMAIL);
  await expect.poll(() => latestCode(EMAIL)).not.toBe(firstCode);
  await typeCode(page, await latestCode(EMAIL));
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Welcome, Ada Verse" })).toBeVisible();

  const editors = await sql(`SELECT count(*)::int AS n FROM editors WHERE email = '${EMAIL}'`);
  expect(editors.rows[0].n).toBe(1);
});

test("wrong codes show remaining attempts, then the right code works", async ({ page }) => {
  const email = `wrong-${Date.now()}@example.com`;
  await requestCode(page, email);
  const code = await latestCode(email);
  const wrong = code === "000000" ? "111111" : "000000";

  await typeCode(page, wrong);
  await expect(page.locator("[data-slot=alert]")).toContainText("4 attempts left");

  await typeCode(page, code);
  await expect(page).toHaveURL(/\/admin\/onboarding$/);
});

test("resend is disabled during the cooldown", async ({ page }) => {
  await requestCode(page, `cooldown-${Date.now()}@example.com`);
  await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();
});
