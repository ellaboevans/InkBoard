/**
 * Captures for "What's new in InkBoard": desktop (1440 × 900 at 2×) and phone
 * (390 × 844 at 3×) screenshots of the real app, plus element boxes (CSS px) in
 * captures/wn/boxes.json for the camera, cursor and clicks. Remotion does the motion.
 *
 *   node scripts/capture-wn.ts [section …]     (Node 22; all sections when none are named)
 *
 * Needs the app on WN_BASE (default http://localhost:3357) on poemhub_dev_elm_wn, with
 * tmp/sessions-wn.json from whatsnew-fixtures.ts. Nothing here changes how the app behaves:
 * the Next dev badge and scrollbars are hidden, and two browser halves the dev server can't
 * provide are stood in for, as the app's own E2E tests do:
 *   - push: Notification permission and a PushManager subscription (e2e/push-stub.ts), so
 *     the real Follow button talks to the real API (sends go to E2E_PUSH_OUTBOX, never out);
 *   - the service worker's "save this novel" replies, in the real worker's message format
 *     ({ done, saved, total } per page, then { finished }), so the real button shows its states.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

const BASE = process.env.WN_BASE ?? "http://localhost:3357";
const OUT = new URL("../captures/wn/", import.meta.url).pathname;
const TMP = new URL("../tmp/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const HIDE = `
  nextjs-portal, [data-nextjs-dev-tools-button], [data-next-badge-root], [data-nextjs-toast] { display: none !important; }
  html, body, * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
`;
const DECOR = `(function () {
  var add = function () {
    if (document.getElementById("__wn_hide")) return;
    var s = document.createElement("style");
    s.id = "__wn_hide";
    s.textContent = ${JSON.stringify(HIDE)};
    document.documentElement.appendChild(s);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add, { once: true });
  else add();
  try { if (!localStorage.getItem("inkboard-install")) localStorage.setItem("inkboard-install", JSON.stringify({ visits: 3, visitStart: 0, lastSeen: 0, poems: [], gotIt: true })); } catch (e) {}
})();`;

/** e2e/push-stub.ts, as plain JavaScript: permission granted, a subscription that lasts across pages. */
const PUSH_STUB = `(function () {
  if (location.protocol === "about:") return;
  var P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
  var AUTH = "tBHItJI5svbpez7KI4CCXg";
  var KEY = "wn-push-state";
  var state = JSON.parse(localStorage.getItem(KEY) || "null") || { permission: "default", subscribed: false };
  var persist = function () { localStorage.setItem(KEY, JSON.stringify(state)); };
  persist();
  Object.defineProperty(Notification, "permission", { configurable: true, get: function () { return state.permission; } });
  Notification.requestPermission = function () { state.permission = "granted"; persist(); return Promise.resolve("granted"); };
  var current = null;
  var make = function (key, reuse) {
    var endpoint = localStorage.getItem("wn-push-endpoint");
    if (!endpoint || !reuse) endpoint = "https://fcm.googleapis.com/fcm/send/wn-" + Math.random().toString(36).slice(2);
    localStorage.setItem("wn-push-endpoint", endpoint);
    return {
      endpoint: endpoint, expirationTime: null, options: { userVisibleOnly: true, applicationServerKey: key },
      toJSON: function () { return { endpoint: endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }; },
      unsubscribe: function () { current = null; state.subscribed = false; persist(); return Promise.resolve(true); },
    };
  };
  var pushManager = {
    getSubscription: function () { return Promise.resolve(current); },
    subscribe: function (o) { var k = o.applicationServerKey; current = make(k instanceof Uint8Array ? k.buffer : k); state.subscribed = true; persist(); return Promise.resolve(current); },
  };
  if (state.subscribed) current = make(null, true);
  var reg = { scope: location.origin + "/", pushManager: pushManager };
  Object.defineProperty(navigator.serviceWorker, "ready", { configurable: true, get: function () { return Promise.resolve(reg); } });
  navigator.serviceWorker.getRegistration = function () { return Promise.resolve(reg); };
})();`;

