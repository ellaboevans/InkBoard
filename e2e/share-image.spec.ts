import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "../playwright.config";
import { expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * "Share as image" (docs/PLAN.md, Phase 21): the button on public poems (page
 * and overlay), the sheet and its preview, Web Share with the file and text,
 * the desktop fallback, and the image route's caching and 404s.
 *
 * The phone's share sheet can't run here, so navigator.share/canShare are
 * stubbed to record what they're given (and whether the tap's activation was
 * still live); the fallback test removes them, as on Firefox or Linux.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, password?: string) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
}

async function poemRow(title: string) {
  const { rows } = await sql(
    `SELECT p.id, p.slug, e.slug AS author FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.title = '${title}'`,
  );
  return rows[0] as { id: string; slug: string; author: string };
}

/** Width and height from a PNG's IHDR. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

type Shared = {
  active: boolean;
  sinceTap: number;
  text?: string;
  title?: string;
  url?: string;
  files: { name: string; type: string; size: number; width: number; height: number }[];
};

/** navigator.share / canShare that record what they get, like a phone that can share files. */
async function stubShare(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __shared: unknown[]; __shareMode: string; __lastTap: number };
    w.__shared = [];
    w.__shareMode = "ok";
    w.__lastTap = 0;
    addEventListener("click", () => (w.__lastTap = performance.now()), true);
    const isImageFile = (f: unknown) => f instanceof File && f.type === "image/png";
    Object.defineProperty(Navigator.prototype, "canShare", {
      configurable: true,
      value: (data?: ShareData) => !!data && (!data.files || data.files.every(isImageFile)),
    });
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: (data: ShareData) => {
        // Recorded synchronously: was the tap's activation still live when share() was called?
        const active = navigator.userActivation.isActive;
        const sinceTap = performance.now() - w.__lastTap;
        const files = data.files ?? [];
        return Promise.all(files.map((f) => createImageBitmap(f))).then((bitmaps) => {
          w.__shared.push({
            active,
            sinceTap,
            text: data.text,
            title: data.title,
            url: data.url,
            files: files.map((f, i) => ({ name: f.name, type: f.type, size: f.size, width: bitmaps[i].width, height: bitmaps[i].height })),
          });
          if (w.__shareMode === "abort") throw new DOMException("Share canceled", "AbortError");
        });
      },
    });
  });
}

/** A browser that can't share files (most desktops, Firefox, in-app browsers). */
async function noShare(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  });
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "Share as image" });
const preview = (page: Page) => sheet(page).getByRole("img", { name: /^Preview of the image: / });

async function expectPreview(page: Page, title: string, pen: string) {
  await expect(preview(page)).toHaveAttribute("alt", `Preview of the image: “${title}” by ${pen}, with lines from the poem and its InkBoard address.`);
  await expect.poll(() => preview(page).evaluate((img: HTMLImageElement) => [img.complete, img.naturalWidth, img.naturalHeight])).toEqual([true, 1080, 1920]);
}

