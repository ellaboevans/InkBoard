import { expect, test, type Page } from "@playwright/test";
import {
  alertsFor,
  createRecoveryCodes,
  latestStepUpCode,
  passkeyNoticesFor,
  recoveryNoticesFor,
  recoverySignIn,
  signOut,
  signUpAs,
  sql,
  virtualAuthenticator,
} from "./helpers";

/*
 * Passkeys (docs/PLAN.md, Phase 16 round 2), with Chromium's virtual
 * authenticator: a platform authenticator with resident keys and user
 * verification that answers prompts by itself.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FAILED = "That passkey didn't work here. Try again, or sign in with your email.";

const passkeyList = (page: Page) => page.getByRole("list", { name: "Your passkeys" }).getByRole("listitem");
const errorToasts = (page: Page) => page.locator("[data-sileo-toast]").filter({ hasText: "Couldn't sign you in" });

async function addPasskeyOnProfile(page: Page) {
  await page.goto("/admin/profile#passkeys");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Passkey added")).toBeVisible({ timeout: 45_000 });
}

async function passkeySignIn(page: Page) {
  if (!/\/sign-in/.test(page.url())) await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
}

test("add a passkey on the profile, sign out, then sign in with it", async ({ page }) => {
  const id = unique();
  const email = `passkey-${id}@example.com`;
  const authenticator = await virtualAuthenticator(page);
  // The CSP (next.config.ts) must not get in the way of any of this.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const cspViolations = () => page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
  await signUpAs(page, email, `Keyed ${id}`);

  await page.goto("/admin/profile#passkeys");
  await expect(page.getByRole("main")).toContainText("No passkeys yet");
  await addPasskeyOnProfile(page);
  expect(await cspViolations()).toEqual([]);
  await expect(passkeyList(page)).toHaveCount(1);
  await expect(passkeyList(page).first()).toContainText("Chrome on macOS");
  await expect(passkeyList(page).first()).toContainText("not used yet");

  // A discoverable credential for this site, holding the editor's opaque handle.
  const [credential] = await authenticator.credentials();
  expect(credential.isResidentCredential).toBe(true);
  expect(credential.rpId).toBe("localhost");
  const { rows } = await sql(`SELECT webauthn_user_id FROM editors WHERE email = '${email}'`);
  expect(Buffer.from(credential.userHandle!, "base64").toString("base64url")).toBe(rows[0].webauthn_user_id);
  await expect.poll(() => passkeyNoticesFor(email)).toEqual([
    expect.objectContaining({ kind: "passkey-added", passkeyName: "Chrome on macOS", afterRecovery: false }),
  ]);

  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Your poems" })).toBeVisible();
  expect(await cspViolations()).toEqual([]);

  await page.goto("/admin/profile");
  const current = page.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem").first();
  await expect(current).toContainText("This device");
  await expect(current).toContainText("Passkey");
  await expect(passkeyList(page).first()).toContainText("last used");
  // Same browser as before: no new-device notice.
  expect(await alertsFor(email)).toEqual([]);
});

test("rename and remove a passkey; a removed passkey can't sign in", async ({ page }) => {
  const id = unique();
  const email = `rename-${id}@example.com`;
  await virtualAuthenticator(page);
  await signUpAs(page, email, `Renamer ${id}`);
  await addPasskeyOnProfile(page);

  await page.getByRole("button", { name: "Rename Chrome on macOS" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename passkey" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Study laptop");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(passkeyList(page).first()).toContainText("Study laptop");

  // "This isn't my device" applies to passkey sign-ins too.
  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/sign-in");
  await page.getByRole("checkbox", { name: "This isn't my device" }).check();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  const session = (await page.context().cookies()).find((c) => c.name === "poemhub_session");
  expect(session?.expires).toBe(-1);
  await page.goto("/admin/profile#passkeys");
  const current = page.getByRole("region", { name: "Signed-in devices" }).getByRole("listitem").first();
  await expect(current).toContainText("Public device");
  await expect(current).toContainText("Passkey");
  // A passkey sign-in is a recent verification, so removing needs no confirmation.
  await page.getByRole("button", { name: "Remove Study laptop" }).click();
  await page.getByRole("alertdialog", { name: "Remove “Study laptop”?" }).getByRole("button", { name: "Remove passkey" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Passkey removed")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No passkeys yet");
  // Public device: removing is fine, adding isn't offered.
  await expect(page.getByRole("button", { name: "Add a passkey" })).toHaveCount(0);
  await expect.poll(() => passkeyNoticesFor(email)).toContainEqual(
    expect.objectContaining({ kind: "passkey-removed", passkeyName: "Study laptop" }),
  );

  // The browser still holds the credential, but it no longer signs in.
  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(FAILED);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("signs in with a recovery code on a new laptop, then adds a passkey there from the offer", async ({ browser }) => {
  const id = unique();
  const email = `laptop-${id}@example.com`;
  // On the phone: sign up and make recovery codes.
  const phoneContext = await browser.newContext();
  const phone = await phoneContext.newPage();
  await signUpAs(phone, email, `Traveller ${id}`);
  const codes = await createRecoveryCodes(phone);
  await phone.getByRole("button", { name: "I've saved my codes" }).click();
  await phoneContext.close();

  // On the laptop: no email here, so a recovery code.
  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  const authenticator = await virtualAuthenticator(laptop);
  await recoverySignIn(laptop, email, codes[0]);
  await expect(laptop).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  const offer = laptop.getByRole("region", { name: "Add a passkey on this computer?" });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Add a passkey" }).click();
  await expect(laptop.locator("[data-sileo-toast]").getByText("Passkey added")).toBeVisible({ timeout: 45_000 });
  await expect(offer).toHaveCount(0);
  expect(await authenticator.credentials()).toHaveLength(1);

  // Both emails warn the editor: the code was used, and a passkey followed it.
  await expect.poll(() => passkeyNoticesFor(email)).toEqual([
    expect.objectContaining({ kind: "passkey-added", afterRecovery: true }),
  ]);
  await expect.poll(() => recoveryNoticesFor(email)).toContainEqual(expect.objectContaining({ kind: "recovery-used" }));

  // From now on the laptop signs in with the passkey.
  await signOut(laptop);
  await passkeySignIn(laptop);
  await expect(laptop.getByRole("region", { name: "Add a passkey on this computer?" })).toHaveCount(0);
  await laptopContext.close();
});

test("the offer can be dismissed, and isn't shown after an email sign-in", async ({ browser }) => {
  const id = unique();
  const email = `notnow-${id}@example.com`;
  const phoneContext = await browser.newContext();
  const phone = await phoneContext.newPage();
  await signUpAs(phone, email, `Not Now ${id}`);
  await expect(phone.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(phone.getByRole("region", { name: "Add a passkey on this computer?" })).toHaveCount(0);
  const codes = await createRecoveryCodes(phone);
  await phone.getByRole("button", { name: "I've saved my codes" }).click();
  await phoneContext.close();

  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  await virtualAuthenticator(laptop);
  await recoverySignIn(laptop, email, codes[1]);
  const offer = laptop.getByRole("region", { name: "Add a passkey on this computer?" });
  await expect(offer).toBeVisible({ timeout: 45_000 });
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);
  await laptop.reload();
  await expect(laptop.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(offer).toHaveCount(0);
  await laptopContext.close();
});

test("a 'This isn't my device' session can't add a passkey, even after a recovery code", async ({ browser }) => {
  const id = unique();
  const email = `public-${id}@example.com`;
  const phoneContext = await browser.newContext();
  const phone = await phoneContext.newPage();
  await signUpAs(phone, email, `Library ${id}`);
  const codes = await createRecoveryCodes(phone);
  await phone.getByRole("button", { name: "I've saved my codes" }).click();
  await phoneContext.close();

  const libraryContext = await browser.newContext();
  const library = await libraryContext.newPage();
  const authenticator = await virtualAuthenticator(library);
  await recoverySignIn(library, email, codes[0], { publicDevice: true });
  await expect(library).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  await expect(library.getByRole("heading", { name: "Your poems" })).toBeVisible();
  await expect(library.getByRole("region", { name: "Add a passkey on this computer?" })).toHaveCount(0);

  await library.goto("/admin/profile#passkeys");
  await expect(library.getByRole("main")).toContainText("so a passkey can't be added here");
  await expect(library.getByRole("button", { name: "Add a passkey" })).toHaveCount(0);
  expect(await authenticator.credentials()).toHaveLength(0);
  await libraryContext.close();
});

test("after an old sign-in, adding asks for an email code and removing accepts a passkey", async ({ page }) => {
  const id = unique();
  const email = `stepup-${id}@example.com`;
  await virtualAuthenticator(page);
  await signUpAs(page, email, `Careful ${id}`);
  const age = () =>
    sql(`UPDATE sessions SET email_verified_at = now() - interval '11 minutes', passkey_verified_at = NULL
         WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await age();

  // Adding: no passkey yet, so only an emailed code can confirm.
  await page.goto("/admin/profile#passkeys");
  await expect(page.getByRole("main")).toContainText("We'll ask you to confirm it's you first.");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeFocused();
  await expect(page.getByRole("main")).toContainText("Adding a passkey needs a recent sign-in.");
  await expect(page.getByRole("button", { name: "Use a passkey" })).toHaveCount(0);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(await latestStepUpCode(email));
  await expect(page.getByRole("status").filter({ hasText: "Confirmed. Add your passkey now." })).toBeVisible();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Passkey added")).toBeVisible({ timeout: 45_000 });

  // Removing later: confirm with the passkey itself.
  await age();
  await page.reload();
  await page.getByRole("button", { name: "Remove Chrome on macOS" }).click();
  await page.getByRole("button", { name: "Remove passkey" }).click();
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Removing a passkey needs a recent sign-in.");
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Passkey removed")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("main")).toContainText("No passkeys yet");
});

test("a cancelled passkey prompt shows no error", async ({ page }) => {
  // An authenticator with nothing for this site: Chrome ends the prompt with
  // NotAllowedError, exactly what closing the browser's dialog gives.
  await virtualAuthenticator(page);
  await page.goto("/sign-in");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("autocomplete", "email webauthn");
  const button = page.getByRole("button", { name: "Sign in with a passkey" });
  await button.click();
  await expect(button).toBeEnabled();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(errorToasts(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("autofill on the email field signs in with the passkey picked there", async ({ page }) => {
  const id = unique();
  const email = `autofill-${id}@example.com`;
  // Autofill on: Chrome's virtual authenticator stands in for the person
  // picking their passkey from the email field's suggestions.
  await virtualAuthenticator(page, { autofill: true });
  await signUpAs(page, email, `Autofill ${id}`);
  await addPasskeyOnProfile(page);
  await page.goto("/admin/profile");
  await sql(`DELETE FROM sessions WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await page.context().clearCookies({ name: "poemhub_session" });
  // Straight to the dashboard, without pressing the button.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Your poems" })).toBeVisible();
  const { rows } = await sql(
    `SELECT sign_in_method FROM sessions WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`,
  );
  expect(rows.map((r) => r.sign_in_method)).toEqual(["passkey"]);
});

test("user verification is required: an unverified attempt doesn't sign in", async ({ page }) => {
  const id = unique();
  const authenticator = await virtualAuthenticator(page);
  await signUpAs(page, `unverified-${id}@example.com`, `Unverified ${id}`);
  await addPasskeyOnProfile(page);
  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await authenticator.setUserVerified(false);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/sign-in/);
  await authenticator.setUserVerified(true);
  await passkeySignIn(page);
});

test("no passkey options in a browser without WebAuthn", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    // @ts-expect-error simulate a browser without WebAuthn
    delete window.PublicKeyCredential;
  });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
  await context.close();
});
