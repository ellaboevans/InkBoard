/**
 * Writer scenes. Sign-up runs on the dev server (it sends email, through the
 * E2E outbox); the rest run on the production build with a fixture session.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { DEV_URL, PROD_URL } from "../lib/config";
import { fixture } from "../lib/fixtures";
import type { Rect, Recorder } from "../lib/recorder";
import { WRITER } from "../scripts/demo-content";
import { nextMail, outbox, signIn, sleep, type Scene } from "./common";

export async function union(...targets: (Locator | Rect)[]): Promise<Rect> {
  const boxes: Rect[] = [];
  for (const t of targets) {
    const b = "x" in t ? t : await t.boundingBox();
    if (b) boxes.push(b);
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

/** A signed-in desktop page on the production build. */
async function writerPage(rec: Recorder, at: string) {
  const { token } = fixture<{ token: string }>("session", WRITER.email);
  const ctx = await rec.context();
  const page = await ctx.newPage();
  await signIn(page, "prod", token);
  await page.goto(`${PROD_URL}${at}`);
  await rec.attach(page);
  return page;
}

const toast = (page: Page, title: string) =>
  page.locator("[data-sileo-toast]").filter({ has: page.locator("[data-sileo-title]", { hasText: title }) }).first();

/** Type with the special letters bar: strings are typed, { key } presses a bar key. */
type Stroke = string | { key: string; caps?: boolean };
async function typeWithBar(rec: Recorder, page: Page, strokes: Stroke[], delay = 70) {
  for (const s of strokes) {
    if (typeof s === "string") {
      await rec.type(page.getByRole("textbox", { name: "Poem" }), s, { delay, click: false, fast: 1 });
    } else {
      if (s.caps) await rec.click(page.getByRole("button", { name: "Capitals" }), { pause: 120 });
      await rec.click(page.getByRole("button", { name: `Insert ${s.caps ? "capital " : ""}${s.key}`, exact: true }), { pause: 120 });
      await sleep(120);
    }
  }
}

export const signupScene: Scene = {
  id: "signup",
  server: "dev",
  device: "desktop",
  setup: () => void fixture("writer:none"),
  async run(rec) {
    const ctx = await rec.context();
    const page = await ctx.newPage();
    await page.goto(`${DEV_URL}/sign-in`);
    await page.getByRole("textbox", { name: "Email" }).waitFor();
    await rec.attach(page);
    await rec.begin();
    const form = page.getByRole("main");
    await rec.focus(form, { pad: 0, maxZoom: 1.5 });
    await rec.caption("Writers sign in with their email. No password to remember.");
    await rec.type(page.getByRole("textbox", { name: "Email" }), WRITER.email, { delay: 45 });
    const since = outbox().length;
    await rec.click(page.getByRole("button", { name: "Email me a sign-in code" }));
    const mail = await rec.cut(async () => {
      await page.getByRole("main").getByText("We sent a 6-digit code to").waitFor({ timeout: 120_000 });
      return nextMail(WRITER.email, undefined, since, 120_000);
    });
    await rec.caption("A 6-digit code arrives by email. Type it in, and you're in.");
    await rec.hold(900);
    await rec.type(page.locator('input[name="code"]'), String(mail.code), { delay: 160 });
    await rec.cut(async () => {
      await page.waitForURL(/\/admin\/onboarding$/, { timeout: 120_000 });
      await page.getByRole("textbox", { name: "Pen name" }).waitFor({ timeout: 60_000 });
      await rec.settle(200);
    });
    rec.unfocus();
    await rec.focus(page.getByRole("main"), { pad: 0, maxZoom: 1.5 });
    await rec.caption("The first time, choose the pen name readers will see.");
    await rec.type(page.getByRole("textbox", { name: "Pen name" }), WRITER.penName, { delay: 90 });
    await rec.hold(500);
    await rec.click(page.getByRole("button", { name: "Continue to dashboard" }));
    await rec.cut(async () => {
      await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 120_000 });
      await page.getByRole("heading", { name: "Your poems" }).waitFor({ timeout: 60_000 });
      await rec.settle(200);
    });
    rec.unfocus();
    await rec.caption("That's it: this is your dashboard.");
    await rec.hold(1200);
    await rec.end();
  },
};

