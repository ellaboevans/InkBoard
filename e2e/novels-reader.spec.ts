import { expect, test, type Page } from "@playwright/test";
import { expectBackOnList, signUpAs, sql } from "./helpers";

/*
 * Reading novels (docs/PLAN.md, Phase 23b), on a phone-sized viewport with
 * one desktop check: the book card on the board and the author page, the
 * novel page, reading a chapter and the next, "Continue: Chapter n" from
 * this browser's saved place, real 404s for drafts, unpublishing, and no
 * sideways scrolling at 320, 375 and 1280 px. Round 2: the list view, and
 * what search engines and link previews get (canonical, descriptions,
 * JSON-LD, link card images, the sitemap).
 */

test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const toast = (page: Page, title: string) => page.locator("[data-sileo-toast]").getByText(title, { exact: true }).first();

async function noSidewaysScroll(page: Page, where: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), where).toBeLessThanOrEqual(0);
}

async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
}

/** "New chapter" on the writer's novel page, then save it as a draft or publish it. */
async function addChapter(page: Page, novelAdminUrl: string, title: string, body: string, publish: boolean) {
  await page.goto(novelAdminUrl);
  await page.getByRole("button", { name: "New chapter" }).click();
  await expect(page).toHaveURL(/\/chapters\/[0-9a-f-]{36}/, { timeout: 45_000 });
  await page.getByRole("textbox", { name: /Chapter title/ }).fill(title);
  await page.getByRole("textbox", { name: "Text" }).fill(body);
  await page.getByRole("button", { name: publish ? "Publish chapter" : "Save draft" }).click();
  await expect(toast(page, publish ? "Chapter published" : "Draft saved")).toBeVisible({ timeout: 45_000 });
  return new URL(page.url()).pathname;
}

/** The reading-place store as this browser holds it. */
const readingStore = (page: Page) => page.evaluate(() => localStorage.getItem("inkboard-reading"));

