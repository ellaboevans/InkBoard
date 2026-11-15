import { expect, test, type Page } from "@playwright/test";
import { signUpAs, sql } from "./helpers";

// Collections, round 2 (docs/PLAN.md, Phase 14): the public collection page,
// links to it, the board badge, share card and sitemap.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, opts: { password?: string; draft?: boolean; language?: string } = {}) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (opts.language) await page.getByRole("combobox", { name: "Language" }).selectOption({ label: opts.language });
  if (opts.password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(opts.password);
  }
  await page.getByRole("button", { name: opts.draft ? "Save draft" : "Publish to board" }).click();
  await expect(page.getByText("Poem created")).toBeVisible({ timeout: 45_000 });
}

async function createCollection(page: Page, title: string, intro: string, poems: string[]) {
  await page.goto("/admin/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  const dialog = page.getByRole("dialog", { name: "New collection" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(title);
  await dialog.getByRole("textbox", { name: /Intro/ }).fill(intro);
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/, { timeout: 45_000 });
  for (const t of poems) {
    await page.getByRole("combobox", { name: "Add a poem" }).selectOption({ label: t });
    await page.getByRole("button", { name: "Add to collection" }).click();
    await expect(page.getByRole("button", { name: `Remove “${t}” from the collection` })).toBeVisible();
  }
  return new URL(page.url()).pathname;
}

const cardTitles = (page: Page) =>
  page.getByRole("main").getByRole("list").filter({ has: page.locator("[data-part]") }).getByRole("listitem").getByRole("link");

test("the collection page: reached from a poem and the author page, in order, private title-only", async ({ page, request }) => {
  const id = unique();
  const email = `colpage-${id}@example.com`;
  const pen = `Collection Poet ${id}`;
  // Long on purpose: the board badge must truncate it.
  const cycle = `The Long Harmattan Cycle of Dust and Coins ${id}`;
  const [a, b, c, d] = [`Dust ${id}`, `Coin ${id}`, `Throat ${id}`, `Draft ${id}`];
  await signUpAs(page, email, pen);
  await publish(page, a, "Dust on the windowsill,\n  dust in the throat", { language: "Ewe" });
  await publish(page, b, `secret coin text ${id}`, { password: "coin-pass" });
  await publish(page, c, "the sky a pale coin");
  await publish(page, d, `draft text ${id}`, { draft: true });
  const adminUrl = await createCollection(page, cycle, "Dry wind,\nseven days.", [a, b, d, c]);
  const { rows } = await sql(`SELECT e.slug AS author, c.slug FROM collections c JOIN editors e ON e.id = c.editor_id WHERE e.email = '${email}'`);
  const { author, slug } = rows[0] as { author: string; slug: string };
  const pageUrl = `/a/${author}/c/${slug}`;
  const poemSlug = (t: string) => t.toLowerCase().replace(/ /g, "-");

  // From the reading page: "Part 1 of 3 · <collection>" links to it.
  await page.goto(`/p/${author}/${poemSlug(a)}`);
  await page.getByRole("main").getByRole("link", { name: cycle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${pageUrl}$`));
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: cycle })).toBeVisible();
  await expect(main.getByRole("link", { name: pen, exact: true })).toHaveAttribute("href", `/a/${author}`);
  await expect(main).toContainText("Dry wind,\nseven days.");
  await expect(main).toContainText("3 poems · 1 password protected");
  // Published poems in reading order, numbered 1..3 without the draft.
  await expect(cardTitles(page)).toHaveText([a, `${b} (password protected)`, c]);
  await expect(main.locator("[data-part]")).toHaveText(["1", "2", "3"].map((n) => new RegExp(`^${n}`)));
  const html = await page.content();
  expect(html).not.toContain(`secret coin text ${id}`);
  expect(html).not.toContain(d);
  expect(html).not.toContain(`draft text ${id}`);
  expect(html).not.toContain(email);
  // Its own canonical, description and JSON-LD.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${pageUrl}$`));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Dry wind, seven days.");
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((s) => JSON.parse(s));
  const series = ld.find((x) => x["@type"] === "CollectionPage")?.mainEntity;
  expect(series).toMatchObject({ "@type": "CreativeWorkSeries", name: cycle, author: { name: pen } });
  expect(series.hasPart.map((p: { name: string; position: number }) => [p.position, p.name])).toEqual([[1, a], [2, b], [3, c]]);
  expect(series.inLanguage).toBeUndefined(); // the poems don't share one language

  // The share card is an image; the sitemap lists the page.
  const og = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  const image = await request.get(new URL(og!).pathname);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(await (await request.get("/sitemap.xml")).text()).toContain(pageUrl);

  // From the author page: the Collections list (title, count, intro).
  await page.goto(`/a/${author}`);
  const listed = page.getByRole("main").getByRole("region", { name: "Collections" }).getByRole("link");
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText(cycle);
  await expect(listed).toContainText("3 poems");
  await expect(listed).toContainText("Dry wind,");
  await listed.click();
  await expect(page).toHaveURL(new RegExp(`${pageUrl}$`));

  // Neither page scrolls sideways on a small phone, even with a long collection title.
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of [`/a/${author}`, pageUrl]) {
    await page.goto(path);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // From the overlay too: the link leaves the overlay for the page.
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await page.getByRole("link", { name: c, exact: true }).click();
  await page.getByRole("dialog", { name: c }).getByRole("link", { name: cycle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${pageUrl}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: cycle })).toBeVisible();

  // A reorder in admin shows up at once (BOARD_TAG).
  await page.goto(adminUrl);
  await page.getByRole("button", { name: `Move “${c}” up` }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "Moved" })).toBeVisible();
  await page.goto(pageUrl);
  await expect(cardTitles(page)).toHaveText([a, `${b} (password protected)`, c]); // the draft sat between B and C
  await page.goto(adminUrl);
  await page.getByRole("button", { name: `Move “${c}” up` }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "Moved" })).toHaveText(new RegExp(`Moved “${c}” to position 2`));
  await page.goto(pageUrl);
  await expect(cardTitles(page)).toHaveText([a, c, `${b} (password protected)`]);
  await expect(page.getByRole("main").locator("[data-part]")).toHaveText([/^1/, /^2/, /^3/]);
});

