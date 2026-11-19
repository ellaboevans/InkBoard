import { expect, test, type APIRequestContext } from "@playwright/test";
import { expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * Stats for writers (docs/PLAN.md, Phase 27), on a phone: a writer publishes
 * a poem and a chapter, their pictures make short links, readers on different
 * networks open them, and /admin/stats shows the visits (most visited first),
 * the novel's numbers and the follower count; another writer sees none of it.
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A short link for one poem or chapter, with a fresh code from the links' alphabet (src/lib/share-image/short-code.ts). */
const ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
async function shortLink(target: { poem: string } | { chapter: string }) {
  const code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
  const [column, id] = "poem" in target ? ["poem_id", target.poem] : ["chapter_id", target.chapter];
  await sql(`INSERT INTO short_links (${column}, code) VALUES ('${id}', '${code}')`);
  return `/s/${code}`;
}

/** Open a short link as a reader on `network`, and wait until the visit is counted. */
async function visit(request: APIRequestContext, address: string, network: string) {
  const res = await request.get(address, { maxRedirects: 0, headers: { "x-forwarded-for": network } });
  expect(res.status(), address).toBe(302);
}

test("a writer's stats show their links' visits, their novel and followers; another writer sees none of it", async ({ page, browser, request }) => {
  test.slow();
  const id = unique();
  const email = `stats-${id}@example.com`;
  await signUpAs(page, email, `Stats Poet ${id}`);
  const { rows: who } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const { id: editorId, slug } = who[0] as { id: string; slug: string };

  // Nothing yet.
  await page.goto("/admin/stats");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();
  await expect(main.getByText("No shared links yet.")).toBeVisible();
  await expect(main.getByText("No novels yet.")).toBeVisible();
  await expect(main.locator('[data-stat="followers"]')).toHaveText("Fewer than 3");

  // A poem, published from the editor, with a short link (made here directly: drawing its picture on a cold
  // dev server is slow, and e2e/share-image.spec.ts covers how pictures make links).
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Harmattan ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("the dry wind writes");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);
  const { rows: p } = await sql(`SELECT id FROM poems WHERE editor_id = '${editorId}'`);
  const poemAddress = await shortLink({ poem: p[0].id });

  // A novel with a published chapter and a draft (written straight to the database: new slugs, nothing cached).
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${editorId}', 'The Ferry ${id}', 'ferry') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count, release_at)
    SELECT n.id, c.title, c.slug, c.body, c.position, c.status::poem_status, c.published_at, c.words, c.published_at FROM n,
      (VALUES ('Thursday', 'thursday', 'The ferry came late. Akua waited at the landing.', 1, 'published', now(), 2300),
              ('Next', 'next', 'Not yet.', 2, 'draft', NULL::timestamptz, 2)) AS c(title, slug, body, position, status, published_at, words)`);
  const { rows: ch } = await sql(
    `SELECT c.id FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE n.editor_id = '${editorId}' AND c.slug = 'thursday'`,
  );
  const chapterAddress = await shortLink({ chapter: ch[0].id });

  // Readers open the links: the chapter from three networks, the poem from one; a repeat and a link preview don't count.
  for (const net of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) await visit(request, chapterAddress, net);
  await visit(request, poemAddress, "198.51.100.1");
  await visit(request, poemAddress, "198.51.100.1");
  await request.get(poemAddress, { maxRedirects: 0, headers: { "x-forwarded-for": "198.51.100.9", "user-agent": "WhatsApp/2.23" } });
  await expect
    .poll(async () => (await sql(`SELECT sum(visits)::int AS n FROM short_links`)).rows[0].n, { timeout: 15_000 })
    .toBe(4);

  // Three devices follow the writer.
  for (let i = 0; i < 3; i++) {
    await sql(`WITH s AS (INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('https://fcm.googleapis.com/fcm/send/stats-${id}-${i}', 'k', 'a') RETURNING id)
      INSERT INTO push_follows (subscription_id, editor_id) SELECT id, '${editorId}' FROM s`);
  }

  await page.goto("/admin/stats");
  const rows = main.locator("[data-link-row]");
  await expect(rows).toHaveCount(2);
  // Most visited first: the chapter (3), then the poem (1).
  await expect(rows.nth(0)).toContainText(`The Ferry ${id}`);
  await expect(rows.nth(0)).toContainText("Chapter 1 · Thursday");
  await expect(rows.nth(0)).toContainText("3 visits");
  await expect(rows.nth(1)).toContainText(`Harmattan ${id}`);
  await expect(rows.nth(1)).toContainText("1 visit");
  await expect(main.locator('[data-stat="link-visits"]')).toHaveText("4 visits");
  const novel = main.locator("[data-novel-stats]");
  await expect(novel).toHaveCount(1);
  for (const [label, value] of [
    ["Published chapters", "1"],
    ["Drafts", "1"],
    ["Words", "2,300"],
    ["Reading time", "about 10 minutes"],
    ["Link visits", "3"],
  ]) {
    await expect(novel.getByRole("definition").filter({ has: page.locator(`xpath=preceding-sibling::dt[.="${label}"]`) })).toHaveText(value);
  }
  await expect(main.locator('[data-stat="followers"]')).toHaveText("3");
  await expect(main).toContainText("It counts devices, not people");
  // On a phone: nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // Another writer, in their own browser, sees only their own (empty) stats.
  const other = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const otherPage = await other.newPage();
  await signUpAs(otherPage, `stats-other-${id}@example.com`, `Other Poet ${id}`);
  await otherPage.goto("/admin/stats");
  const otherMain = otherPage.getByRole("main");
  await expect(otherMain.getByText("No shared links yet.")).toBeVisible();
  await expect(otherMain.getByText("No novels yet.")).toBeVisible();
  await expect(otherMain.locator('[data-stat="followers"]')).toHaveText("Fewer than 3");
  await expect(otherMain).not.toContainText(`Harmattan ${id}`);
  await expect(otherMain).not.toContainText(`The Ferry ${id}`);
  await other.close();

  // Readers never see these numbers: the author page and the poem page say nothing about visits or followers.
  await page.goto(`/a/${slug}`);
  await expect(page.getByRole("main")).not.toContainText(/\bvisits?\b/);
  await expect(page.getByRole("main")).not.toContainText(/devices follow/);
});
