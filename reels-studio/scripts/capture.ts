/**
 * Captures for the launch reel: phone-size screenshots (390 × 844 CSS px at 3×)
 * of the real app, plus the boxes of the elements the camera and the tap
 * ripples aim at (captures/boxes.json, CSS px). Remotion does all the motion.
 *
 *   node scripts/capture.ts [section …]     (all sections when none are named)
 *
 * Needs the app running on REEL_BASE (default http://localhost:3263) on the reel
 * database, with tmp/sessions.json from reel-fixtures.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { dirname } from "node:path";

/**
 * Capture helpers: the installed Chrome through playwright-core, at phone size
 * (390 × 844 CSS px at 3×), with the Next dev badge, toasts' devtools and
 * scrollbars hidden. Nothing here changes how the app behaves.
 */

const BASE = process.env.REEL_BASE ?? "http://localhost:3263";
const OUT = new URL("../captures/", import.meta.url).pathname;

const HIDE = `
  nextjs-portal, [data-nextjs-dev-tools-button], [data-next-badge-root], [data-nextjs-toast] { display: none !important; }
  html, body, * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  * { caret-color: #852e2c; }
`;

const DECOR = `(function () {
  var add = function () {
    if (document.getElementById("__reel_hide")) return;
    var s = document.createElement("style");
    s.id = "__reel_hide";
    s.textContent = ${JSON.stringify(HIDE)};
    document.documentElement.appendChild(s);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add, { once: true });
  else add();
})();`;

async function launch(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--disable-gpu-sandbox"] });
}