export const writerScenes: Scene[] = [
  {
    id: "write",
    server: "prod",
    device: "desktop",
    setup: () => void fixture("writer:ready"),
    async run(rec) {
      const page = await writerPage(rec, "/admin");
      await page.getByRole("heading", { name: "Your poems" }).waitFor();
      await rec.begin();
      await rec.caption("Write a new poem from your dashboard.");
      await rec.click(page.getByRole("main").getByRole("link", { name: "New poem" }));
      await page.waitForURL(/\/admin\/poems\/new$/);
      const title = page.getByRole("textbox", { name: "Title" });
      await title.waitFor();
      await rec.hold(300);
      await rec.caption("This one is in Ewe: “Ŋdi”, good morning.");
      await rec.focus(await union(title, page.getByRole("region", { name: "Card preview" })), { pad: 20, maxZoom: 1.5 });
      await rec.type(title, "Ŋdi", { delay: 160 });
      await rec.hold(600);
      rec.unfocus();
      // Open the special letters bar on the Ewe tab and bring it into view.
      await rec.click(page.getByRole("button", { name: "Special letters" }));
      await rec.click(page.getByRole("tab", { name: "Ewe" }));
      await rec.moveTo(600, 420);
      await rec.wheel(225, { ms: 900 });
      await sleep(300);
      const poem = page.getByRole("textbox", { name: "Poem" });
      const letters = page.getByRole("tabpanel").first();
      const pb = (await poem.boundingBox())!;
      await rec.focus(await union({ x: pb.x, y: Math.max(0, pb.y), width: pb.width, height: 150 }, letters), { pad: 16, maxZoom: 1.6 });
      rec.mark("letters");
      await rec.caption("The special letters bar types Ewe, Akan and Ga letters, and tone marks.");
      await rec.click(poem, { dy: 0.1 });
      await rec.fast(() => typeWithBar(rec, page, [
        { key: "eng", caps: true },
        "di na wo",
        { key: "low tone" },
        ", x",
        { key: "open o" },
        { key: "nasal" },
        "nye.\n",
        "Dzidz",
        { key: "open o" },
        " na wo",
        { key: "low tone" },
        ".\n\n",
      ]), 1.6);
      await rec.caption("Light formatting too: *asterisks* make italics.");
      await rec.fast(() => typeWithBar(rec, page, ["*Good morning to you, my friend.*\n*Joy to you.*"], 38), 2);
      await rec.hold(600);
      rec.mark("letters-end");
      rec.unfocus();
      // Language
      const lang = page.getByRole("combobox", { name: "Language" });
      await rec.focus(await union(lang, page.getByRole("region", { name: "Card preview" })), { pad: 30, maxZoom: 1.6 });
      await rec.caption("Set its language, so readers can find it when they browse by language.");
      await rec.hover(lang);
      await rec.hold(500);
      await lang.selectOption({ label: "Ewe" });
      await rec.hold(1500);
      rec.unfocus();
      // Save a draft, then publish.
      const draft = page.getByRole("button", { name: "Save draft" });
      await rec.focus(await union(page.getByRole("button", { name: "Publish to board" }), draft), { pad: 90, maxZoom: 1.7 });
      await rec.caption("Save a draft: only you can see it.");
      await rec.click(draft);
      await rec.cut(async () => {
        await page.waitForURL(/\/admin\/poems\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.getByRole("textbox", { name: "Poem" }).waitFor();
        await rec.settle(150);
      });
      await toast(page, "Poem created").waitFor();
      await rec.hold(1200);
      // Saving reloaded the editor at the top: back down to the Publish button.
      rec.unfocus();
      const pub = page.getByRole("button", { name: "Publish to board" });
      await rec.scrollTo(pub, { offset: 420 });
      await rec.focus(pub, { pad: 110, maxZoom: 1.7 });
      rec.mark("publish");
      await rec.caption("When it's ready, publish it to the board.");
      await rec.click(pub);
      await rec.cut(async () => {
        await toast(page, "Poem published").waitFor({ timeout: 30_000 });
        await page.waitForURL(/\/admin$/);
        await page.getByRole("row", { name: /Ŋdi/ }).waitFor();
        await rec.settle(150);
      });
      rec.unfocus();
      await rec.hold(600);
      const row = page.getByRole("row", { name: /Ŋdi/ });
      await rec.focus(await union(row.getByRole("link", { name: "Ŋdi" }), row.getByText("Just published")), { pad: 60, maxZoom: 1.8 });
      await rec.caption("Back on your list, marked “Just published”.");
      await rec.captionDone();
      rec.unfocus();
      await rec.hold(500);
      await rec.end();
    },
  },
  {
    id: "private-poem",
    server: "prod",
    device: "desktop",
    setup: () => {
      fixture("writer:ready");
      fixture("writer:ndi");
    },
    async run(rec) {
      const page = await writerPage(rec, "/admin");
      await page.getByRole("heading", { name: "Your poems" }).waitFor();
      await rec.begin();
      await rec.caption("Any poem can be public, or private behind a password.");
      await rec.click(page.getByRole("main").getByRole("link", { name: "New poem" }));
      const title = page.getByRole("textbox", { name: "Title" });
      await title.waitFor();
      await rec.type(title, "Letter Home", { delay: 70 });
      await rec.type(page.getByRole("textbox", { name: "Poem" }), "Mother, the rains came early.\nI kept your seeds dry.", { delay: 32 });
      const sw = page.getByRole("switch", { name: "Password protected" });
      await rec.scrollTo(sw, { offset: 330 });
      const publish = page.getByRole("button", { name: "Publish to board" });
      await rec.focus(await union(sw, publish), { pad: 70, maxZoom: 1.7 });
      await rec.click(sw);
      await rec.hold(300);
      const pw = page.getByLabel("Password", { exact: true }).filter({ visible: true });
      await rec.caption("Readers see its title, and need the password to read it.");
      await rec.type(pw, "harmattan", { delay: 90 });
      await rec.hold(400);
      await rec.click(publish);
      await rec.cut(async () => {
        await toast(page, "Poem published").waitFor({ timeout: 30_000 });
        await page.waitForURL(/\/admin$/);
        await rec.settle(200);
      });
      rec.unfocus();
      await rec.focus(page.getByRole("row", { name: /Letter Home/ }), { pad: 40, maxZoom: 1.6 });
      await rec.hold(1800);
      rec.unfocus();
      await rec.caption("Or use one shared password for all your private poems, in Settings.");
      await rec.click(page.getByRole("link", { name: "Settings", exact: true }));
      await rec.cut(async () => {
        await page.getByRole("radio", { name: /One password for all my private poems/ }).waitFor();
        await rec.settle(200);
      });
      const radio = page.getByRole("radio", { name: /One password for all my private poems/ });
      await rec.focus(page.locator("form").filter({ has: radio }).first(), { pad: 20, maxZoom: 1.6 });
      await rec.click(radio);
      await rec.hold(400);
      const label = (await page.getByText("New shared password").count()) ? "New shared password" : "Shared password";
      await rec.type(page.getByLabel(label, { exact: true }).filter({ visible: true }), "kente-and-ink", { delay: 70 });
      await rec.click(page.getByRole("button", { name: "Save", exact: true }));
      await toast(page, "Shared password saved").or(page.getByText(/Shared password saved/)).first().waitFor({ timeout: 30_000 });
      await rec.hold(1200);
      rec.unfocus();
      await rec.hold(400);
      await rec.end();
    },
  },
  {
    id: "history",
    server: "prod",
    device: "desktop",
    setup: () => void fixture("writer:ndi"),
    async run(rec) {
      const { id } = fixture<{ id: string }>("writer:ndi");
      const page = await writerPage(rec, `/admin/poems/${id}`);
      const poem = page.getByRole("textbox", { name: "Poem" });
      await poem.waitFor();
      await rec.begin();
      await rec.caption("Edit a poem any time. Saving updates it on the board right away.");
      await rec.focus(poem, { pad: 10, maxZoom: 1.6 });
      await rec.click(poem, { dy: 0.2 });
      await page.keyboard.press("ControlOrMeta+End");
      await rec.type(poem, "\nŊutifafa na wò.", { delay: 75, click: false });
      await rec.hold(400);
      rec.unfocus();
      await rec.click(page.getByRole("button", { name: "Save changes" }));
      await toast(page, "Saved and published").waitFor({ timeout: 30_000 });
      await rec.hold(700);
      const history = page.getByRole("region", { name: "History" });
      await rec.scrollTo(history, { offset: 200 });
      await rec.focus(history, { pad: 24, maxZoom: 1.8 });
      await rec.caption("Every save keeps the version before it, under History.");
      await rec.captionDone();
      const versions = history.getByRole("link");
      await rec.click(versions.nth(1));
      const dialog = page.getByRole("dialog", { name: /^Earlier version, saved / });
      await dialog.waitFor();
      await rec.hold(400);
      rec.unfocus();
      await rec.focus(dialog, { pad: 10, maxZoom: 1.5 });
      await rec.caption("Open one to see what changed since.");
      await rec.captionDone();
      await rec.caption("Restore it, and it goes back into the editor. Save to keep it.");
      await rec.click(dialog.getByRole("button", { name: "Restore this version" }));
      await dialog.waitFor({ state: "hidden" });
      rec.unfocus();
      await rec.hold(800);
      await rec.click(page.getByRole("button", { name: "Save changes" }));
      await toast(page, "Saved and published").waitFor({ timeout: 30_000 });
      await rec.hold(1200);
      await rec.end();
    },
  },
  {
    id: "collections",
    server: "prod",
    device: "desktop",
    setup: () => {
      fixture("writer:ready");
      fixture("writer:ndi");
    },
    async run(rec) {
      const page = await writerPage(rec, "/admin");
      await page.getByRole("heading", { name: "Your poems" }).waitFor();
      await rec.begin();
      await rec.caption("Collections group your poems into an ordered sequence.");
      await rec.click(page.getByRole("link", { name: "Collections", exact: true }));
      await rec.cut(async () => {
        await page.getByRole("button", { name: "New collection" }).waitFor();
        // The list below streams in after the button: wait for it, not its skeleton.
        await page.getByText("No collections yet.").waitFor({ timeout: 30_000 });
        await rec.settle(200);
      });
      await rec.click(page.getByRole("button", { name: "New collection" }));
      const form = page.getByRole("dialog", { name: "New collection" });
      await form.waitFor();
      await rec.focus(form, { pad: 20, maxZoom: 1.6 });
      await rec.type(form.getByRole("textbox", { name: "Title" }), "Mornings", { delay: 90 });
      await rec.type(form.getByRole("textbox", { name: /Intro/ }), "Poems for the start of the day.", { delay: 40 });
      await rec.click(form.getByRole("button", { name: "Create collection" }));
      await page.waitForURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 30_000 });
      rec.unfocus();
      await rec.hold(500);
      await rec.caption("Add poems to it…");
      const add = page.getByRole("combobox", { name: "Add a poem" });
      const addBtn = page.getByRole("button", { name: "Add to collection" });
      await rec.focus(await union(add, addBtn, page.getByRole("main").getByRole("list").first()), { pad: 120, maxZoom: 1.5 });
      for (const t of ["Harmattan", "Market Day", "Ŋdi"]) {
        await rec.hover(add);
        await add.selectOption({ label: t });
        await rec.hold(250);
        await rec.click(addBtn);
        await page.getByRole("button", { name: `Remove “${t}” from the collection` }).waitFor({ timeout: 30_000 });
        await rec.hold(350);
      }
      rec.unfocus();
      await rec.caption("…and put them in the order readers will follow.");
      const list = page.getByRole("main").getByRole("list").filter({ has: page.getByRole("button", { name: /^Move / }) });
      await rec.focus(list, { pad: 40, maxZoom: 1.6 });
      for (let i = 0; i < 2; i++) {
        await rec.click(page.getByRole("button", { name: "Move “Ŋdi” up" }));
        await page.getByRole("main").getByRole("status").filter({ hasText: /Moved/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
        await rec.hold(700);
      }
      await rec.caption("Readers then see each poem's place in it: Part 1 of 3.");
      await rec.captionDone();
      rec.unfocus();
      await rec.hold(400);
      await rec.end();
    },
  },
  {
    id: "profile",
    server: "prod",
    device: "desktop",
    setup: () => void fixture("writer:ndi"),
    async run(rec) {
      const page = await writerPage(rec, "/admin/profile");
      await page.getByRole("heading", { level: 1, name: "Profile" }).waitFor();
      await rec.begin();
      await rec.caption("Your profile is your author page: an avatar, a tagline, a bio and links.");
      const avatars = page.getByAltText("Avatar 21", { exact: true });
      await rec.scrollTo(avatars, { offset: 260 });
      await rec.focus(await union(page.getByRole("radio", { name: "Avatar 1", exact: true }), page.getByRole("radio", { name: "Avatar 36", exact: true })), { pad: 30, maxZoom: 1.6 });
      await rec.click(avatars);
      await rec.hold(500);
      rec.unfocus();
      const tagline = page.getByRole("textbox", { name: /Tagline/ });
      await rec.scrollTo(tagline, { offset: 200 });
      await rec.focus(await union(tagline, page.getByRole("textbox", { name: /Bio/ })), { pad: 40, maxZoom: 1.6 });
      await rec.type(tagline, "Morning poems in Ewe and English", { delay: 40 });
      await rec.type(page.getByRole("textbox", { name: /Bio/ }), "Writes at dawn, before the heat.", { delay: 32 });
      rec.unfocus();
      const site = page.getByRole("textbox", { name: "Website" });
      await rec.scrollTo(site, { offset: 260 });
      await rec.focus(await union(site, page.getByRole("combobox", { name: "Pinned poem" })), { pad: 60, maxZoom: 1.6 });
      await rec.caption("Pin the poem you want readers to see first.");
      await rec.type(site, "example.com/abla", { delay: 45 });
      const pinned = page.getByRole("combobox", { name: "Pinned poem" });
      await rec.hover(pinned);
      await pinned.selectOption({ label: "Ŋdi" });
      await rec.hold(500);
      await rec.click(page.getByRole("button", { name: "Save profile" }));
      await toast(page, "Profile saved").waitFor({ timeout: 30_000 });
      await rec.hold(700);
      rec.unfocus();
      await rec.caption("This is what readers see.");
      await rec.scrollTo(page.getByRole("link", { name: "View public page" }), { offset: 120 });
      await rec.click(page.getByRole("link", { name: "View public page" }));
      await rec.cut(async () => {
        await page.getByRole("heading", { level: 1, name: WRITER.penName }).waitFor({ timeout: 30_000 });
        await rec.settle(300);
      });
      await rec.hold(2600);
      await rec.end();
    },
  },
  {
    id: "export",
    server: "prod",
    device: "desktop",
    setup: () => void fixture("writer:ndi"),
    async run(rec) {
      const page = await writerPage(rec, "/admin/settings");
      const section = page.getByRole("region", { name: "Download your poems" });
      await section.waitFor();
      await rec.scrollTo(section, { offset: 90 }).catch(() => {});
      await page.evaluate(() => window.scrollTo({ top: document.getElementById("download")!.offsetTop - 70 }));
      await sleep(300);
      await rec.begin();
      await rec.focus(section, { pad: 24, maxZoom: 1.5 });
      await rec.caption("Your poems are yours: download everything, any time.");
      const dl = page.waitForEvent("download");
      await rec.click(section.getByRole("link", { name: /Markdown/ }).first());
      const file = await dl;
      const target = path.join(rec.dir, "export.md");
      await file.saveAs(target);
      await rec.hold(500);
      rec.mark("file");
      await rec.caption("Markdown to read anywhere, or a complete JSON backup with every saved version.");
      await rec.captionDone();
      await rec.hold(1200);
      rec.mark("file-out");
      rec.unfocus();
      await rec.hold(400);
      await rec.end();
      writeFileSync(path.join(rec.dir, "export-name.txt"), file.suggestedFilename());
    },
  },
];
