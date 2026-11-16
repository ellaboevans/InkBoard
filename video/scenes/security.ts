/**
 * Signing in without email, and deleting the account: on the dev server, so
 * every email goes to the E2E outbox (video/.out/outbox.jsonl), never out.
 * Passkeys use Chrome's virtual authenticator.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { DEV_URL, OUTBOX, TAKES } from "../lib/config";
import { fixture } from "../lib/fixtures";
import type { Recorder } from "../lib/recorder";
import { REHEARSAL, WRITER } from "../scripts/demo-content";
import { nextMail, outbox, signIn, sleep, type Scene } from "./common";

const toast = (page: Page, title: string) =>
  page.locator("[data-sileo-toast]").filter({ has: page.locator("[data-sileo-title]", { hasText: title }) }).first();

/** Chrome's virtual platform authenticator (fingerprint/face), answering prompts itself. */
async function authenticator(ctx: BrowserContext, page: Page) {
  // Autofill (conditional UI) off, as in e2e/helpers.ts: the scenes use the button.
  await ctx.addInitScript(() => {
    if (window.PublicKeyCredential) PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function signedInDev(rec: Recorder, at: string, email = WRITER.email) {
  const { token } = fixture<{ token: string }>("session", email);
  const ctx = await rec.context();
  const page = await ctx.newPage();
  await signIn(page, "dev", token);
  await page.goto(`${DEV_URL}${at}`);
  return { ctx, page };
}

export const securityScenes: Scene[] = [
  {
    id: "recovery-passkey",
    server: "dev",
    device: "desktop",
    setup: () => void fixture("writer:security"),
    async run(rec) {
      // Your own laptop: make recovery codes.
      const { page } = await signedInDev(rec, "/admin/profile#recovery-codes");
      const create = page.getByRole("button", { name: "Create recovery codes" });
      await create.waitFor();
      await page.evaluate(() => document.getElementById("recovery-codes")?.scrollIntoView({ block: "start" }));
      await sleep(400);
      await rec.attach(page);
      await rec.begin();
      await rec.focus(page.locator("#recovery-codes").locator("xpath=..").first(), { pad: 10, maxZoom: 1.5 });
      await rec.caption("No email to hand? Make recovery codes while you still have it.");
      await rec.click(create);
      const list = page.getByRole("list", { name: "Recovery codes" });
      await rec.cut(() => list.getByRole("listitem").nth(9).waitFor({ timeout: 120_000 }));
      await rec.hold(300);
      rec.unfocus();
      await rec.scrollTo(page.getByRole("heading", { name: "Your recovery codes" }), { offset: 110 });
      await rec.focus(list, { pad: 60, maxZoom: 1.7 });
      await rec.caption("Ten codes, each good once. Keep them in a password manager or your wallet.");
      const codes = (await list.innerText()).match(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/g) ?? [];
      if (codes.length !== 10) throw new Error(`expected 10 codes, got ${codes.length}`);
      await rec.captionDone();
      rec.unfocus();
      await rec.click(page.getByRole("button", { name: "I've saved my codes" }));
      await rec.hold(500);
      await rec.collectToasts();

      // Another computer: a recovery code, then a passkey.
      const ctx2 = await rec.context();
      const page2 = await ctx2.newPage();
      await authenticator(ctx2, page2);
      await page2.goto(`${DEV_URL}/sign-in`);
      await page2.getByRole("link", { name: "Use a recovery code" }).waitFor();
      await rec.attach(page2);
      await rec.focus(page2.getByRole("main"), { pad: 0, maxZoom: 1.5 });
      await rec.caption("On another computer, sign in with your email and one code.");
      await rec.click(page2.getByRole("link", { name: "Use a recovery code" }));
      await page2.waitForURL(/\/sign-in\/recovery$/);
      await rec.type(page2.getByRole("textbox", { name: "Email" }), WRITER.email, { delay: 35 });
      await rec.type(page2.getByRole("textbox", { name: "Recovery code" }), codes[3], { delay: 70 });
      await rec.click(page2.getByRole("button", { name: "Sign in with recovery code" }));
      const offer = page2.getByRole("region", { name: "Add a passkey on this computer?" });
      await rec.cut(async () => {
        await page2.waitForURL(/\/admin(\?.*)?$/, { timeout: 120_000 });
        await offer.waitFor({ timeout: 60_000 });
        await rec.settle(200);
      });
      rec.unfocus();
      await rec.hold(500);
      await rec.focus(offer, { pad: 30, maxZoom: 1.7 });
      await rec.caption("Then add a passkey: next time it's just your fingerprint, face or PIN.");
      await rec.click(offer.getByRole("button", { name: "Add a passkey" }));
      await rec.cut(() => toast(page2, "Passkey added").waitFor({ timeout: 120_000 }));
      await rec.hold(1400);
      rec.unfocus();
      await rec.collectToasts();

      // Sign out, and back in with the passkey.
      rec.mark("passkey");
      await rec.caption("Signing in with a passkey: no email, no code.");
      await rec.click(page2.getByRole("button", { name: /^Account menu:/ }));
      await rec.click(page2.getByRole("menuitem", { name: "Sign out" }));
      await rec.cut(async () => {
        await page2.waitForURL(/\/sign-in/, { timeout: 60_000 });
        await page2.getByRole("button", { name: "Sign in with a passkey" }).waitFor({ timeout: 60_000 });
        await rec.settle(200);
      });
      await rec.focus(page2.getByRole("main"), { pad: 0, maxZoom: 1.5 });
      rec.mark("passkey-signin");
      await rec.click(page2.getByRole("button", { name: "Sign in with a passkey" }));
      await rec.cut(async () => {
        await page2.waitForURL(/\/admin(\?.*)?$/, { timeout: 120_000 });
        await page2.getByRole("heading", { name: "Your poems" }).waitFor({ timeout: 60_000 });
        await rec.settle(200);
      });
      rec.unfocus();
      await rec.focus({ x: 260, y: 0, width: 760, height: 200 }, { maxZoom: 1.8 });
      await rec.hold(2200);
      await rec.end();
    },
  },
  {
    id: "public-device",
    server: "dev",
    device: "desktop",
    setup: () => void fixture("writer:security"),
    async run(rec) {
      const ctx = await rec.context();
      const page = await ctx.newPage();
      await page.goto(`${DEV_URL}/sign-in`);
      const box = page.getByRole("checkbox", { name: "This isn't my device" });
      await box.waitFor();
      await rec.attach(page);
      await rec.begin();
      await rec.focus(page.getByRole("main"), { pad: 0, maxZoom: 1.5 });
      await rec.caption("On a shared or library computer, tick “This isn't my device”.");
      await rec.type(page.getByRole("textbox", { name: "Email" }), WRITER.email, { delay: 35 });
      await rec.click(box);
      await rec.hold(400);
      const since = outbox().length;
      await rec.click(page.getByRole("button", { name: "Email me a sign-in code" }));
      const mail = await rec.cut(async () => {
        await page.getByRole("main").getByText("We sent a 6-digit code to").waitFor({ timeout: 120_000 });
        return nextMail(WRITER.email, undefined, since, 120_000);
      });
      await rec.type(page.locator('input[name="code"]'), String(mail.code), { delay: 120 });
      await rec.cut(async () => {
        await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 120_000 });
        await page.getByRole("heading", { name: "Your poems" }).waitFor({ timeout: 60_000 });
        await rec.settle(200);
      });
      rec.unfocus();
      await rec.caption("That sign-in ends when the browser closes, or after 12 hours at most.");
      await rec.click(page.getByRole("link", { name: "Profile", exact: true }));
      const devices = page.getByRole("region", { name: "Signed-in devices" });
      await rec.cut(async () => {
        await devices.waitFor({ timeout: 120_000 });
        await rec.settle(300);
      });
      await rec.scrollTo(devices, { offset: 160 });
      await rec.focus(devices, { pad: 30, maxZoom: 1.7 });
      await rec.captionDone();
      await rec.caption("Nothing about that computer is remembered. Your devices are listed here.");
      await rec.captionDone();
      rec.unfocus();
      await rec.hold(400);
      await rec.end();
    },
  },
  {
    id: "inbox",
    server: "dev",
    device: "desktop",
    async run(rec) {
      // The real templates, filled in with what the outbox recorded in the scenes above.
      const out = path.join(TAKES, "_emails");
      const { emails } = fixture<{ emails: { kind: string; subject: string; file: string }[] }>("emails", OUTBOX, out);
      const pick = ["recovery-codes-changed", "recovery-used", "passkey-added"]
        .map((k) => emails.filter((e) => e.kind === k).pop())
        .filter((e): e is { kind: string; subject: string; file: string } => Boolean(e));
      if (pick.length < 3) throw new Error(`inbox: missing emails (${emails.map((e) => e.kind).join(", ")})`);
      const items = pick.map((e) => ({ subject: e.subject, html: readFileSync(e.file, "utf8") }));
      const ctx = await rec.context();
      const page = await ctx.newPage();
      await page.setContent(inboxHtml(items));
      await rec.attach(page);
      await rec.begin();
      await rec.caption("Each of these sends you an email, so nothing happens without you knowing.");
      for (let i = 0; i < items.length; i++) {
        await rec.click(page.locator(`[data-mail="${i}"]`));
        await rec.hold(i === 0 ? 2600 : 2200);
      }
      await rec.end();
    },
  },
  {
    id: "delete",
    server: "dev",
    device: "desktop",
    setup: () => {
      fixture("writer:ready");
      fixture("writer:ndi");
      fixture("writer:security");
      fixture("rehearsal:ready");
    },
    async run(rec) {
      // The dev-server rehearsal deletes a throwaway editor, not the writer.
      const who = rec.id.startsWith("_rehearsal") ? REHEARSAL : WRITER;
      const { page } = await signedInDev(rec, "/admin/settings", who.email);
      const danger = page.getByRole("region", { name: "Delete account" });
      await danger.waitFor();
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
      await sleep(400);
      await rec.attach(page);
      await rec.begin();
      await rec.focus(danger, { pad: 20, maxZoom: 1.5 });
      await rec.caption("Leaving? Delete your account: everything of yours goes, at once.");
      await rec.captionDone();
      await rec.click(danger.getByRole("button", { name: "Delete my account…" }));
      const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
      await rec.cut(() => dialog.waitFor({ timeout: 120_000 }));
      rec.unfocus();
      await rec.focus(dialog, { pad: 20, maxZoom: 1.6 });
      await rec.caption("To be sure, type your pen name.");
      await rec.type(dialog.getByRole("textbox", { name: /Type your pen name/ }), who.penName, { delay: 90 });
      await rec.hold(500);
      await rec.click(dialog.getByRole("button", { name: "Delete my account" }));
      await rec.cut(async () => {
        await page.waitForURL(/\/(\?.*)?$/, { timeout: 120_000 });
        await page.locator('[aria-label="Poem board"][data-ready="true"]').waitFor({ state: "attached", timeout: 60_000 });
        await rec.settle(300);
      });
      rec.unfocus();
      await rec.caption("Done. Readers no longer see the author anywhere.");
      await rec.hold(800);
      await rec.end();
    },
  },
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A plain, neutral mail window (not any real mail app) around the real email HTML. */
function inboxHtml(items: { subject: string; html: string }[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #2b2622; background: #f4f2ef; }
    .wrap { display: grid; grid-template-columns: 380px 1fr; height: 100vh; }
    .list { background: #fbfaf8; border-right: 1px solid #e3ded7; overflow: hidden; }
    .head { padding: 18px 20px 12px; font-weight: 700; font-size: 20px; }
    .who { padding: 0 20px 14px; color: #7a716a; font-size: 13px; border-bottom: 1px solid #e3ded7; }
    .item { padding: 14px 20px; border-bottom: 1px solid #ece8e2; cursor: default; }
    .item.on { background: #efe7dd; }
    .from { font-weight: 650; display: flex; justify-content: space-between; }
    .from span { font-weight: 400; color: #8a8079; font-size: 12px; }
    .subj { margin-top: 3px; }
    iframe { border: 0; width: 100%; height: 100vh; background: #fff; }
  </style></head><body><div class="wrap"><div class="list">
    <div class="head">Inbox</div><div class="who">${esc(WRITER.email)}</div>
    ${items.map((m, i) => `<div class="item${i === 0 ? " on" : ""}" data-mail="${i}"><div class="from">InkBoard <span>now</span></div><div class="subj">${esc(m.subject)}</div></div>`).join("")}
  </div><iframe id="view" srcdoc="${esc(items[0].html)}"></iframe></div>
  <script>
    const mails = ${JSON.stringify(items.map((m) => m.html)).replace(/</g, "\\u003c")};
    document.querySelectorAll("[data-mail]").forEach((el) => el.addEventListener("click", () => {
      document.querySelectorAll("[data-mail]").forEach((x) => x.classList.remove("on"));
      el.classList.add("on");
      document.getElementById("view").srcdoc = mails[Number(el.dataset.mail)];
    }));
  </script></body></html>`;
}