async function phone(browser: Browser, opts: { session?: string; width?: number; height?: number } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    timezoneId: "Africa/Accra",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await ctx.addInitScript(DECOR);
  // The install card is a separate story: mark it as dismissed for these captures.
  await ctx.addInitScript(`try { if (!localStorage.getItem("inkboard-install")) localStorage.setItem("inkboard-install", JSON.stringify({ visits: 3, visitStart: 0, lastSeen: 0, poems: [], gotIt: true })); } catch (e) {}`);
  if (opts.session) {
    await ctx.addCookies([{ name: "poemhub_session", value: opts.session, url: BASE, httpOnly: true, sameSite: "Lax" }]);
  }
  return ctx;
}

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  const path = `${OUT}${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, clip, animations: "disabled", caret: "initial" });
  console.log("  ", name);
  return path;
}

async function settle(page: Page, ms = 400) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

const sessions = JSON.parse(readFileSync(new URL("../tmp/sessions.json", import.meta.url), "utf8"));
const BOXES = `${OUT}boxes.json`;
const boxes: Record<string, { x: number; y: number; width: number; height: number; text?: string }> = existsSync(BOXES)
  ? JSON.parse(readFileSync(BOXES, "utf8"))
  : {};

async function box(name: string, loc: Locator, withText = false) {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error(`No box for ${name}`);
  boxes[name] = { ...b, ...(withText ? { text: (await loc.first().innerText()).trim() } : {}) };
}

async function pickAuthor(page: Page, penName: string) {
  const nav = page.getByRole("navigation", { name: "Authors" });
  await nav.waitFor();
  await nav.getByRole("button", { name: new RegExp(`^${penName}`) }).click();
  await steadyZoom(page);
}

/** The zoom label once the camera has stopped moving. */
async function steadyZoom(page: Page): Promise<number> {
  const label = page.getByRole("button", { name: /^Zoom \d+%/ });
  let last = "", same = 0;
  for (let i = 0; i < 60 && same < 4; i++) {
    await page.waitForTimeout(150);
    const now = (await label.getAttribute("aria-label")) ?? "";
    same = now === last ? same + 1 : 0;
    last = now;
  }
  return Number(/(\d+)%/.exec(last)?.[1] ?? 0);
}

/** Zoom in on the screen's centre until the cards are readable. */
async function readable(page: Page, target = 90) {
  for (let i = 0; i < 8; i++) {
    const z = await steadyZoom(page);
    if (z * 1.25 > target * 1.15 || z >= target) return z;
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
}

/** Drag the board so the target sits at (fx, fy) of the screen (fractions). */
async function centerOn(page: Page, target: Locator, fx = 0.5, fy = 0.52) {
  for (let pass = 0; pass < 3; pass++) {
    const b = await target.first().boundingBox();
    if (!b) throw new Error("target has no box");
    const dx = 390 * fx - (b.x + b.width / 2);
    const dy = 844 * fy - (b.y + b.height / 2);
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) break;
    // Start the drag on empty canvas, between cards' gaps doesn't matter: a drag never clicks.
    const sx = 195, sy = 760;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    const steps = 14;
    for (let i = 1; i <= steps; i++) await page.mouse.move(sx + (dx * i) / steps, sy + (dy * i) / steps);
    await page.mouse.up();
    await page.waitForTimeout(350);
  }
}

const card = (page: Page, title: string) => page.locator("[data-card]", { has: page.locator("[data-poem-id]", { hasText: title }) });
const book = (page: Page, href: string) => page.locator(`a[href="${href}"]`).locator("xpath=ancestor::*[@data-card or contains(@class,'rounded')][1]");

async function openBoardAt(page: Page, penName: string) {
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 180_000 });
  await page.locator('[data-ready="true"]').first().waitFor({ timeout: 60_000 });
  await settle(page, 500);
  await page.getByRole("button", { name: /^Authors/ }).click();
  await pickAuthor(page, penName);
  await readable(page);
  await page.waitForTimeout(300);
}

const browser = await launch();

const sections: Record<string, () => Promise<void>> = {
  /** Hook + whip: the board on Selorm Agbɔ's section, the Ewe card "Ŋdi", and two other sections. */
  async board() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await openBoardAt(page, "Selorm Agbɔ");
    await centerOn(page, card(page, "Ŋdi"), 0.5, 0.5);
    await page.waitForTimeout(300);
    await shot(page, "board-selorm");
    await box("board-selorm.ndi", card(page, "Ŋdi"));
    const targets = [
      ["Ama Sɛwaa", "board-ama", () => card(page, "Sankɔfa")],
      ["Naa Oyoo", "board-naa", () => card(page, "Oyiwala dɔŋŋ")],
      ["Odalys Moon", "board-odalys", () => book(page, "/a/odalys-moon/n/the-ferry-at-yeji")],
      ["Ines Calloway", "board-ines", () => book(page, "/a/ines-calloway/n/letters-to-the-lighthouse-keeper")],
      ["Juniper Vale", "board-juniper", () => book(page, "/a/juniper-vale/n/odo-ne-ekaa")],
    ] as const;
    for (const [pen, file, target] of targets) {
      await page.getByRole("button", { name: /^Authors/ }).click();
      await pickAuthor(page, pen);
      await readable(page);
      await centerOn(page, target(), 0.5, 0.5);
      await page.waitForTimeout(300);
      await shot(page, file);
      await box(`${file}.target`, target());
    }
    await ctx.close();
  },

  /** The Ewe poem in the reading overlay (a soft navigation from the board). */
  async overlay() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await openBoardAt(page, "Selorm Agbɔ");
    await centerOn(page, card(page, "Ŋdi"), 0.5, 0.5);
    await page.locator("[data-poem-id]", { hasText: "Ŋdi" }).first().click();
    await page.getByRole("dialog").getByRole("heading", { name: "Ŋdi" }).waitFor({ timeout: 60_000 });
    await settle(page, 2000);
    await shot(page, "overlay-ndi");
    await ctx.close();
  },

  /** Sign-in: the email, then the code typed digit by digit (the real code from the outbox). */
  async signin() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await page.goto(BASE + "/sign-in", { waitUntil: "load", timeout: 180_000 });
    await settle(page);
    const email = page.getByLabel("Email");
    await email.click();
    await email.pressSequentially("abla.dzifa@example.com", { delay: 20 });
    await shot(page, "signin-email");
    const outbox = new URL("../tmp/outbox.jsonl", import.meta.url).pathname;
    const before = existsSync(outbox) ? readFileSync(outbox, "utf8").split("\n").filter(Boolean).length : 0;
    await page.getByRole("button", { name: /Email me a sign-in code/ }).click();
    const code = await (async () => {
      for (let i = 0; i < 120; i++) {
        const lines = existsSync(outbox) ? readFileSync(outbox, "utf8").split("\n").filter(Boolean) : [];
        const fresh = lines.slice(before).map((l) => JSON.parse(l)).filter((m) => !m.kind && m.to === "abla.dzifa@example.com");
        if (fresh.length) return String(fresh.at(-1).code);
        await page.waitForTimeout(500);
      }
      throw new Error("No code in the outbox");
    })();
    const otp = page.locator('input[autocomplete="one-time-code"]').first();
    await otp.waitFor({ timeout: 60_000 });
    await settle(page, 600);
    await shot(page, "signin-code-0");
    await box("signin.code", page.locator("[data-input-otp-container]").or(otp.locator("xpath=..")).first());
    await otp.focus();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.type(code[i]);
      await page.waitForTimeout(150);
      await shot(page, `signin-code-${i + 1}`);
    }
    await page.keyboard.type(code[5]);
    await page.waitForTimeout(250);
    await shot(page, "signin-code-6");
    await page.waitForURL(/\/admin/, { timeout: 90_000 }).catch(() => {});
    await settle(page, 800);
    await shot(page, "signin-done");
    await ctx.close();
  },

  /** The editor: the title, then a line in Twi and one in Ga through the Special letters bar. */
  async editor() {
    const ctx = await phone(browser, { session: sessions.writer });
    const page = await ctx.newPage();
    await page.goto(BASE + "/admin/poems/new", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 600);
    await page.getByLabel("Title").click();
    await page.getByLabel("Title").pressSequentially("Akwaaba", { delay: 30 });
    await page.getByRole("button", { name: /Special letters/ }).click();
    await page.getByRole("tab", { name: "Ga" }).click();
    await page.waitForTimeout(300);
    const body = page.locator("textarea#body");
    // Shorten the poem box (what its resize handle does), so the lines and the open bar share the screen.
    await body.evaluate((el) => {
      const t = el as HTMLElement;
      t.style.minHeight = "0";
      t.style.height = "200px";
    });
    await page.evaluate(() => window.scrollTo(0, 60));
    await body.click();
    await settle(page, 300);
    await shot(page, "editor-0");
    await box("editor.bar", page.getByRole("tablist", { name: "Letter sets" }).locator("xpath=../.."));
    let n = 1;
    const key = (name: string, capital = false) => page.getByRole("button", { name: `Insert ${capital ? "capital " : ""}${name}`, exact: true });
    const snap = async (label: string) => {
      await page.waitForTimeout(120);
      await shot(page, `editor-${n++}`);
      console.log("     ", label);
    };
    // "Ɛte sɛn?" (Twi: how are you?)
    await page.getByRole("button", { name: "Capitals" }).click().catch(() => {});
    await box("editor.key-E", key("open e", true));
    await key("open e", true).click();
    await snap("Ɛ");
    await body.pressSequentially("te s", { delay: 25 });
    await box("editor.key-e", key("open e"));
    await key("open e").click();
    await body.pressSequentially("n?", { delay: 25 });
    await snap("Ɛte sɛn?");
    // "Oyiwala dɔŋŋ." (Ga: thank you very much)
    await body.press("Enter");
    await body.pressSequentially("Oyiwala d", { delay: 25 });
    await snap("Oyiwala d");
    await box("editor.key-o", key("open o"));
    await key("open o").click();
    await snap("ɔ");
    await box("editor.key-ng", key("eng"));
    await key("eng").click();
    await key("eng").click();
    await body.pressSequentially(".", { delay: 25 });
    await snap("dɔŋŋ.");
    await body.press("Enter");
    await body.press("Enter");
    await body.pressSequentially("*How are you?*", { delay: 10 });
    await body.press("Enter");
    await body.pressSequentially("*Thank you, so much.*", { delay: 10 });
    await snap("gloss");
    // Publishing.
    const publish = page.getByRole("button", { name: "Publish to board" });
    await publish.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 160));
    await settle(page, 300);
    await shot(page, "publish-0");
    await box("publish.button", publish);
    await publish.click();
    await page.waitForURL(/published=/, { timeout: 120_000 });
    await page.locator("[data-sileo-toast]").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
    await shot(page, "publish-toast");
    await ctx.close();
    // The new card on the board.
    const r = await phone(browser);
    const p2 = await r.newPage();
    await openBoardAt(p2, "Abla Dzifa");
    await centerOn(p2, card(p2, "Akwaaba"), 0.5, 0.5);
    await p2.waitForTimeout(300);
    await shot(p2, "board-akwaaba");
    await box("board-akwaaba.card", p2.locator("[data-card]", { has: p2.locator("[data-poem-id]", { hasText: "Akwaaba" }) }));
    await r.close();
  },

  /** Share as image: the sheet in each design, on the poem's own page. */
  async share() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await page.goto(BASE + "/p/abla-dzifa/akwaaba", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 500);
    await page.getByRole("button", { name: "Share as image" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    for (const design of ["Page", "Ink", "Board"]) {
      await sheet.locator("label", { hasText: new RegExp(`^${design}`) }).first().click();
      await sheet.locator("img").first().waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll("[role=dialog] img")].every((i) => (i as HTMLImageElement).complete), null, { timeout: 120_000 });
      await page.waitForTimeout(900);
      await shot(page, `share-${design.toLowerCase()}`);
      await box(`share.${design.toLowerCase()}`, sheet.locator("label", { hasText: new RegExp(`^${design}`) }));
    }
    await ctx.close();
  },

  /** The share pictures themselves (story format) and their short addresses. */
  async pictures() {
    const get = async (path: string, file: string) => {
      const res = await fetch(BASE + path);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      writeFileSync(`${OUT}${file}`, Buffer.from(await res.arrayBuffer()));
      console.log("  ", file, res.headers.get("x-share-address"));
      return res.headers.get("x-share-address");
    };
    const addr = await get("/p/abla-dzifa/akwaaba/share-image", "pic-akwaaba-page.png");
    await get("/p/abla-dzifa/akwaaba/share-image?design=ink", "pic-akwaaba-ink.png");
    await get("/p/abla-dzifa/akwaaba/share-image?design=board", "pic-akwaaba-board.png");
    await get("/p/selorm-agbo/ngdi/share-image?design=board", "pic-ndi-board.png");
    await get("/a/odalys-moon/n/the-ferry-at-yeji/thursday/share-image?passage=1-2&design=ink", "pic-ferry-passage.png");
    boxes["pictures.akwaaba"] = { x: 0, y: 0, width: 0, height: 0, text: addr ?? "" };
  },

  /** Novels: the novel page, the chapter with its drop cap and the text settings. */
  async novels() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await page.goto(BASE + "/a/odalys-moon/n/the-ferry-at-yeji", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 600);
    await shot(page, "novel-ferry");
    await page.goto(BASE + "/a/odalys-moon/n/the-ferry-at-yeji/thursday", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 600);
    await shot(page, "chapter-default");
    await box("chapter.dropcap", page.locator(".prose-drop-cap").first());
    await box("chapter.aa", page.getByRole("button", { name: "Text settings" }));
    await page.getByRole("button", { name: "Text settings" }).click();
    const pop = page.getByRole("dialog", { name: "Text settings" });
    await pop.waitFor();
    await page.waitForTimeout(400);
    await shot(page, "chapter-settings-open");
    for (const size of ["Larger", "Largest"]) {
      await box(`chapter.${size.toLowerCase()}`, pop.locator("label", { hasText: new RegExp(`^${size}$`) }));
      await pop.locator("label", { hasText: new RegExp(`^${size}$`) }).first().click();
      await page.waitForTimeout(450);
      await shot(page, `chapter-${size.toLowerCase()}`);
    }
    // Back to the default for later visits in this context.
    await pop.locator("label", { hasText: /^Default$/ }).first().click().catch(() => {});
    await page.keyboard.press("Escape");
    await ctx.close();
  },

  /** Share a passage: two paragraphs ticked, the count rising. */
  async passage() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await page.goto(BASE + "/a/odalys-moon/n/the-ferry-at-yeji/thursday", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 500);
    await page.getByRole("button", { name: "Share a passage" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    await page.waitForTimeout(800);
    const boxes0 = sheet.getByRole("checkbox");
    await boxes0.first().waitFor();
    await shot(page, "passage-0");
    for (let i = 0; i < 2; i++) {
      const label = sheet.locator("label", { has: page.locator('[role="checkbox"]') }).nth(i);
      await box(`passage.tick${i + 1}`, boxes0.nth(i));
      await boxes0.nth(i).click();
      await page.waitForTimeout(600);
      await shot(page, `passage-${i + 1}`);
      void label;
    }
    await box("passage.count", sheet.getByText(/of 600/).first(), true);
    await ctx.close();
  },

  /** A private novel: the lock on the novel page, the password typed, the text after unlocking. */
  async private() {
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await page.goto(BASE + "/a/ines-calloway/n/letters-to-the-lighthouse-keeper", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 500);
    await shot(page, "private-novel");
    await box("private.lock", page.getByText("Password protected.").first());
    await page.goto(BASE + "/a/ines-calloway/n/letters-to-the-lighthouse-keeper/the-first-letter", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 500);
    const pw = page.locator("input#novel-password");
    await pw.click();
    await settle(page, 200);
    await shot(page, "private-0");
    await box("private.form", pw.locator("xpath=ancestor::form[1]/.."));
    const word = "moonlight";
    for (let i = 0; i < word.length; i++) {
      await pw.press(word[i]);
      if (i % 3 === 2) await shot(page, `private-${(i + 1) / 3}`);
    }
    await page.getByRole("button", { name: "Unlock novel" }).click();
    await page.locator("[data-chapter-text]").first().waitFor({ timeout: 90_000 });
    await settle(page, 700);
    await shot(page, "private-open");
    await ctx.close();
  },

  /** Stats for Odalys Moon: followers and the most-visited links. */
  async stats() {
    const ctx = await phone(browser, { session: sessions.odalys });
    const page = await ctx.newPage();
    await page.goto(BASE + "/admin/stats", { waitUntil: "load", timeout: 180_000 });
    await settle(page, 600);
    await page.getByRole("heading", { name: "Followers" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 150));
    await settle(page, 300);
    await shot(page, "stats");
    await box("stats.followers", page.getByText("128", { exact: true }).first(), true);
    const visits = page.getByText(/^\d+ visits$/);
    for (let i = 0; i < Math.min(4, await visits.count()); i++) await box(`stats.visits${i}`, visits.nth(i), true);
    await box("stats.total", page.getByText(/visits through/).first(), true);
    const style = await page.getByText("128", { exact: true }).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return `${cs.fontFamily}|${cs.fontSize}|${cs.color}|${cs.fontWeight}`;
    });
    console.log("     followers style", style);
    await ctx.close();
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
