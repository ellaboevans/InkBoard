import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./helpers";

/*
 * "Share a passage" (docs/PLAN.md, Phase 25 round 3), on a phone-sized
 * viewport: a reader opens a public novel's chapter, picks two paragraphs
 * (consecutive only, within 600 characters), trims the first to a sentence,
 * sees the preview and downloads the PNG; the picture's short link leads to
 * the chapter. A private novel's chapter has no button, and its picture's
 * address is the same 404 as a missing chapter's.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A browser that can't share files, so Download image is the main action (most desktops; headless Chrome). */
async function noShare(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  });
}

const LONG = `${"The water kept its own counsel, and the boatmen kept theirs. ".repeat(11).trim()}`;

/** An author with a public novel (three paragraphs, the third over the cap on its own) and a private one. */
async function setUp() {
  const id = unique();
  const author = `share-novelist-${id}`;
  const { rows } = await sql(
    `INSERT INTO editors (email, pen_name, slug, password_mode, shared_password_hash)
     VALUES ('${author}@example.com', 'Ama Sɛwaa ${id}', '${author}', 'shared', 'scrypt$x') RETURNING id`,
  );
  const ed = rows[0].id as string;
  const body = [
    "The ferry came late. Akua waited at the landing with her basket.",
    "Kwabena did not come back. The radio stayed on the shelf.",
    LONG,
  ].join("\\n\\n");
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${ed}', 'The Ferry at Yeji', 'ferry') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count)
    SELECT id, 'Thursday', 'thursday', E'${body}', 1, 'published', now(), 60 FROM n`);
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, visibility) VALUES ('${ed}', 'Behind the Door', 'door', 'private') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count)
    SELECT id, 'One', 'one', 'SECRET-PRIVATE-CHAPTER. It must never be drawn.', 1, 'published', now(), 6 FROM n`);
  return { author };
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "Share a passage" });

test("a reader picks two paragraphs, trims the first, downloads the picture; its short link leads to the chapter", async ({ browser }) => {
  test.slow();
  const { author } = await setUp();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await noShare(context);
  const page = await context.newPage();
  const chapter = `/a/${author}/n/ferry/thursday`;
  await page.goto(chapter);

  const open = page.getByRole("button", { name: "Share a passage" });
  await expect(open).toBeVisible();
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await open.click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  await expect(s.getByText("Pick one or more paragraphs next to each other, up to 600 characters.")).toBeVisible();
  // Nothing to share yet.
  await expect(s.getByRole("button", { name: "Download image" })).toHaveAttribute("aria-disabled", "true");

  const p1 = s.getByRole("checkbox", { name: /^Paragraph 1: The ferry came late/ });
  const p2 = s.getByRole("checkbox", { name: /^Paragraph 2: Kwabena/ });
  const p3 = s.getByRole("checkbox", { name: /^Paragraph 3: The water/ });
  expect((await s.locator("[data-passage-picker] label").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await p1.check();
  await p2.check();
  // The third would go past 600 characters: aria-disabled, and ticking it does nothing.
  await expect(p3).toHaveAttribute("aria-disabled", "true");
  await p3.click({ force: true });
  await expect(p3).not.toBeChecked();
  // Trim the first paragraph to its second sentence.
  await s.getByLabel("Start at").selectOption("2");
  const count = "Akua waited at the landing with her basket.".length + 1 + "Kwabena did not come back. The radio stayed on the shelf.".length;
  await expect(s.locator("[data-passage-count]")).toHaveText(`${count} of 600 characters.`);

  const preview = s.getByRole("img", { name: /^Preview of the image: a passage from “The Ferry at Yeji”, chapter 1/ });
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => [img.complete, img.naturalWidth, img.naturalHeight]), { timeout: 45_000 }).toEqual([
    true,
    1080,
    1920,
  ]);
  const download = s.getByRole("button", { name: "Download image" });
  await expect(download).not.toHaveAttribute("aria-disabled");
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("inkboard-ferry-thursday-passage.png");
  expect(pngSize(await readFile((await file.path())!))).toEqual({ width: 1080, height: 1920 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // The same picture from the route: it prints the chapter's short address, which redirects to the chapter.
  const image = await page.request.get(`${chapter}/share-image?passage=1.2-2`);
  expect(image.status()).toBe(200);
  const address = image.headers()["x-share-address"];
  expect(address).toMatch(/^\/s\/[a-z0-9]{6}$/);
  const hop = await page.request.get(address, { maxRedirects: 0 });
  expect(hop.status()).toBe(302);
  expect(new URL(hop.headers()["location"], "http://x").pathname).toBe(chapter);
  expect(hop.headers()["cache-control"]).toContain("no-store");
  await page.goto(address);
  await expect(page).toHaveURL(new RegExp(`${chapter}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Thursday" })).toBeVisible();
  await context.close();
});

test("a private novel's chapter: no Share a passage button, and its picture and paragraphs are the same 404 as a missing chapter's", async ({ page, request }) => {
  const { author } = await setUp();
  await page.goto(`/a/${author}/n/door/one`);
  await expect(page.getByText("This novel is password protected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share a passage" })).toHaveCount(0);
  for (const path of [`/a/${author}/n/door/one`, `/a/${author}/n/ferry/no-such-chapter`]) {
    for (const suffix of ["/share-image?passage=1", "/share-image?format=chat&passage=junk", "/share-image/passage"]) {
      const res = await request.get(path + suffix);
      expect(res.status(), path + suffix).toBe(404);
      expect(await res.text()).toBe("Not found");
      expect(res.headers()["cache-control"]).toContain("no-store");
    }
  }
  // Nothing was made or counted for it.
  const { rows } = await sql(`SELECT count(*)::int AS n FROM short_links sl JOIN chapters c ON c.id = sl.chapter_id WHERE c.slug = 'one'`);
  expect(rows[0].n).toBe(0);
  expect((await sql(`SELECT count(*)::int AS n FROM rate_limits WHERE key LIKE 'share:render:%'`)).rows[0].n).toBe(0);
});
