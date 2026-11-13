import { expect, test } from "@playwright/test";
import { alertsFor, latestCode, requestCode, signUpAs, sql, typeCode } from "./helpers";

test.beforeEach(() => sql("DELETE FROM rate_limits"));

// Every local request comes from ::1, so networks are simulated with the
// X-Forwarded-For header (the app trusts one proxy hop by default).
test("signing in from a new network emails the editor a security notice", async ({ browser }) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `alert-${id}@example.com`;

  const home = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.10" } });
  const homePage = await home.newPage();
  await signUpAs(homePage, email, `Alert Poet ${id}`);
  // First sign-in ever: nothing to compare against, so no notice.
  expect(await alertsFor(email)).toEqual([]);
  await home.close();

  const away = await browser.newContext({
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.20" },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  });
  const awayPage = await away.newPage();
  await sql("DELETE FROM rate_limits"); // skip the resend cooldown
  const firstCode = await latestCode(email);
  await requestCode(awayPage, email);
  await expect.poll(() => latestCode(email)).not.toBe(firstCode);
  await typeCode(awayPage, await latestCode(email));
  await expect(awayPage).toHaveURL(/\/admin/, { timeout: 45_000 });

  await expect.poll(() => alertsFor(email)).toEqual([
    expect.objectContaining({ device: "Edge on Windows", ip: "198.51.100.20" }),
  ]);
  await away.close();
});

test("a new device on the same network also gets a notice; the same browser again doesn't", async ({ browser }) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `device-${id}@example.com`;
  const sameWifi = { extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.30" } };

  const laptop = await browser.newContext(sameWifi);
  const laptopPage = await laptop.newPage();
  await signUpAs(laptopPage, email, `Device Poet ${id}`);
  expect(await alertsFor(email)).toEqual([]);

  // A second machine (fresh browser, no device cookie) behind the same public IP.
  const desktop = await browser.newContext(sameWifi);
  const desktopPage = await desktop.newPage();
  await sql("DELETE FROM rate_limits");
  let previous = await latestCode(email);
  await requestCode(desktopPage, email);
  await expect.poll(() => latestCode(email)).not.toBe(previous);
  await typeCode(desktopPage, await latestCode(email));
  await expect(desktopPage).toHaveURL(/\/admin/, { timeout: 45_000 });
  await expect.poll(() => alertsFor(email)).toEqual([
    expect.objectContaining({ ip: "203.0.113.30", reason: "device" }),
  ]);

  // Signing out and back in on that machine stays quiet: the device cookie outlives the session.
  await desktop.clearCookies({ name: /session/ });
  await sql("DELETE FROM rate_limits");
  previous = await latestCode(email);
  await requestCode(desktopPage, email);
  await expect.poll(() => latestCode(email)).not.toBe(previous);
  await typeCode(desktopPage, await latestCode(email));
  await expect(desktopPage).toHaveURL(/\/admin/, { timeout: 45_000 });
  expect(await alertsFor(email)).toHaveLength(1);

  await laptop.close();
  await desktop.close();
});