test("readers find a novel on the board and the author page, read on, continue where they stopped; drafts stay out", async ({ page, context }) => {
  test.slow();
  const id = unique();
  const email = `reader-novelist-${id}@example.com`;
  const pen = `Novel Reader ${id}`;
  const hydrationErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat/i.test(m.text())) hydrationErrors.push(m.text());
  });

  await signUpAs(page, email, pen);
  const { rows: who } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const author = who[0].slug as string;

  // A poem, so the section has both: the book card must come first.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Harmattan ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("the dry wind writes");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);

  // The novel, written in Akan (lang on its text only), with two published chapters and a draft.
  await page.goto("/admin/novels");
  await page.getByRole("button", { name: "New novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New novel" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("The Ferry at Yeji");
  await dialog.getByRole("textbox", { name: /Blurb/ }).fill("Every Thursday the ferry crosses the lake.");
  await dialog.getByRole("button", { name: "Create novel" }).click();
  await expect(page).toHaveURL(/\/admin\/novels\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const novelAdminUrl = new URL(page.url()).pathname;
  const novelId = novelAdminUrl.split("/").pop()!;
  // Before any chapter is published, so nothing about this novel is cached yet.
  await sql(`UPDATE novels SET language = 'ak' WHERE id = '${novelId}'`);
  await addChapter(page, novelAdminUrl, "Thursday", "The ferry came late.\n\n* * *\n\nAkua waited at the landing.", true);
  const landingAdminUrl = await addChapter(page, novelAdminUrl, "The Landing", "*Kwabena* did not come back.\n\nThe radio stayed.", true);
  await addChapter(page, novelAdminUrl, "SECRET DRAFT RADIO", "SECRET DRAFT TEXT", false);
  // A second novel with only a draft chapter: it doesn't exist for readers.
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${who[0].id}', 'Unready ${id}', 'unready') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position) SELECT id, 'Hidden', 'hidden', 'HIDDEN TEXT', 1 FROM n`);

  const novelUrl = `/a/${author}/n/the-ferry-at-yeji`;

  // The board: a book card in the author's section, in the first slot, before the poem.
  await openBoard(page);
  const section = page.locator(`section[aria-label="${pen}, 1 novel and 1 poem"]`);
  await expect(section).toBeAttached();
  const book = section.getByRole("link", { name: "The Ferry at Yeji (novel)" });
  await expect(book).toHaveAttribute("href", novelUrl);
  const bookCard = section.locator("[data-book-card]");
  await expect(bookCard).toHaveCount(1);
  await expect(bookCard).toContainText("2 chapters · ongoing");
  await expect(bookCard).toContainText("Every Thursday the ferry crosses the lake.");
  const rect = async (selector: string) => (await section.locator(selector).getAttribute("data-rect"))!.split(",").map(Number);
  const [bx, by, bw, bh] = await rect("[data-novel-id]");
  const [px, py] = await rect("[data-poem-id]");
  expect([bw, bh]).toEqual([264, 184]); // one ordinary card slot
  expect(by === py ? bx < px : by < py).toBe(true);
  await expect(section).not.toContainText("Unready");
  await expect(section).not.toContainText("SECRET");

  // The author page lists the novel.
  await page.goto(`/a/${author}`);
  const novelsRegion = page.getByRole("region", { name: "Novels" });
  await expect(novelsRegion.getByRole("link", { name: "The Ferry at Yeji (novel)" })).toHaveAttribute("href", novelUrl);
  await expect(novelsRegion).toContainText("2 chapters · ongoing");
  await expect(page.getByRole("main")).not.toContainText("Unready");
  await noSidewaysScroll(page, "author page");

  // The novel page: cover, title, author, facts, chapters (no draft), "Start reading".
  await novelsRegion.getByRole("link", { name: "The Ferry at Yeji (novel)" }).click();
  await expect(page).toHaveURL(novelUrl);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "The Ferry at Yeji" })).toHaveAttribute("lang", "ak");
  await expect(main.getByRole("link", { name: pen })).toHaveAttribute("href", `/a/${author}`);
  await expect(main.locator("[data-novel-facts]")).toContainText("2 chapters · about 1 min · in Akan");
  await expect(main.locator("[data-novel-cover]")).toBeVisible();
  const chapterLinks = main.getByRole("region", { name: "Chapters" }).getByRole("link");
  await expect(chapterLinks).toHaveCount(2);
  await expect(chapterLinks.nth(0)).toContainText("Thursday");
  await expect(chapterLinks.nth(1)).toContainText("The Landing");
  await expect(main).not.toContainText("SECRET");
  await expect(page.locator('meta[name="inkboard-offline"]')).toHaveAttribute("content", "save");
  await expect(page.locator('meta[name="inkboard-offline-kind"]')).toHaveAttribute("content", "novel");
  const start = main.getByRole("link", { name: "Start reading" });
  await expect(start).toHaveAttribute("href", `${novelUrl}/thursday`);

  // Chapter 1: the top bar, the text in the novel's language, then on to chapter 2.
  await start.click();
  await expect(page).toHaveURL(`${novelUrl}/thursday`);
  await expect(main.getByRole("heading", { level: 1, name: "Thursday" })).toHaveAttribute("lang", "ak");
  const bar = main.getByRole("navigation", { name: "Novel" });
  await expect(bar).toContainText("Chapter 1 of 2");
  await expect(bar.getByRole("link", { name: "The Ferry at Yeji" })).toHaveAttribute("href", novelUrl);
  const text = main.locator("[data-chapter-text]");
  await expect(text).toHaveAttribute("lang", "ak");
  await expect(text.locator("p")).toHaveText(["The ferry came late.", "Akua waited at the landing."]);
  await expect(text.getByRole("separator", { name: "Scene break" })).toBeVisible();
  // The UI around the text stays English: the bar and kicker inherit the page's lang.
  expect(await bar.evaluate((el) => el.closest("[lang]")?.getAttribute("lang"))).toBe("en");
  await expect(page.locator('meta[name="inkboard-offline"]')).toHaveAttribute("content", "save");
  await expect(page.locator('meta[name="inkboard-offline-kind"]')).toHaveAttribute("content", "chapter");
  // The bar stays at the top while reading.
  expect(await bar.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("sticky");
  await noSidewaysScroll(page, "chapter 1");
  const chapters = main.getByRole("navigation", { name: "Chapters" });
  await expect(chapters.getByRole("link", { name: "All chapters" })).toHaveAttribute("href", `${novelUrl}#chapters`);
  await chapters.getByRole("link", { name: /^Next chapter/ }).click();
  await expect(page).toHaveURL(`${novelUrl}/the-landing`);
  await expect(bar).toContainText("Chapter 2 of 2");
  await expect(text.locator("p").first()).toHaveText("Kwabena did not come back.");
  await expect(text.locator("em")).toHaveText("Kwabena");
  // The last published chapter: no next (the draft isn't one), a previous one.
  await expect(chapters.getByRole("link", { name: /^Next chapter/ })).toHaveCount(0);
  await expect(chapters).toContainText("That’s the latest chapter.");
  await expect(chapters.getByRole("link", { name: "Previous chapter: 1 · Thursday" })).toHaveAttribute("href", `${novelUrl}/thursday`);

  // Where you stopped: only in this browser, one key, no cookie.
  expect(JSON.parse((await readingStore(page))!)).toEqual({
    v: 1,
    novels: { [novelId]: { chapter: "the-landing", at: expect.any(String) } },
  });
  expect((await context.cookies()).some((c) => c.value.includes("the-landing") || /reading/i.test(c.name))).toBe(false);

  // Back on the novel page: "Continue: Chapter 2", rendered in the browser after hydration.
  await bar.getByRole("link", { name: "The Ferry at Yeji" }).click();
  await expect(page).toHaveURL(novelUrl);
  const cont = main.getByRole("link", { name: "Continue: Chapter 2 · The Landing" });
  await expect(cont).toHaveAttribute("href", `${novelUrl}/the-landing`);
  await expect(main.getByRole("link", { name: "Start from the beginning" })).toHaveAttribute("href", `${novelUrl}/thursday`);
  await expect(chapterLinks.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(chapterLinks.nth(1)).toContainText("You stopped here");
  // The server's HTML is the same for everyone: no saved place in it.
  const html = await (await page.request.get(novelUrl)).text();
  expect(html).toContain("Start reading");
  expect(html).not.toContain("Continue: Chapter");
  await noSidewaysScroll(page, "novel page with a saved place");

  // Real 404s on a hard load: the draft chapter, the draft-only novel and its chapter, unknown ones.
  for (const [path, heading] of [
    [`${novelUrl}/secret-draft-radio`, "Chapter not found"],
    [`${novelUrl}/nope`, "Chapter not found"],
    [`/a/${author}/n/unready`, "Novel not found"],
    [`/a/${author}/n/unready/hidden`, "Chapter not found"],
    [`/a/${author}/n/nope`, "Novel not found"],
  ] as const) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
    await expect(page.locator("body"), path).not.toContainText(/SECRET|HIDDEN|Unready/);
    expect((await page.request.head(path)).status(), `HEAD ${path}`).toBe(404);
  }

  // Unpublish chapter 2: the reader pages follow at once (BOARD_TAG).
  await page.goto(landingAdminUrl);
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(toast(page, "Chapter unpublished")).toBeVisible({ timeout: 45_000 });
  expect((await page.goto(`${novelUrl}/the-landing`))!.status()).toBe(404);
  await page.goto(novelUrl);
  await expect(main.locator("[data-novel-facts]")).toContainText("1 chapter ·");
  await expect(chapterLinks).toHaveCount(1);
  await expect(main).not.toContainText("The Landing");
  // The saved chapter isn't published any more: back to "Start reading", nothing marked.
  await expect(main.getByRole("link", { name: "Start reading" })).toBeVisible();
  await expect(main.getByRole("link", { name: /^Continue/ })).toHaveCount(0);
  await expect(chapterLinks.nth(0)).not.toHaveAttribute("aria-current", "step");
  await page.goto(`${novelUrl}/thursday`);
  await expect(bar).toContainText("Chapter 1 of 1");
  await expect(chapters.getByRole("link", { name: /^Next chapter/ })).toHaveCount(0);
  await openBoard(page);
  await expect(page.locator(`section[aria-label="${pen}, 1 novel and 1 poem"] [data-book-card]`)).toContainText("1 chapter · ongoing");

  // No sideways scrolling on the reader pages, phones to desktop.
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [`/a/${author}`, novelUrl, `${novelUrl}/thursday`]) {
      await page.goto(path);
      await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
      await noSidewaysScroll(page, `${path} at ${width}px`);
    }
  }

  // Desktop: the cover sits beside the title, the text keeps its reading measure, and the board's card opens the novel.
  await page.goto(novelUrl);
  const cover = (await main.locator("[data-novel-cover]").boundingBox())!;
  const title = (await main.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(cover.width).toBeGreaterThan(200);
  expect(cover.x + cover.width).toBeLessThan(title.x);
  await page.goto(`${novelUrl}/thursday`);
  const measure = (await text.boundingBox())!.width;
  expect(measure).toBeLessThanOrEqual(34 * 21);
  expect(await text.evaluate((el) => getComputedStyle(el).fontSize)).toBe("21px");
  await openBoard(page);
  await page.locator(`section[aria-label="${pen}, 1 novel and 1 poem"]`).getByRole("link", { name: "The Ferry at Yeji (novel)" }).click();
  await expect(page).toHaveURL(novelUrl);
  await expect(main.getByRole("heading", { level: 1, name: "The Ferry at Yeji" })).toBeVisible();

  expect(hydrationErrors).toEqual([]);
});

