import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { fakePush } from "../e2e/push-stub";
import { FIXTURES_FILE, OFFLINE_BASE_URL, OFFLINE_DATABASE_URL } from "./constants";

/*
 * Notifications about new poems (docs/PLAN.md, Phase 18) against the
 * production build and its real service worker. Pushes are delivered with
 * CDP's ServiceWorker.deliverPushMessage: the worker's own `push` handler
 * runs exactly as for a push from a push service, but no push service is
 * involved (headless Chrome can't subscribe at one; see
 * docs/research/push-notifications.md §6.4). Clicks are synthetic
 * `notificationclick` events, which carry no user activation, so they show
 * the navigation, not the focus or openWindow a real tap allows.
 */

type Poem = { id: string; slug: string };
const F = JSON.parse(readFileSync(FIXTURES_FILE, "utf8")) as { read: Poem; unread: Poem; secret: Poem };
const url = (p: Poem) => `/p/offline-poet/${p.slug}`;

async function query(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: OFFLINE_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

/** Open the board and wait until the worker controls the page. */
async function withWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function deliver(context: BrowserContext, page: Page, data: unknown) {
  const cdp = await context.newCDPSession(page);
  const registrationId = await new Promise<string>((resolve) => {
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e: { registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] }) => {
      const r = e.registrations.find((x) => x.scopeURL === `${OFFLINE_BASE_URL}/` && !x.isDeleted);
      if (r) resolve(r.registrationId);
    });
    void cdp.send("ServiceWorker.enable");
  });
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: OFFLINE_BASE_URL,
    registrationId,
    data: typeof data === "string" ? data : JSON.stringify(data),
  });
}

const shown = (page: Page) =>
  page.evaluate(async () =>
    (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
      title: n.title,
      body: n.body,
      icon: n.icon,
      badge: n.badge,
      tag: n.tag,
      data: n.data as unknown,
    })),
  );

const inPagesCache = (page: Page, path: string) =>
  page.evaluate(async (path) => {
    for (const name of await caches.keys()) {
      if (name.startsWith("inkboard-pages-") && (await (await caches.open(name)).match(path))) return true;
    }
    return false;
  }, path);

test("a push shows the poem's title, 'New poem by …', icon, badge and tag, and saves the poem for offline reading", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["notifications"] });
  const page = await context.newPage();
  await withWorker(page);
  const poem = url(F.unread);
  expect(await inPagesCache(page, poem)).toBe(false);

  await deliver(context, page, { title: "Salt", author: "Offline Poet", url: poem, tag: `poem:${F.unread.id}` });
  await expect.poll(() => shown(page)).toEqual([
    {
      title: "Salt",
      body: "New poem by Offline Poet",
      icon: `${OFFLINE_BASE_URL}/icons/192.png`,
      badge: `${OFFLINE_BASE_URL}/icons/badge-96.png`,
      tag: `poem:${F.unread.id}`,
      data: { url: poem },
    },
  ]);
  // The badge icon exists (white on transparency, for Android's status bar).
  const badge = await page.request.get("/icons/badge-96.png");
  expect(badge.status()).toBe(200);
  expect(badge.headers()["content-type"]).toBe("image/png");

  // Saved under the offline rules, so tapping it works with no connection.
  await expect.poll(() => inPagesCache(page, poem)).toBe(true);
  await context.setOffline(true);
  const reader = await context.newPage();
  await reader.goto(poem);
  await expect(reader.getByRole("heading", { level: 1, name: "Salt" })).toBeVisible();
  await context.setOffline(false);

  // A second push for the same poem replaces the first (one tag per poem).
  await deliver(context, page, { title: "Salt", author: "Offline Poet", url: poem, tag: `poem:${F.unread.id}` });
  await page.waitForTimeout(500);
  expect(await shown(page)).toHaveLength(1);
  await context.close();
});