test("unknown, empty and unpublished collections are not found", async ({ page }) => {
  const id = unique();
  const email = `colnf-${id}@example.com`;
  await signUpAs(page, email, `Nf Poet ${id}`);
  await publish(page, `Only draft ${id}`, "x", { draft: true });
  await createCollection(page, `Drafts only ${id}`, "", [`Only draft ${id}`]);
  await createCollection(page, `Empty ${id}`, "", []);
  const { rows } = await sql(`SELECT e.slug AS author, c.slug FROM collections c JOIN editors e ON e.id = c.editor_id WHERE e.email = '${email}' ORDER BY c.created_at`);
  for (const path of [`/a/${rows[0].author}/c/${rows[0].slug}`, `/a/${rows[1].author}/c/${rows[1].slug}`, `/a/${rows[0].author}/c/nope`, `/a/nobody-${id}/c/${rows[0].slug}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Collection not found" }), path).toBeVisible();
    const robots = await page.locator('meta[name="robots"]').evaluateAll((ms) => ms.map((m) => m.getAttribute("content")));
    expect(robots.some((r) => r?.includes("noindex")), path).toBe(true);
  }
  // Nor are they listed on the author page.
  await page.goto(`/a/${rows[0].author}`);
  await expect(page.getByRole("region", { name: "Collections" })).toHaveCount(0);
});

test("board cards show a quiet collection badge that fits on phones and desktops", async ({ page }) => {
  const id = unique();
  await signUpAs(page, `colbadge-${id}@example.com`, `Badge Poet ${id}`);
  const cycle = `An Unreasonably Long Collection Title About the Harmattan ${id}`;
  const [a, b] = [`Ŋutifafa ${id}`, `Locked ${id}`];
  await publish(page, a, "Ŋutifafa na wò", { language: "Ewe" });
  await publish(page, b, "secret", { password: "badge-pass", language: "Akan (Twi, Fante, Nzema)" });
  await createCollection(page, cycle, "", [a, b]);

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
    for (const [title, part] of [[a, 1], [`${b} (password protected)`, 2]] as const) {
      const card = page.locator("[data-card]").filter({ has: page.getByRole("link", { name: title, exact: true }) });
      const badge = card.locator("[data-collection-badge]");
      await expect(badge).toContainText(`· ${part}/2`);
      await expect(badge).toContainText(`part ${part} of 2`); // spoken
      const m = await card.evaluate((el) => {
        const box = (e: Element) => e.getBoundingClientRect();
        const b = el.querySelector("[data-collection-badge]")!;
        const name = b.querySelector("span.truncate")!;
        const header = [...el.querySelectorAll("[data-lock-badge], .rounded-full.border")].map(box);
        return { card: box(el), badge: box(b), header, truncated: name.scrollWidth > name.clientWidth, lineHeight: parseFloat(getComputedStyle(b).lineHeight) };
      });
      const where = `${title} at ${width}px`;
      // One line, inside the card, not touching the language label or lock.
      expect(m.badge.height, where).toBeLessThan(m.lineHeight * 1.6);
      expect(m.badge.left, where).toBeGreaterThanOrEqual(m.card.left);
      expect(m.badge.right, where).toBeLessThanOrEqual(m.card.right + 0.5);
      expect(m.badge.bottom, where).toBeLessThanOrEqual(m.card.bottom + 0.5);
      for (const h of m.header) expect(h.bottom <= m.badge.top || h.top >= m.badge.bottom, where).toBe(true);
      expect(m.truncated, `${where}: long title truncated`).toBe(true);
    }
    // The list view shows the same badge.
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(page.getByRole("main").getByRole("link", { name: new RegExp(`^${a}`) }).locator("[data-collection-badge]")).toContainText("· 1/2");
  }
});