/** The worker's half of "Save this novel for offline", in its own message format, a page every 320 ms. */
const SAVE_STUB = `(function () {
  if (location.protocol === "about:") return;
  var controller = {
    postMessage: function (data, ports) {
      var port = ports && ports[0];
      if (!port || !data || !Array.isArray(data.paths)) return;
      var n = data.paths.length;
      for (var i = 0; i < n; i++) (function (i) { setTimeout(function () { port.postMessage({ done: i + 1, saved: i + 1, total: n }); }, 320 * (i + 1)); })(i);
      setTimeout(function () { port.postMessage({ finished: true, saved: n, total: n }); }, 320 * n + 200);
    },
  };
  Object.defineProperty(navigator.serviceWorker, "controller", { configurable: true, get: function () { return controller; } });
})();`;

const sessions = existsSync(`${TMP}sessions-wn.json`) ? JSON.parse(readFileSync(`${TMP}sessions-wn.json`, "utf8")) : {};
const BOXES = `${OUT}boxes.json`;
const boxes: Record<string, { x: number; y: number; width: number; height: number; text?: string }> = existsSync(BOXES)
  ? JSON.parse(readFileSync(BOXES, "utf8"))
  : {};

type Ctx = { session?: string; push?: boolean; saveStub?: boolean; phone?: boolean; height?: number };

async function context(browser: Browser, o: Ctx = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(
    o.phone
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
          locale: "en-GB",
          timezoneId: "Africa/Accra",
        }
      : { viewport: { width: 1440, height: o.height ?? 900 }, deviceScaleFactor: 2, locale: "en-GB", timezoneId: "Africa/Accra" },
  );
  await ctx.addInitScript(DECOR);
  if (o.push) {
    await ctx.addInitScript(PUSH_STUB);
  }
  if (o.saveStub) await ctx.addInitScript(SAVE_STUB);
  if (o.session) await ctx.addCookies([{ name: "poemhub_session", value: o.session, url: BASE, httpOnly: true, sameSite: "Lax" }]);
  return ctx;
}