test("a phone reads at 19 px with a 1.7 line height, 18 px under 360 px", async ({ page }) => {
  const id = unique();
  const email = `reader-type-${id}@example.com`;
  await signUpAs(page, email, `Type Reader ${id}`);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  // Written straight to the database: a new slug isn't in any cache yet.
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', 'Measure', 'measure') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count)
    SELECT id, '', 'chapter', 'One paragraph of prose to measure.', 1, 'published', now(), 6 FROM n`);
  await page.goto(`/a/${rows[0].slug}/n/measure/chapter`);
  // No title of its own: the heading is "Chapter 1", in the UI's language.
  const h1 = page.getByRole("main").getByRole("heading", { level: 1, name: "Chapter 1" });
  await expect(h1).toBeVisible();
  expect(await h1.getAttribute("lang")).toBeNull();
  const text = page.locator("[data-chapter-text]");
  const style = () => text.evaluate((el) => ({ size: getComputedStyle(el).fontSize, line: getComputedStyle(el).lineHeight }));
  const phone = await style();
  expect(phone.size).toBe("19px");
  expect(parseFloat(phone.line)).toBeCloseTo(19 * 1.7, 1);
  await page.setViewportSize({ width: 320, height: 700 });
  expect((await style()).size).toBe("18px");
});

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("the list view lists novels by language; the pages give search engines and link previews what they need", async ({ page, request }) => {
  test.slow();
  const id = unique();
  const email = `reader-seo-${id}@example.com`;
  const pen = `Seo Novelist ${id}`;
  await signUpAs(page, email, pen);
  const { rows } = await sql(`SELECT id, slug FROM editors WHERE email = '${email}'`);
  const author = rows[0].slug as string;
  // Straight to the database: an Akan novel (two published chapters, one untitled, and a draft),
  // a draft-only novel, and two poems so the board offers Akan and English…
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug, blurb, language)
      VALUES ('${rows[0].id}', 'Ɔdɔ ne Ɛkɔm', 'odo', 'Akua waits at the landing for a brother who never came back.', 'ak') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position, status, published_at, word_count)
    SELECT id, t.title, t.slug, t.body, t.pos, t.status::poem_status, CASE WHEN t.status = 'published' THEN now() END, 9 FROM n,
      (VALUES ('Thursday', 'thursday', E'*Akua* waited at the landing.\n\n* * *\n\nThe ferry came late.', 1, 'published'),
              ('SECRET DRAFT', 'secret', 'SECRET TEXT', 2, 'draft'),
              ('', 'chapter', 'Second chapter.', 3, 'published')) AS t(title, slug, body, pos, status)`);
  await sql(`WITH n AS (INSERT INTO novels (editor_id, title, slug) VALUES ('${rows[0].id}', 'Unready ${id}', 'unready') RETURNING id)
    INSERT INTO chapters (novel_id, title, slug, body, position) SELECT id, 'Hidden', 'hidden', 'HIDDEN', 1 FROM n`);
  await sql(`INSERT INTO poems (editor_id, title, slug, body, status, published_at, language) VALUES
    ('${rows[0].id}', 'Akan poem ${id}', 'akan-${id}', 'nsuo', 'published', now(), 'ak'),
    ('${rows[0].id}', 'English poem ${id}', 'english-${id}', 'rain', 'published', now(), 'en')`);
  // …then a poem through the app, which refreshes the board's cache.
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(`Refresh ${id}`);
  await page.getByRole("textbox", { name: "Poem" }).fill("a line");
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page);

  // The list view: "Novels" above "Poems" under the author's heading.
  const listFor = async (query: string) => {
    await page.goto(`/${query}`);
    await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
    await page.getByRole("button", { name: "List view" }).click();
    return page.getByRole("region", { name: new RegExp(`^${pen}`) });
  };
  let entry = await listFor("");
  await expect(entry.getByRole("heading", { level: 2 })).toContainText("1 novel · 3 poems");
  const novels = entry.getByRole("list", { name: "Novels" });
  const link = novels.getByRole("link");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", `/a/${author}/n/odo`);
  await expect(link).toContainText("Ɔdɔ ne Ɛkɔm");
  await expect(link).toContainText("Novel · 2 chapters · ongoing");
  await expect(link.locator('[lang="ak"]').first()).toHaveText("Ɔdɔ ne Ɛkɔm");
  await expect(entry.getByRole("heading", { level: 3 })).toHaveText(["Novels", "Poems"]);
  await expect(entry).not.toContainText(/Unready|SECRET|Hidden/);
  await noSidewaysScroll(page, "list view at 375");
  // The language filter narrows novels like poems.
  entry = await listFor("?lang=en");
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("list", { name: "Novels" })).toHaveCount(0);
  await expect(entry).toContainText(`English poem ${id}`);
  entry = await listFor("?lang=ak");
  await expect(entry.getByRole("list", { name: "Novels" }).getByRole("link")).toHaveCount(1);
  await expect(entry).not.toContainText(`English poem ${id}`);
  await link.click();
  await expect(page).toHaveURL(`/a/${author}/n/odo`);

  // The novel page: canonical, description (its blurb), Open Graph, link card, JSON-LD (a Book).
  const novelUrl = `/a/${author}/n/odo`;
  const head = async () => ({
    canonical: new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!).pathname,
    description: await page.locator('meta[name="description"]').getAttribute("content"),
    ogUrl: new URL((await page.locator('meta[property="og:url"]').getAttribute("content"))!).pathname,
    ogSite: await page.locator('meta[property="og:site_name"]').getAttribute("content"),
    twitter: await page.locator('meta[name="twitter:card"]').getAttribute("content"),
    ld: (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t)),
  });
  const card = async () => {
    const og = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    const res = await request.get(new URL(og!).pathname + new URL(og!).search);
    expect(res.status(), og!).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    return { path: new URL(og!).pathname, size: pngSize(Buffer.from(await res.body())) };
  };
  let h = await head();
  expect(h).toMatchObject({
    canonical: novelUrl,
    description: "Akua waits at the landing for a brother who never came back.",
    ogUrl: novelUrl,
    ogSite: "InkBoard",
    twitter: "summary_large_image",
  });
  expect(await page.locator('meta[property="og:type"]').getAttribute("content")).toBe("book");
  const book = h.ld.find((x) => x["@type"] === "Book");
  expect(book).toMatchObject({ name: "Ɔdɔ ne Ɛkɔm", inLanguage: "ak", author: { name: pen } });
  expect(book.hasPart.map((c: { position: number; name: string }) => [c.position, c.name])).toEqual([[1, "Thursday"], [2, "Chapter 2"]]);
  expect(JSON.stringify(h.ld)).not.toMatch(/SECRET|Hidden|Unready/);
  expect(await card()).toEqual({ path: `${novelUrl}/opengraph-image`, size: { width: 1200, height: 630 } });

  // The chapter page: description from its first lines (plain text), JSON-LD (a Chapter of the Book).
  await page.goto(`${novelUrl}/thursday`);
  h = await head();
  expect(h).toMatchObject({
    canonical: `${novelUrl}/thursday`,
    description: "Akua waited at the landing. The ferry came late.",
    ogUrl: `${novelUrl}/thursday`,
    ogSite: "InkBoard",
    twitter: "summary_large_image",
  });
  const chapter = h.ld.find((x) => x["@type"] === "Chapter");
  expect(chapter).toMatchObject({
    name: "Thursday",
    position: 1,
    inLanguage: "ak",
    isPartOf: { "@type": "Book", name: "Ɔdɔ ne Ɛkɔm", inLanguage: "ak" },
  });
  expect(await card()).toEqual({ path: `${novelUrl}/thursday/opengraph-image`, size: { width: 1200, height: 630 } });
  // The untitled chapter's card answers too.
  expect((await request.get(`${novelUrl}/chapter/opengraph-image`)).headers()["content-type"]).toBe("image/png");

  // The sitemap: the novel and its published chapters, nothing else of it.
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of [novelUrl, `${novelUrl}/thursday`, `${novelUrl}/chapter`]) expect(sitemap, path).toContain(`${path}</loc>`);
  for (const path of [`${novelUrl}/secret`, `/a/${author}/n/unready`]) expect(sitemap, path).not.toContain(path);
});