test("a malformed push still shows a notification (no silent pushes), linking only to the board", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["notifications"] });
  const page = await context.newPage();
  await withWorker(page);
  await deliver(context, page, "not json");
  await deliver(context, page, { title: "Elsewhere", author: "x", url: "https://evil.example/p/a/b", tag: "poem:x" });
  await expect.poll(async () => (await shown(page)).length).toBe(1); // same fallback tag: replaced
  expect((await shown(page))[0]).toMatchObject({ title: "Elsewhere", tag: "inkboard", data: { url: "/" } });
  await context.close();
});

test("a private poem's page is never saved by a push (the offline rules still apply)", async ({ browser }) => {
  // Private poems are never announced (server side); this is the worker's own safety net.
  const context = await browser.newContext({ permissions: ["notifications"] });
  const page = await context.newPage();
  await withWorker(page);
  await deliver(context, page, { title: "Old Letters", author: "Offline Poet", url: url(F.secret), tag: `poem:${F.secret.id}` });
  await expect.poll(async () => (await shown(page)).length).toBe(1);
  await page.waitForTimeout(1500);
  expect(await inPagesCache(page, url(F.secret))).toBe(false);
  await context.close();
});

test("a click takes an open InkBoard window to the poem", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["notifications"] });
  const page = await context.newPage();
  await withWorker(page);
  await deliver(context, page, { title: "Low Tide Inventory", author: "Offline Poet", url: url(F.read), tag: `poem:${F.read.id}` });
  await expect.poll(async () => (await shown(page)).length).toBe(1);

  const sw = context.serviceWorkers().find((w) => w.url().startsWith(OFFLINE_BASE_URL))!;
  const outcome = await sw.evaluate(async () => {
    const g = self as unknown as {
      registration: ServiceWorkerRegistration;
      NotificationEvent: new (type: string, init: { notification: Notification }) => Event;
    };
    const [n] = await g.registration.getNotifications();
    const ev = new g.NotificationEvent("notificationclick", { notification: n });
    let done: Promise<unknown> = Promise.resolve();
    (ev as unknown as { waitUntil(p: Promise<unknown>): void }).waitUntil = (p) => {
      done = p;
    };
    self.dispatchEvent(ev);
    try {
      const client = (await done) as { url?: string } | undefined;
      return { url: client?.url ?? null, left: (await g.registration.getNotifications()).length };
    } catch (e) {
      return { error: String(e) };
    }
  });
  expect(outcome).toEqual({ url: `${OFFLINE_BASE_URL}${url(F.read)}`, left: 0 });
  await expect(page).toHaveURL(`${OFFLINE_BASE_URL}${url(F.read)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Low Tide Inventory" })).toBeVisible();
  await context.close();
});

test("when the app opens with notifications on, a subscription the server lost is registered again, quietly", async ({ browser }) => {
  // The browser's subscription is stubbed (no push service in headless
  // Chrome); the worker registration, the re-check and the server are real.
  await query("DELETE FROM push_subscriptions");
  const context = await browser.newContext();
  await fakePush(context, { permission: "granted", subscribed: true });
  const page = await context.newPage();
  await page.goto("/");
  const endpoint = await page.evaluate(() => (window as unknown as { __pushEndpoint: () => string }).__pushEndpoint());
  await expect.poll(async () => (await query("SELECT endpoint FROM push_subscriptions")).rows.map((r) => r.endpoint)).toEqual([endpoint]);
  expect(await page.evaluate(() => (window as unknown as { __push: { prompts: number } }).__push.prompts)).toBe(0);

  // The server loses it (e.g. cleaned up): the next time the app opens, it's back.
  await query("DELETE FROM push_subscriptions");
  const later = await context.newPage();
  await later.goto("/");
  await expect.poll(async () => (await query("SELECT endpoint FROM push_subscriptions")).rows.map((r) => r.endpoint)).toEqual([endpoint]);
  await context.close();
  await query("DELETE FROM push_subscriptions");
});