async function settle(page: Page, ms = 500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function go(page: Page, path: string, ms = 600) {
  await page.goto(BASE + path, { waitUntil: "load", timeout: 180_000 });
  await settle(page, ms);
}

async function shot(page: Page, name: string, fullPage = false) {
  const path = `${OUT}${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage, animations: "disabled", caret: "initial" });
  console.log("  ", name);
}

async function box(name: string, loc: Locator, withText = false) {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error(`No box for ${name}`);
  boxes[name] = { ...b, ...(withText ? { text: (await loc.first().innerText()).trim() } : {}) };
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });

const sections: Record<string, () => Promise<void>> = {
  /** A first look at the desktop pages this video needs (not used in the edit). */
  async explore() {
    const r = await context(browser);
    const p = await r.newPage();
    for (const [n, path] of [
      ["x-board", "/"],
      ["x-author", "/a/odalys-moon"],
      ["x-novel", "/a/odalys-moon/n/the-ferry-at-yeji"],
      ["x-chapter", "/a/odalys-moon/n/the-ferry-at-yeji/thursday"],
      ["x-ewe", "/a/amara-nwosu-bell/n/vu-la-fe-ngko/ngdi-kanyaa"],
      ["x-private", "/a/ines-calloway/n/letters-to-the-lighthouse-keeper"],
    ] as const) {
      await go(p, path, 900);
      await shot(p, `explore/${n}`);
    }
    await r.close();
    const w = await context(browser, { session: sessions.writer });
    const q = await w.newPage();
    for (const [n, path] of [
      ["x-profile", "/admin/profile"],
      ["x-novels", "/admin/novels"],
    ] as const) {
      await go(q, path, 900);
      await shot(q, `explore/${n}`, true);
    }
    await w.close();
    const o = await context(browser, { session: sessions.odalys });
    const s = await o.newPage();
    await go(s, "/admin/stats", 900);
    await shot(s, "explore/x-stats", true);
    await o.close();
  },

  /** Chapter 2: a profile photo, uploaded and cropped (an abstract picture, never a person). */
  async photo() {
    const w = await context(browser, { session: sessions.writer });
    const p = await w.newPage();
    await go(p, "/admin/profile", 900);
    await p.getByRole("button", { name: "Upload photo" }).scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollTo(0, 0));
    await settle(p, 200);
    await shot(p, "photo-0");
    await box("photo.upload", p.getByRole("button", { name: "Upload photo" }));
    const chooser = p.waitForEvent("filechooser");
    await p.getByRole("button", { name: "Upload photo" }).click();
    await (await chooser).setFiles(`${TMP}assets/abstract-photo.jpg`);
    const dialog = p.getByRole("dialog", { name: "Crop your photo" });
    await dialog.waitFor({ timeout: 60_000 });
    await settle(p, 800);
    await shot(p, "photo-crop-0");
    const zoom = dialog.getByRole("slider").first();
    await box("photo.zoom", zoom);
    await zoom.focus();
    for (let i = 0; i < 22; i++) await zoom.press("ArrowRight");
    await settle(p, 400);
    await shot(p, "photo-crop-1");
    const lr = dialog.getByRole("slider").nth(1);
    await lr.focus();
    for (let i = 0; i < 3; i++) await lr.press("ArrowLeft");
    await settle(p, 400);
    await shot(p, "photo-crop-2");
    await box("photo.save", dialog.getByRole("button", { name: "Save photo" }));
    await dialog.getByRole("button", { name: "Save photo" }).click();
    await p.locator("[data-sileo-toast]").first().waitFor({ timeout: 90_000 });
    await settle(p, 2200);
    await shot(p, "photo-saved");
    await w.close();
    // Where readers see it: the author's section on the board, and the author page.
    const r = await context(browser);
    const q = await r.newPage();
    await go(q, "/a/abla-dzifa", 1000);
    await shot(q, "photo-author");
    await go(q, "/", 1200);
    await q.locator('[data-ready="true"]').first().waitFor({ timeout: 60_000 });
    await q.getByRole("button", { name: /^Authors/ }).click();
    await q.getByRole("navigation", { name: "Authors" }).getByRole("button", { name: /^Abla Dzifa/ }).click();
    await q.waitForTimeout(1800);
    await q.getByRole("button", { name: /^Authors/ }).click();
    await q.mouse.move(1400, 880);
    await q.waitForTimeout(400);
    await shot(q, "photo-board");
    await r.close();
  },

  /** Chapter 3: a reader follows Abla Dzifa (her photo shows on her page). Push stubbed as in E2E. */
  async follow() {
    const r = await context(browser, { push: true });
    const p = await r.newPage();
    p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log("     console:", m.text().slice(0, 200)));
    p.on("response", (res) => res.url().includes("/api/push") && console.log("     ", res.request().method(), res.url().replace(BASE, ""), res.status()));
    await go(p, "/a/abla-dzifa", 1000);
    const btn = p.getByRole("button", { name: /Notify me about new poems by Abla Dzifa/ });
    await btn.waitFor({ timeout: 60_000 });
    await shot(p, "follow-0");
    await box("follow.button", btn);
    await btn.click();
    await p.getByRole("button", { name: /Abla Dzifa/, pressed: true }).waitFor({ timeout: 60_000 }).catch(() => {});
    await p.mouse.move(40, 40);
    await settle(p, 900);
    await shot(p, "follow-1");
    await r.close();
  },

  /** Chapter 4: the writer starts a novel, uploads a cover, writes and publishes chapter 1. */
  async novelsadmin() {
    const w = await context(browser, { session: sessions.writer });
    const p = await w.newPage();
    await go(p, "/admin/novels", 900);
    await shot(p, "nadmin-0");
    await box("nadmin.new", p.getByRole("button", { name: "New novel" }));
    await p.getByRole("button", { name: "New novel" }).click();
    const d = p.getByRole("dialog", { name: "New novel" });
    await d.waitFor();
    await settle(p, 400);
    await shot(p, "nadmin-dialog-0");
    await d.getByLabel("Title").fill("Harmattan Mornings");
    await d.getByLabel(/^Blurb/).click();
    await d.getByLabel(/^Blurb/).pressSequentially("Twelve dry-season mornings in a Ho compound, told by the girl who sweeps the yard before anyone wakes.", { delay: 4 });
    await settle(p, 200);
    await shot(p, "nadmin-dialog-1");
    await box("nadmin.blurbhelp", d.locator("#new-novel-blurb-help"));
    await box("nadmin.language", d.locator("#new-novel-language"));
    await box("nadmin.status", d.locator("#new-novel-status"));
    await d.locator("#new-novel-language").click();
    await p.getByRole("listbox").waitFor();
    await settle(p, 300);
    await shot(p, "nadmin-dialog-lang");
    await p.getByRole("option", { name: "English", exact: true }).click();
    await settle(p, 300);
    await d.locator("#new-novel-status").click();
    await p.getByRole("listbox").waitFor();
    await settle(p, 300);
    await shot(p, "nadmin-dialog-status");
    await p.keyboard.press("Escape");
    await settle(p, 300);
    await shot(p, "nadmin-dialog-2");
    await box("nadmin.create", d.getByRole("button", { name: "Create novel" }));
    await d.getByRole("button", { name: "Create novel" }).click();
    await p.waitForURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 120_000 });
    await settle(p, 1000);
    await shot(p, "nadmin-novel-0");
    // The cover.
    const up = p.getByRole("button", { name: "Upload cover" });
    await box("nadmin.upload", up);
    const chooser = p.waitForEvent("filechooser");
    await up.click();
    await (await chooser).setFiles(`${TMP}assets/harmattan-cover.jpg`);
    const crop = p.getByRole("dialog", { name: "Crop the cover" });
    await crop.waitFor({ timeout: 60_000 });
    await settle(p, 800);
    await shot(p, "nadmin-crop");
    await box("nadmin.coversave", crop.getByRole("button", { name: "Save cover" }));
    await crop.getByRole("button", { name: "Save cover" }).click();
    await p.locator("[data-sileo-toast]").first().waitFor({ timeout: 90_000 });
    await settle(p, 900);
    await shot(p, "nadmin-novel-1");
    // Chapter 1, with a drop cap.
    const add = p.getByRole("button", { name: "New chapter" });
    await add.scrollIntoViewIfNeeded();
    await box("nadmin.newchapter", add);
    await add.click();
    await p.waitForURL(/chapters\//, { timeout: 120_000 });
    await settle(p, 1000);
    await shot(p, "chapter-ed-0");
    await p.locator("input#title").fill("Dust");
    const body = p.locator("textarea:visible").first();
    await body.click();
    await body.pressSequentially("Esi woke before the cocks, the way she always did in the harmattan, and swept the yard while the whole compound slept.", { delay: 3 });
    await body.press("Enter");
    await body.press("Enter");
    await body.pressSequentially("The dust came in from the north overnight. It sat on the water pot and on the bench and on the leaves of the mango tree, fine as flour.", { delay: 3 });
    await body.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(5, 5));
    await settle(p, 300);
    await shot(p, "chapter-ed-1");
    const cap = p.getByRole("button", { name: /^Drop cap/ });
    await box("chapter.dropcapbtn", cap);
    await cap.click();
    await settle(p, 400);
    await shot(p, "chapter-ed-2");
    await p.getByRole("tab", { name: "Preview" }).click();
    await settle(p, 600);
    await shot(p, "chapter-ed-preview");
    await box("chapter.previewtab", p.getByRole("tab", { name: "Preview" }));
    await p.getByRole("tab", { name: /Write/ }).click();
    const pub = p.getByRole("button", { name: "Publish chapter" });
    await pub.scrollIntoViewIfNeeded();
    await settle(p, 300);
    await shot(p, "chapter-ed-3");
    await box("chapter.publish", pub);
    await pub.click();
    await p.locator("[data-sileo-toast]").first().waitFor({ timeout: 120_000 });
    await settle(p, 900);
    await shot(p, "chapter-ed-published");
    await w.close();
  },

  /** Not filmed: a second publish after the chapter, so the outbox holds the real grouped update. */
  async poempub() {
    const w = await context(browser, { session: sessions.writer });
    const p = await w.newPage();
    await go(p, "/admin/poems/new", 900);
    await p.getByLabel("Title").fill("Dust Season");
    await p.locator("textarea#body").fill("the yard swept twice\nand still the wind\nleaves its signature");
    await p.getByRole("button", { name: "Publish to board" }).click();
    await p.waitForURL(/published=/, { timeout: 120_000 });
    await settle(p, 600);
    await w.close();
  },

  /** After fixtures add two drafts: the chapter order, and one moved up. */
  async order() {
    const w = await context(browser, { session: sessions.writer });
    const p = await w.newPage();
    await go(p, "/admin/novels", 600);
    await p.getByRole("link", { name: /Harmattan Mornings/ }).first().click();
    await p.waitForURL(/\/admin\/novels\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await settle(p, 900);
    await p.getByRole("heading", { name: "Chapters" }).scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -120));
    await settle(p, 300);
    await shot(p, "order-0");
    const up = p.getByRole("button", { name: "Move “Market Road” up" });
    await box("order.up", up);
    await box("order.list", p.getByRole("heading", { name: "Chapters" }).locator("xpath=ancestor::section[1]"));
    await up.click();
    await settle(p, 1400);
    await shot(p, "order-1");
    await w.close();
  },

  /** Chapter 5: reading novels (desktop), the Ewe chapter, Continue, offline, and the feed. */
  async readers() {
    const r = await context(browser, { saveStub: true });
    const p = await r.newPage();
    await go(p, "/", 1200);
    await p.locator('[data-ready="true"]').first().waitFor({ timeout: 60_000 });
    await p.getByRole("button", { name: /^Authors/ }).click();
    await p.getByRole("navigation", { name: "Authors" }).getByRole("button", { name: /^Odalys Moon/ }).click();
    await p.waitForTimeout(1800);
    await p.getByRole("button", { name: /^Authors/ }).click();
    await p.mouse.move(1400, 880);
    await p.waitForTimeout(400);
    await shot(p, "read-board");
    await box("read.book", p.locator('a[href="/a/odalys-moon/n/the-ferry-at-yeji"]').first());
    await go(p, "/a/odalys-moon/n/the-ferry-at-yeji", 900);
    await shot(p, "read-novel");
    await go(p, "/a/odalys-moon/n/the-ferry-at-yeji/thursday", 900);
    await shot(p, "read-chapter");
    await box("read.dropcap", p.locator(".prose-drop-cap").first());
    await go(p, "/a/amara-nwosu-bell/n/vu-la-fe-ngko/ngdi-kanyaa", 900);
    await shot(p, "read-ewe");
    await box("read.ewe", p.locator("[data-chapter-text]").first());
    // Continue where you stopped: chapter 2 read, then back to the novel page.
    await go(p, "/a/odalys-moon/n/the-ferry-at-yeji/the-radio", 900);
    await go(p, "/a/odalys-moon/n/the-ferry-at-yeji", 1200);
    await shot(p, "read-continue");
    await box("read.continue", p.getByRole("link", { name: /Continue/ }));
    const save = p.getByRole("button", { name: "Save this novel for offline" });
    await box("read.save", save);
    await save.click();
    await p.waitForTimeout(800);
    await shot(p, "read-saving");
    await p.getByText(/Saved \d+ of \d+ pages/).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await settle(p, 400);
    await shot(p, "read-saved");
    await box("read.feed", p.getByRole("link", { name: /Follow this novel in a feed reader/ }));
    await r.close();
    // Text settings on a phone.
    const ph = await context(browser, { phone: true });
    const q = await ph.newPage();
    await go(q, "/a/odalys-moon/n/the-ferry-at-yeji/thursday", 900);
    await shot(q, "ts-0");
    await q.getByRole("button", { name: "Text settings" }).click();
    const pop = q.getByRole("dialog", { name: "Text settings" });
    await pop.waitFor();
    await q.waitForTimeout(400);
    await shot(q, "ts-1");
    await box("ts.larger", pop.locator("label", { hasText: /^Larger$/ }));
    await pop.locator("label", { hasText: /^Larger$/ }).first().click();
    await q.waitForTimeout(450);
    await shot(q, "ts-2");
    await box("ts.sans", pop.locator("label", { hasText: /^Sans$/ }));
    await pop.locator("label", { hasText: /^Sans$/ }).first().click();
    await q.waitForTimeout(450);
    await shot(q, "ts-3");
    await pop.locator("label", { hasText: /^Default$/ }).first().click();
    await pop.locator("label", { hasText: /Book serif/ }).first().click();
    await ph.close();
  },

  /** Chapter 6: a private novel: one password opens the whole book. */
  async private() {
    const r = await context(browser);
    const p = await r.newPage();
    await go(p, "/a/ines-calloway/n/letters-to-the-lighthouse-keeper", 900);
    await shot(p, "priv-novel");
    await box("priv.lock", p.getByText("Password protected.").first());
    await go(p, "/a/ines-calloway/n/letters-to-the-lighthouse-keeper/the-first-letter", 900);
    const pw = p.locator("input#novel-password");
    await pw.click();
    await settle(p, 200);
    await shot(p, "priv-0");
    await box("priv.field", pw);
    await pw.pressSequentially("moonlight", { delay: 30 });
    await shot(p, "priv-1");
    await box("priv.unlock", p.getByRole("button", { name: "Unlock novel" }));
    await p.getByRole("button", { name: "Unlock novel" }).click();
    await p.locator("[data-chapter-text]").first().waitFor({ timeout: 90_000 });
    await settle(p, 900);
    await shot(p, "priv-open");
    await go(p, "/a/ines-calloway/n/letters-to-the-lighthouse-keeper/his-reply", 1000);
    await shot(p, "priv-next");
    await r.close();
  },

  /** Chapter 7: share a passage (phone): ticks, trims, the count, the picture. */
  async passage() {
    const ph = await context(browser, { phone: true });
    const p = await ph.newPage();
    let lastPicture = "";
    p.on("request", (req) => /share-image\?passage=/.test(req.url()) && (lastPicture = req.url()));
    await go(p, "/a/odalys-moon/n/the-ferry-at-yeji/market-day", 900);
    await p.getByRole("button", { name: "Share a passage" }).click();
    const sheet = p.getByRole("dialog");
    await sheet.waitFor();
    await p.waitForTimeout(900);
    const ticks = sheet.getByRole("checkbox");
    await ticks.first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await shot(p, "pas-0");
    await box("pas.tick1", ticks.nth(0));
    await ticks.nth(0).click();
    await p.waitForTimeout(500);
    await shot(p, "pas-1");
    await box("pas.tick2", ticks.nth(1));
    await ticks.nth(1).click();
    await p.waitForTimeout(500);
    await box("pas.tick3", ticks.nth(2));
    await ticks.nth(2).click();
    await p.waitForTimeout(700);
    await shot(p, "pas-2");
    const start = sheet.getByRole("combobox").first();
    await start.scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await shot(p, "pas-3");
    await box("pas.start", start);
    await box("pas.count", sheet.getByText(/of 600 characters/).first(), true);
    await start.click();
    await p.getByRole("listbox").waitFor();
    await p.waitForTimeout(400);
    await shot(p, "pas-start-open");
    await p.getByRole("option").nth(1).click();
    await p.waitForTimeout(700);
    await shot(p, "pas-4");
    await box("pas.count2", sheet.getByText(/of 600 characters/).first(), true);
    const end = sheet.getByRole("combobox").nth(1);
    await box("pas.end", end);
    await end.click();
    await p.getByRole("listbox").waitFor();
    await p.waitForTimeout(400);
    await shot(p, "pas-end-open");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    // The picture for this pick: the sheet's own image request.
    await p.waitForTimeout(900);
    if (lastPicture) {
      const res = await fetch(lastPicture);
      writeFileSync(`${OUT}pic-passage.png`, Buffer.from(await res.arrayBuffer()));
      console.log("   pic-passage", lastPicture.replace(BASE, ""), res.status, res.headers.get("x-share-address"));
    }
    await sheet.locator("img").first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(500);
    await shot(p, "pas-5");
    await ph.close();
  },

  /** Chapter 1: share a poem as an image (phone): designs, sizes, picked lines. */
  async share() {
    const ph = await context(browser, { phone: true });
    const p = await ph.newPage();
    await go(p, "/p/abla-dzifa/akwaaba", 900);
    await shot(p, "sh-poem");
    await box("sh.button", p.getByRole("button", { name: "Share as image" }).first());
    await p.getByRole("button", { name: "Share as image" }).first().click();
    const sheet = p.getByRole("dialog");
    await sheet.waitFor();
    const loaded = async () => {
      await p.waitForFunction(() => {
        const d = document.querySelector("[role=dialog]");
        if (!d || d.querySelector(".animate-spin")) return false;
        const imgs = [...d.querySelectorAll("img")] as HTMLImageElement[];
        return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
      }, null, { timeout: 120_000 });
      await p.waitForTimeout(700);
    };
    const pick = async (label: RegExp, name: string, wait = true) => {
      await box(`sh.${name}`, sheet.locator("label", { hasText: label }));
      await sheet.locator("label", { hasText: label }).first().click();
      if (wait) await loaded();
      else await p.waitForTimeout(600);
      await shot(p, `sh-${name}`);
    };
    await loaded();
    await shot(p, "sh-0");
    await pick(/^Ink/, "ink");
    await pick(/^Board/, "board");
    await pick(/^Chat/, "chat");
    await pick(/^Choose lines/, "choose", false);
    const lines = sheet.getByRole("checkbox");
    await lines.first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await shot(p, "sh-lines-0");
    await box("sh.line1", lines.nth(0));
    await lines.nth(0).click();
    await box("sh.line2", lines.nth(1));
    await lines.nth(1).click();
    await p.waitForTimeout(600);
    await loaded();
    await shot(p, "sh-lines-2");
    await p.waitForTimeout(600);
    await sheet.locator("img").first().scrollIntoViewIfNeeded();
    await loaded();
    await shot(p, "sh-lines-pic");
    await ph.close();
    // The pictures themselves.
    const get = async (path: string, file: string) => {
      const res = await fetch(BASE + path);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      writeFileSync(`${OUT}${file}`, Buffer.from(await res.arrayBuffer()));
      console.log("  ", file, res.headers.get("x-share-address"), res.headers.get("x-share-lines-shown"));
      boxes[`addr.${file}`] = { x: 0, y: 0, width: 0, height: 0, text: res.headers.get("x-share-address") ?? "" };
    };
    await get("/p/abla-dzifa/akwaaba/share-image", "pic-story-page.png");
    await get("/p/abla-dzifa/akwaaba/share-image?design=ink", "pic-story-ink.png");
    await get("/p/abla-dzifa/akwaaba/share-image?format=chat&design=board", "pic-chat-board.png");
    await get("/p/abla-dzifa/akwaaba/share-image?format=chat&design=board&lines=1-2", "pic-chat-lines.png");
    await get("/p/selorm-agbo/ngdi/share-image?design=ink", "pic-ndi-ink.png");
  },

  /** The novel's own feed, as a feed reader gets it (run with APP_URL = the live domain). */
  async feed() {
    const feed = await (await fetch(BASE + "/a/odalys-moon/n/the-ferry-at-yeji/feed.xml")).text();
    writeFileSync(`${OUT}ferry-feed.xml`, feed);
    console.log("   ferry-feed.xml", feed.length);
  },

  /** Chapter 8: Stats for Odalys Moon, at three scroll positions. */
  async stats() {
    const o = await context(browser, { session: sessions.odalys });
    const p = await o.newPage();
    await go(p, "/admin/stats", 900);
    await shot(p, "stats-0");
    await box("stats.followers", p.getByText("128", { exact: true }).first(), true);
    for (const [name, heading] of [["stats-1", "Shared links"], ["stats-2", "Novels"]] as const) {
      const h = p.getByRole("heading", { name: heading, exact: true });
      await h.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110));
      await settle(p, 400);
      await shot(p, name);
      boxes[`${name}.scroll`] = { x: 0, y: await p.evaluate(() => window.scrollY), width: 0, height: 0 };
    }
    await o.close();
  },
};

const wanted = process.argv.slice(2);
try {
  for (const [name, run] of Object.entries(sections)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(name);
    await run();
    writeFileSync(BOXES, JSON.stringify(boxes, null, 1));
  }
} finally {
  await browser.close();
}

export { box, context, go, settle, shot };