async function noSidewaysScroll(page: Page, label: string) {
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: width < 1000 ? 740 : 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${label} at ${width}px`).toBeLessThanOrEqual(0);
    // The sheet itself stays on screen.
    const box = await sheet(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width, `${label} sheet at ${width}px`).toBe(true);
  }
}

async function setUpPoems(page: Page, kind: string) {
  const id = unique();
  const pen = `Share Poet ${id}`;
  await signUpAs(page, `share-${kind}-${id}@example.com`, pen);
  const open = `Open ${id}`;
  const locked = `Locked ${id}`;
  await publish(page, open, "Àtí ɖèká mèwɔ̀a àvé ò.\n\n*One tree does not make a forest.*");
  await publish(page, locked, `private words ${id}`, "share-pass");
  return { id, pen, open, locked, o: await poemRow(open), l: await poemRow(locked) };
}

test("the button on a poem page: public poems only; the sheet, its preview and focus", async ({ page }) => {
  const { id, pen, open, o, l } = await setUpPoems(page, "page");

  // Under the byline; the sheet opens with focus inside, its preview loaded.
  await page.goto(`/p/${o.author}/${o.slug}`);
  const button = page.getByRole("main").getByRole("button", { name: "Share as image" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /^(Share|Download image)$/ }).first()).toBeFocused();
  await expectPreview(page, open, pen);
  for (const b of await sheet(page).getByRole("button").all()) {
    expect((await b.boundingBox())!.height, (await b.textContent()) ?? "").toBeGreaterThanOrEqual(44);
  }
  await noSidewaysScroll(page, "poem page");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(button).toBeFocused();

  // A private poem: no button, locked or unlocked.
  await page.goto(`/p/${l.author}/${l.slug}`);
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share as image" })).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("share-pass");
  await page.getByRole("button", { name: "Unlock poem" }).click();
  await expect(page.locator("article")).toContainText(`private words ${id}`);
  await expect(page.getByRole("button", { name: "Share as image" })).toHaveCount(0);
});

test("the button in the board's overlay: the sheet opens over it and gives it back", async ({ page }) => {
  const { pen, open, locked } = await setUpPoems(page, "overlay");
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.getByRole("link", { name: open, exact: true }).click();
  const overlay = page.getByRole("dialog", { name: open });
  await expect(overlay).toBeVisible();
  const inOverlay = overlay.getByRole("button", { name: "Share as image" });
  await inOverlay.click();
  await expect(sheet(page)).toBeVisible();
  await expectPreview(page, open, pen);
  await noSidewaysScroll(page, "overlay");
  // Esc closes only the sheet: the overlay keeps its name (the poem's title) and focus returns to the button.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: open })).toBeVisible();
  await expect(inOverlay).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  // A private poem in the overlay: no button.
  await page.getByRole("link", { name: `${locked} (password protected)` }).click();
  await expect(page.getByRole("dialog", { name: locked }).getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: locked }).getByRole("button", { name: "Share as image" })).toHaveCount(0);
});

test("Share hands the PNG and the text to the share sheet, straight from the tap", async ({ page, context }) => {
  await stubShare(context);
  const id = unique();
  const pen = `Sharer ${id}`;
  await signUpAs(page, `sharer-${id}@example.com`, pen);
  const title = `Harmattan ${id}`;
  await publish(page, title, "the dry wind\nwrites on every window");
  const o = await poemRow(title);

  await page.goto(`/p/${o.author}/${o.slug}`);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expectPreview(page, title, pen);
  // Files can be shared here, so there's no WhatsApp link (WhatsApp is in the system sheet).
  await expect(sheet(page).getByRole("link", { name: "Send on WhatsApp" })).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Share", exact: true }).click();

  const shared = () => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);
  await expect.poll(async () => (await shared()).length).toBe(1);
  const [s] = await shared();
  expect(s.active).toBe(true);
  expect(s.sinceTap).toBeLessThan(100);
  expect(s.files).toEqual([{ name: `inkboard-${o.slug}.png`, type: "image/png", size: expect.any(Number), width: 1080, height: 1920 }]);
  expect(s.files[0].size).toBeGreaterThan(20_000);
  expect(s.text).toBe(`“${title}” by ${pen}, on InkBoard: ${E2E_BASE_URL}/p/${o.author}/${o.slug}`);
  expect(s.url).toBeUndefined();

  // Closing the phone's share sheet (AbortError) isn't an error: no toast.
  await page.evaluate(() => ((window as unknown as { __shareMode: string }).__shareMode = "abort"));
  await sheet(page).getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(async () => (await shared()).length).toBe(2);
  await page.waitForTimeout(500);
  await expect(page.locator("[data-sileo-toast]")).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();
});

test("without file sharing: Download image, Copy link and Send on WhatsApp", async ({ page, context }) => {
  await noShare(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = unique();
  const pen = `Desk Poet ${id}`;
  await signUpAs(page, `desk-${id}@example.com`, pen);
  const title = `Desk ${id}`;
  await publish(page, title, "a line for the desktop");
  const o = await poemRow(title);
  const url = `${E2E_BASE_URL}/p/${o.author}/${o.slug}`;

  await page.goto(`/p/${o.author}/${o.slug}`);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Download image" })).toBeFocused();
  await expectPreview(page, title, pen);

  const [download] = await Promise.all([page.waitForEvent("download"), sheet(page).getByRole("button", { name: "Download image" }).click()]);
  expect(download.suggestedFilename()).toBe(`inkboard-${o.slug}.png`);
  const { readFile } = await import("node:fs/promises");
  expect(pngSize(await readFile((await download.path())!))).toEqual({ width: 1080, height: 1920 });

  await sheet(page).getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  const wa = sheet(page).getByRole("link", { name: "Send on WhatsApp" });
  const href = new URL((await wa.getAttribute("href"))!);
  expect(href.origin + href.pathname).toBe("https://wa.me/");
  expect(href.searchParams.get("text")).toBe(`“${title}” by ${pen}, on InkBoard: ${url}`);
  await expect(wa).toHaveAttribute("target", "_blank");
});

test("offline, or a failed load, says so plainly and can try again", async ({ page, context }) => {
  const id = unique();
  await signUpAs(page, `fail-${id}@example.com`, `Fail Poet ${id}`);
  const title = `Fragile ${id}`;
  await publish(page, title, "a line that won't load");
  const o = await poemRow(title);
  await page.goto(`/p/${o.author}/${o.slug}`);

  await page.route("**/share-image", (r) => r.fulfill({ status: 500, body: "boom" }));
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByText("Couldn't load the image. Check your connection and try again.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Download image" })).toHaveAttribute("aria-disabled", "true");
  await page.unroute("**/share-image");
  await sheet(page).getByRole("button", { name: "Try again" }).click();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press("Escape");

  await context.setOffline(true);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByText("You're offline. Connect to the internet to make the image.")).toBeVisible();
  await context.setOffline(false);
});

test("the route: a PNG for a public poem, one uncached 404 for private, draft and unknown poems", async ({ page, request }) => {
  const id = unique();
  const email = `route-${id}@example.com`;
  await signUpAs(page, email, `Route Poet ${id}`);
  await publish(page, `Public ${id}`, "seen by all");
  await publish(page, `Private ${id}`, `private words ${id}`, "route-pass");
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Draft ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill(`draft words ${id}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  const author = (await poemRow(`Public ${id}`)).author;

  const ok = await request.get(`/p/${author}/public-${id}/share-image`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("image/png");
  expect(ok.headers()["cache-control"]).toBe("private, no-cache");
  expect(ok.headers()["content-disposition"]).toBe(`inline; filename="inkboard-public-${id}.png"`);
  const etag = ok.headers()["etag"];
  expect(etag).toMatch(/^"[\w-]{32}"$/);
  expect(pngSize(await ok.body())).toEqual({ width: 1080, height: 1920 });
  // Unchanged: a 304, so the browser's copy costs nothing.
  expect((await request.get(`/p/${author}/public-${id}/share-image`, { headers: { "If-None-Match": etag } })).status()).toBe(304);

  for (const path of [
    `/p/${author}/private-${id}/share-image`,
    `/p/${author}/draft-${id}/share-image`,
    `/p/${author}/no-such-poem/share-image`,
    `/p/nobody-${id}/public-${id}/share-image`,
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(res.headers()["cache-control"], path).toContain("no-store");
    expect(res.headers()["content-type"], path).toContain("text/plain");
    expect(await res.text(), path).not.toContain("words");
  }
});

test("an edit gives a new image; a poem made private, then deleted, stops being served", async ({ page, request }) => {
  const id = unique();
  await signUpAs(page, `edit-${id}@example.com`, `Edit Poet ${id}`);
  const title = `Changing ${id}`;
  await publish(page, title, "the first version");
  const o = await poemRow(title);
  const path = `/p/${o.author}/${o.slug}/share-image`;

  const before = await request.get(path);
  const etag = before.headers()["etag"];
  const bytes = await before.body();
  const chatBefore = await request.get(`${path}?format=chat`);
  expect(pngSize(await chatBefore.body())).toEqual({ width: 1080, height: 1350 });

  // An edit: a different picture, and the old ETag no longer matches.
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("the second version\nwith a new line");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  const after = await request.get(path, { headers: { "If-None-Match": etag } });
  expect(after.status()).toBe(200);
  // The chat size too (round 2): its own cached picture, refreshed by the same edit.
  const chatAfter = await request.get(`${path}?format=chat`, { headers: { "If-None-Match": chatBefore.headers()["etag"] } });
  expect(chatAfter.status()).toBe(200);
  expect(chatAfter.headers()["etag"]).not.toBe(chatBefore.headers()["etag"]);
  expect((await chatAfter.body()).equals(await chatBefore.body())).toBe(false);
  expect(pngSize(await chatAfter.body())).toEqual({ width: 1080, height: 1350 });
  expect(after.headers()["etag"]).not.toBe(etag);
  expect((await after.body()).equals(bytes)).toBe(false);

  // A pen-name change shows on the image too.
  const etag2 = after.headers()["etag"];
  await page.goto("/admin/profile");
  await page.getByRole("textbox", { name: "Pen name" }).fill(`Renamed Poet ${id}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  const renamed = await request.get(path, { headers: { "If-None-Match": etag2 } });
  expect(renamed.status()).toBe(200);
  expect(renamed.headers()["etag"]).not.toBe(etag2);

  // Made private: gone at once, even for a browser holding the last ETag.
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("now-private");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  const priv = await request.get(path, { headers: { "If-None-Match": renamed.headers()["etag"] } });
  expect(priv.status()).toBe(404);
  // And the reading page no longer offers it.
  await page.goto(`/p/${o.author}/${o.slug}`);
  await expect(page.getByRole("button", { name: "Unlock poem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share as image" })).toHaveCount(0);

  // Deleted: still a 404.
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("button", { name: "Delete poem" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete poem" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect((await request.get(path)).status()).toBe(404);
});

/* ---- Round 2: the chat size, choosing lines, writers' buttons -------------------- */

const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);
/** Click a choice the way people do: on its label (the radio inside is visually hidden). */
const choose = (page: Page, name: RegExp) => sheet(page).locator("label").filter({ has: page.getByRole("radio", { name }) }).click();
const shareButton = (page: Page) => sheet(page).getByRole("button", { name: "Share", exact: true });
const previewSize = (page: Page) => preview(page).evaluate((img: HTMLImageElement) => [img.complete, img.naturalWidth, img.naturalHeight]);

test("the size toggle: preview and shared file follow it, and Share never sends the other one", async ({ page, context }) => {
  await stubShare(context);
  const id = unique();
  const pen = `Sizer ${id}`;
  await signUpAs(page, `sizer-${id}@example.com`, pen);
  const title = `Two sizes ${id}`;
  await publish(page, title, "Sɛ wo werɛ fi na wosankɔfa a,\nyɛnkyiri.");
  const o = await poemRow(title);

  await page.goto(`/p/${o.author}/${o.slug}`);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expect(sheet(page).getByRole("radio", { name: /Status or Story/ })).toBeChecked();
  await expect.poll(() => previewSize(page)).toEqual([true, 1080, 1920]);
  await shareButton(page).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);

  // Chat, held back on the network: until its file is here, Share is disabled and sends nothing.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const chatWhole = (url: URL) => url.pathname.endsWith("/share-image") && url.searchParams.get("format") === "chat" && !url.searchParams.has("lines");
  await page.route(chatWhole, async (route) => {
    await held;
    await route.continue();
  });
  await choose(page, /^Chat/);
  await expect(sheet(page).getByRole("radio", { name: /Chat/ })).toBeChecked();
  await expect(shareButton(page)).toHaveAttribute("aria-disabled", "true");
  await shareButton(page).click({ force: true }); // aria-disabled: Playwright won't click it otherwise
  await page.waitForTimeout(300);
  expect((await shared(page)).length).toBe(1);
  release();
  await expect(shareButton(page)).not.toHaveAttribute("aria-disabled");
  await expect.poll(() => previewSize(page)).toEqual([true, 1080, 1350]);
  await shareButton(page).click();
  await expect.poll(async () => (await shared(page)).length).toBe(2);
  await page.unroute(chatWhole);

  // And back: the Status file again, at once (kept for the sheet's life).
  await choose(page, /^Status or Story/);
  await expect.poll(() => previewSize(page)).toEqual([true, 1080, 1920]);
  await shareButton(page).click();
  await expect.poll(async () => (await shared(page)).length).toBe(3);

  const files = (await shared(page)).map((x) => x.files[0]);
  expect(files.map((f) => [f.name, f.width, f.height])).toEqual([
    [`inkboard-${o.slug}.png`, 1080, 1920],
    [`inkboard-${o.slug}-chat.png`, 1080, 1350],
    [`inkboard-${o.slug}.png`, 1080, 1920],
  ]);
  const text = `“${title}” by ${pen}, on InkBoard: ${E2E_BASE_URL}/p/${o.author}/${o.slug}`;
  expect((await shared(page)).map((x) => [x.text, x.active])).toEqual([[text, true], [text, true], [text, true]]);
});

const LONG = [
  "Nùnyá, àdìdòé,",
  "àsí mètúnɛ́ ò.",
  "Ƒè ɖèká mèɖɔ̀a ŋkɔ́ ò,",
  "ʋɔ̀ ɣè dzí ɖè.",
  "",
  ...Array.from({ length: 14 }, (_, i) => `line ${i + 6} of the long poem`),
].join("\n");

test("choose lines: mouse and keyboard, the cap, back to the whole poem, and Share sends the picked image", async ({ page, context }) => {
  await stubShare(context);
  const id = unique();
  const pen = `Picker ${id}`;
  await signUpAs(page, `picker-${id}@example.com`, pen);
  const title = `Many lines ${id}`;
  await publish(page, title, LONG);
  const o = await poemRow(title);
  // Tagged Ewe before anything about it is cached, so the picker's lines carry lang="ee".
  await sql(`UPDATE poems SET language = 'ee' WHERE id = '${o.id}'`);
  const requested: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/share-image")) requested.push(new URL(r.url()).search);
  });

  await page.goto(`/p/${o.author}/${o.slug}`);
  await page.getByRole("main").getByRole("button", { name: "Share as image" }).click();
  await expectPreview(page, title, pen);
  await choose(page, /^Choose lines$/);
  const picker = sheet(page).getByRole("group", { name: "Lines for the image" });
  const line = (n: number) => picker.getByRole("checkbox", { name: new RegExp(`^Line ${n}: `) });
  // One box per line of text, none for the stanza break; Ewe letters and tone marks as written.
  await expect(picker.getByRole("checkbox")).toHaveCount(18);
  await expect(line(2)).toHaveAccessibleName("Line 2: àsí mètúnɛ́ ò.".normalize("NFC"));
  await expect(picker.locator('[lang="ee"]').first()).toBeVisible();
  await expect(sheet(page).getByText("Pick the lines for your image.")).toBeVisible();
  await expect(shareButton(page)).toHaveAttribute("aria-disabled", "true");
  for (const b of await picker.getByRole("checkbox").all()) {
    const box = await b.evaluate((el) => el.closest("label")!.getBoundingClientRect().height);
    expect(box).toBeGreaterThanOrEqual(44);
  }

  // Mouse for line 4, keyboard for line 6: the stanza break between them stays.
  await line(4).click();
  await line(6).focus();
  await page.keyboard.press("Space");
  await expect(line(6)).toBeChecked();
  await expect(picker.getByRole("status")).toHaveText("2 of 12 lines picked.");
  await expect(preview(page)).toHaveAttribute("alt", `Preview of the image: lines from “${title}” by ${pen}, with its InkBoard address.`);
  await expect.poll(() => previewSize(page)).toEqual([true, 1080, 1920]);
  await shareButton(page).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  const [s] = await shared(page);
  expect(s.files[0]).toMatchObject({ name: `inkboard-${o.slug}-lines.png`, width: 1080, height: 1920 });
  expect(s.text).toBe(`“${title}” by ${pen}, on InkBoard: ${E2E_BASE_URL}/p/${o.author}/${o.slug}`);
  expect(requested).toContain("?lines=4-6");

  // Chat size for the same pick.
  await choose(page, /^Chat/);
  await expect.poll(() => previewSize(page)).toEqual([true, 1080, 1350]);
  expect(requested).toContain("?format=chat&lines=4-6");

  // The cap: twelve, then the rest are refused and the count says why.
  for (const n of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) await line(n).click();
  await expect(picker.getByRole("status")).toHaveText("12 of 12 lines picked, the most for one image.");
  await expect(line(17)).toHaveAttribute("aria-disabled", "true");
  await line(17).click({ force: true });
  await expect(line(17)).not.toBeChecked();
  await line(17).focus();
  await page.keyboard.press("Space");
  await expect(line(17)).not.toBeChecked();
  await expect(line(17)).toBeFocused();
  // Twelve long-ish lines don't all fit on a chat picture: the sheet says so.
  await expect(sheet(page).locator("[data-share-cut]")).toContainText(/Only the first \d+ of your 12 lines fit/);
  await noSidewaysScroll(page, "picker");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Back to the whole poem: one action, and the picks are kept for later.
  await choose(page, /^Whole poem$/);
  await expect(preview(page)).toHaveAttribute("alt", `Preview of the image: “${title}” by ${pen}, with lines from the poem and its InkBoard address.`);
  await expect(picker).toHaveCount(0);
  await choose(page, /^Choose lines$/);
  await expect(sheet(page).getByRole("group", { name: "Lines for the image" }).getByRole("status")).toHaveText(
    "12 of 12 lines picked, the most for one image.",
  );
});

test("the route, round 2: the chat size, the lines JSON, and 404 or 400 for anything else", async ({ page, request }) => {
  const id = unique();
  await signUpAs(page, `route2-${id}@example.com`, `Route Two ${id}`);
  await publish(page, `Open ${id}`, "one\ntwo\n\nfour");
  await publish(page, `Shut ${id}`, `private words ${id}\nmore private words`, "route-pass");
  const o = await poemRow(`Open ${id}`);
  const base = `/p/${o.author}`;

  const chat = await request.get(`${base}/open-${id}/share-image?format=chat`);
  expect(chat.status()).toBe(200);
  expect(pngSize(await chat.body())).toEqual({ width: 1080, height: 1350 });
  const picked = await request.get(`${base}/open-${id}/share-image?format=chat&lines=2-4`);
  expect(picked.status()).toBe(200);
  expect(picked.headers()["cache-control"]).toBe("private, no-cache");
  expect(picked.headers()["x-share-lines-shown"]).toBe("2");
  expect((await request.get(`${base}/open-${id}/share-image?lines=2-4`, { headers: { "If-None-Match": (await request.get(`${base}/open-${id}/share-image?lines=2-4`)).headers()["etag"] } })).status()).toBe(304);

  const lines = await request.get(`${base}/open-${id}/share-image/lines`);
  expect(lines.status()).toBe(200);
  expect(await lines.json()).toEqual({ language: null, lines: ["one", "two", "", "four"] });

  // A private poem: the plain 404 for every format, selection and the lines, its text nowhere.
  for (const q of ["", "?format=chat", "?lines=1", "?lines=1-2", "?lines=zzz", "/lines"]) {
    const path = q === "/lines" ? `${base}/shut-${id}/share-image/lines` : `${base}/shut-${id}/share-image${q}`;
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text(), path).toBe("Not found");
  }
  // Unknown format: 404. Bad selections on the public poem: 400, never cached.
  expect((await request.get(`${base}/open-${id}/share-image?format=square`)).status()).toBe(404);
  for (const bad of ["0", "5", "3", "1,1", "2,1", "1,2", "a", "1-13"]) {
    const res = await request.get(`${base}/open-${id}/share-image?lines=${bad}`);
    expect(res.status(), bad).toBe(400);
    expect(res.headers()["cache-control"], bad).toContain("no-store");
  }
});

test("writers: share from the dashboard after publishing and from a row's menu; never private poems or drafts", async ({ page }) => {
  const id = unique();
  const pen = `Writer ${id}`;
  await signUpAs(page, `writer-${id}@example.com`, pen);
  const open = `Shared ${id}`;
  await publish(page, open, "a line to share\nand another");

  // Right after the first publish: the marked row carries Share as image.
  const row = page.locator("[data-just-published]").filter({ visible: true });
  const button = row.getByRole("button", { name: "Share as image" });
  await expect(button).toBeVisible();
  await button.click();
  await expectPreview(page, open, pen);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(button).toBeFocused();

  // The row menu: the same sheet, focus back on the menu button.
  const menu = page.getByRole("button", { name: `Actions for ${open}` }).filter({ visible: true });
  await menu.click();
  await page.getByRole("menuitem", { name: "Share as image" }).click();
  await expectPreview(page, open, pen);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(menu).toBeFocused();

  // A private poem: no button on its just-published row, nothing in its menu.
  const locked = `Locked ${id}`;
  await publish(page, locked, "not for sharing", "writer-pass");
  await expect(page.locator("[data-just-published]").filter({ visible: true })).toContainText(locked);
  await expect(page.locator("[data-just-published]").filter({ visible: true }).getByRole("button", { name: "Share as image" })).toHaveCount(0);
  await page.getByRole("button", { name: `Actions for ${locked}` }).filter({ visible: true }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Share as image" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A draft: none either.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Draft ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("not yet");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Poem created")).toBeVisible();
  await page.goto("/admin");
  await page.getByRole("button", { name: `Actions for Draft ${id}` }).filter({ visible: true }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Share as image" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Made private: the menu item is gone on the next render.
  const o = await poemRow(open);
  await page.goto(`/admin/poems/${o.id}`);
  await page.getByRole("switch", { name: "Password protected" }).click();
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill("now-private");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved and published")).toBeVisible();
  await page.goto("/admin");
  await page.getByRole("button", { name: `Actions for ${open}` }).filter({ visible: true }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Share as image" })).toHaveCount(0);
});

test("writers on a phone: the just-published card's button, no sideways scrolling", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const id = unique();
  await signUpAs(page, `phone-writer-${id}@example.com`, `Phone Writer ${id}`);
  const title = `Pocket ${id}`;
  await publish(page, title, "small enough for a pocket");
  const card = page.locator("[data-just-published]").filter({ visible: true });
  await expect(card.getByRole("button", { name: "Share as image" })).toBeVisible();
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}px`).toBeLessThanOrEqual(0);
  }
  await card.getByRole("button", { name: "Share as image" }).click();
  await expect(preview(page)).toBeVisible();
  await noSidewaysScroll(page, "dashboard sheet");
  await context.close();
});
