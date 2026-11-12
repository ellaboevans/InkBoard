import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_DATABASE_URL, OTP_OUTBOX } from "../playwright.config";

export async function latestCode(email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n");
      code = lines
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; code: string })
        .findLast((m) => m.to === email)?.code;
      return code;
    })
    .toBeTruthy();
  return code!;
}

export async function sql(query: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(query);
  } finally {
    await client.end();
  }
}

export async function requestCode(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("main").getByText(`We sent a 6-digit code to`)).toBeVisible();
}

export async function typeCode(page: Page, code: string) {
  // input-otp renders a single real <input>; typing fills all slots.
  await page.locator('input[name="code"]').fill(code);
}

/** Full sign-in + onboarding for a brand-new editor; ends on /admin. */
export async function signUpAs(page: Page, email: string, penName: string) {
  await requestCode(page, email);
  await typeCode(page, await latestCode(email));
  // The first Server Action of a run is compiled on demand by `next dev`,
  // which can take a while on a busy machine; later ones are fast.
  await expect(page).toHaveURL(/\/admin\/onboarding$/, { timeout: 45_000 });
  await page.getByRole("textbox", { name: "Pen name" }).fill(penName);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
}

/** The account menu button in the dashboard sidebar (shows the pen name). */
export const accountButton = (page: Page, penName: string) =>
  page.getByRole("button", { name: new RegExp(`^Account menu: ${penName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

/** Sign out through the sidebar account menu. */
export async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Account menu:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}
