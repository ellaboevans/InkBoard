import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_CRON_SECRET } from "../playwright.config";
import { signUpAs, sql, takedownNoticesFor } from "./helpers";

/*
 * The owner's takedown (docs/PLAN.md, Phase 32 round 2), on a phone: the
 * owner hides a poem through POST /api/owner/takedown (what `pnpm
 * content:hide` calls) and it's missing everywhere: its page is a real 404,
 * it's gone from the board and the author page, its short link is missing,
 * and the writer's dashboard says "Hidden by InkBoard". Restoring brings it
 * all back. Hiding an author makes their page, novel and chapter 404s.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
const shortCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

async function takedown(request: APIRequestContext, link: string, action: "hide" | "restore") {
  const res = await request.post("/api/owner/takedown", {
    headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
    data: { link, action },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { changed: boolean; kind: string; path: string };
}

async function status(page: Page, path: string) {
  return (await page.request.get(path, { maxRedirects: 0 })).status();
}

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

test("hiding a poem: a 404 page, gone from the board, author page and short link, marked on the dashboard; restore brings it back", async ({ page }) => {
  test.setTimeout(600_000);
  const id = unique();
  const email = `takedown-${id}@example.com`;
  await signUpAs(page, email, `Hidden Poet ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const slug = rows[0].slug as string;
  const title = `Dusk ${id}`;
  const code = shortCode();
  await sql(`WITH p AS (INSERT INTO poems (editor_id, title, slug, body, visibility, status, published_at)
      VALUES ('${rows[0].id}', '${title}', 'dusk', 'The light goes.', 'public', 'published', now()) RETURNING id)
    INSERT INTO short_links (poem_id, code) SELECT id, '${code}' FROM p`);
  // A second poem that stays shown: the board keeps their section (and isn't empty when run alone).
  const other = `Still here ${id}`;
  await sql(`INSERT INTO poems (editor_id, title, slug, body, visibility, status, published_at)
    VALUES ('${rows[0].id}', '${other}', 'still-here', 'Another line.', 'public', 'published', now())`);
  const path = `/p/${slug}/dusk`;

  // Shown: the page, the author page, the short link.
  expect(await status(page, path)).toBe(200);
  expect(await status(page, `/s/${code}`)).toBe(302);
  await page.goto(`/a/${slug}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // The owner hides it.
  expect(await takedown(page.request, path, "hide")).toMatchObject({ changed: true, kind: "poem", path });
  const missing = await page.goto(path);
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  expect(await status(page, `/s/${code}`)).toBe(404);
  await page.goto(`/a/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: `Hidden Poet ${id}` })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  await openBoard(page);
  await expect(page.getByRole("link", { name: other })).toHaveCount(1);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);

  // The writer: the dashboard marks it, says so at the top, with the contact; one email.
  await page.goto("/admin");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "InkBoard has hidden one of your poems from readers" })).toBeVisible();
  await expect(main.getByRole("listitem").filter({ hasText: title }).getByText("Hidden by InkBoard")).toBeVisible();
  await expect(main.locator("[data-hidden-notice]").getByRole("link", { name: /@/ })).toHaveAttribute("href", /^mailto:/);
  await expect.poll(() => takedownNoticesFor(email)).toEqual([{ change: "hidden", what: "poem", title }]);

  // Hiding it again changes nothing and sends nothing.
  expect(await takedown(page.request, `/s/${code}`, "hide")).toMatchObject({ changed: false });
  expect(await takedownNoticesFor(email)).toHaveLength(1);

  // Restored: everything is back, exactly as it was.
  expect(await takedown(page.request, path, "restore")).toMatchObject({ changed: true });
  expect(await status(page, path)).toBe(200);
  expect(await status(page, `/s/${code}`)).toBe(302);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await page.goto(`/a/${slug}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await openBoard(page);
  await expect(page.getByRole("link", { name: title })).toHaveCount(1);
  await page.goto("/admin");
  await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: title })).toBeVisible();
  await expect(page.getByText("Hidden by InkBoard")).toHaveCount(0);
  await expect(page.locator("[data-hidden-notice]")).toHaveCount(0);
  await expect.poll(async () => (await takedownNoticesFor(email)).map((n) => n.change)).toEqual(["hidden", "restored"]);
});

test("hiding an author: their page, novel and chapter are 404s until restored", async ({ page }) => {
  test.setTimeout(240_000);
  const id = unique();
  const slug = `hidden-author-${id}`;
  const { rows } = await sql(
    `INSERT INTO editors (email, pen_name, slug) VALUES ('hidden-author-${id}@example.com', 'Hidden Author ${id}', '${slug}') RETURNING id`,
  );
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', 'Crossing ${id}', 'crossing') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, release_at, word_count)
    SELECT id, 'Landing', 'landing', 'It began on the shore.', 1, 'published'::poem_status, now(), now(), 5 FROM n`);
  const pages = [`/a/${slug}`, `/a/${slug}/n/crossing`, `/a/${slug}/n/crossing/landing`];
  for (const p of pages) expect(await status(page, p), p).toBe(200);

  expect(await takedown(page.request, `/a/${slug}`, "hide")).toMatchObject({ changed: true, kind: "author" });
  for (const p of pages) expect(await status(page, p), p).toBe(404);
  const res = await page.goto(`/a/${slug}/n/crossing`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();

  expect(await takedown(page.request, `/a/${slug}`, "restore")).toMatchObject({ changed: true });
  for (const p of pages) expect(await status(page, p), p).toBe(200);
  await page.goto(`/a/${slug}/n/crossing`);
  await expect(page.getByRole("heading", { level: 1, name: `Crossing ${id}` })).toBeVisible();
});
