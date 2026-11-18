import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signUpAs, sql, expectBackOnList, chooseOption } from "./helpers";

// Atom feeds (docs/PLAN.md, Phase 12): one for the board, one per author,
// found by autodiscovery and linked from the author page.
test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publish(page: Page, title: string, body: string, opts: { language?: string; password?: string } = {}) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (opts.language) await chooseOption(page.getByRole("combobox", { name: "Language" }), opts.language);
  if (opts.password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(opts.password);
  }
  await page.getByRole("button", { name: "Publish to board" }).click();
  await expectBackOnList(page, 45_000);
}

async function fetchFeed(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.status(), path).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/atom+xml; charset=utf-8");
  return res.text();
}

/** Parses the feed with the browser's XML parser: well-formed, and what a reader would see. */
async function parseFeed(page: Page, xml: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    const error = doc.querySelector("parsererror")?.textContent ?? null;
    const entries = [...doc.getElementsByTagName("entry")].map((e) => {
      const content = e.getElementsByTagName("content")[0];
      return {
        title: e.getElementsByTagName("title")[0]?.textContent,
        lang: e.getElementsByTagName("title")[0]?.getAttribute("xml:lang") ?? null,
        author: e.querySelector("author > name")?.textContent,
        link: e.querySelector('link[rel="alternate"]')?.getAttribute("href"),
        contentType: content?.getAttribute("type"),
        content: content?.textContent ?? "",
      };
    });
    return { error, title: doc.getElementsByTagName("title")[0]?.textContent, entries };
  }, xml);
}

const feedLinks = (page: Page) =>
  page.locator('head link[rel="alternate"][type="application/atom+xml"]').evaluateAll((links) =>
    links.map((l) => ({ href: l.getAttribute("href"), title: l.getAttribute("title") })),
  );

test("site and author feeds: content, privacy, and freshness after edits", async ({ page, request }) => {
  const id = unique();
  const pen = `Feed Poet ${id}`;
  const email = `feed-${id}@example.com`;
  await signUpAs(page, email, pen);
  await publish(page, `Rain ${id}`, `first *soft* line ${id}\n    indented **loud**\n<b>not bold</b> & more`);
  await publish(page, `Locked ${id}`, `secret feed text ${id}`, { password: "feed-pass" });
  await publish(page, `Ŋutifafa ${id}`, "Ŋutifafa na wò", { language: "Ewe" });
  const { rows } = await sql(`SELECT slug FROM editors WHERE email = '${email}'`);
  const slug = rows[0].slug as string;

  const site = await fetchFeed(request, "/feed.xml");
  expect(site).not.toContain(`secret feed text ${id}`);
  expect(site).not.toContain(email);
  const parsed = await parseFeed(page, site);
  expect(parsed.error).toBeNull();
  expect(parsed.title).toBe("InkBoard");
  const mine = parsed.entries.filter((e) => e.author === pen);
  // Newest first.
  expect(mine.map((e) => e.title)).toEqual([`Ŋutifafa ${id}`, `Locked ${id}`, `Rain ${id}`]);

  const rain = mine.find((e) => e.title === `Rain ${id}`)!;
  expect(rain.link).toMatch(new RegExp(`^https?://[^/]+/p/${slug}/`));
  expect(rain.contentType).toBe("html");
  // The reader gets HTML: Markdown rendered, line breaks and indentation kept, markup typed by the poet escaped.
  expect(rain.content).toContain(`first <em>soft</em> line ${id}<br>`);
  expect(rain.content).toContain("&#160;&#160;&#160;&#160;indented <strong>loud</strong>");
  expect(rain.content).toContain("&lt;b&gt;not bold&lt;/b&gt; &amp; more");

  const locked = mine.find((e) => e.title === `Locked ${id}`)!;
  expect(locked.contentType).toBe("text");
  expect(locked.content).toContain("password protected");
  expect(mine.find((e) => e.title === `Ŋutifafa ${id}`)!.lang).toBe("ee");

  // The author feed: only this author.
  const authorXml = await fetchFeed(request, `/a/${slug}/feed.xml`);
  const author = await parseFeed(page, authorXml);
  expect(author.error).toBeNull();
  expect(author.title).toBe(`${pen} on InkBoard`);
  expect(author.entries.map((e) => e.author)).toEqual([pen, pen, pen]);
  expect((await request.get("/a/nobody-here-at-all/feed.xml")).status()).toBe(404);

  // Edits show up straight away (BOARD_TAG): unpublish, retitle, rename.
  await page.goto("/admin");
  await page.getByRole("link", { name: `Locked ${id}` }).first().click();
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByRole("button", { name: "Publish to board" })).toBeVisible();
  await expect.poll(async () => (await fetchFeed(request, "/feed.xml")).includes(`Locked ${id}`)).toBe(false);

  await page.goto("/admin");
  await page.getByRole("link", { name: `Rain ${id}` }).first().click();
  await page.getByRole("textbox", { name: "Title" }).fill(`Storm ${id}`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => (await fetchFeed(request, `/a/${slug}/feed.xml`)).includes(`Storm ${id}`)).toBe(true);

  const renamed = `Renamed Poet ${id}`;
  await page.goto("/admin/profile");
  await page.getByRole("textbox", { name: "Pen name" }).fill(renamed);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("[data-sileo-toast]").getByText("Profile saved")).toBeVisible();
  const afterRename = await parseFeed(page, await fetchFeed(request, "/feed.xml"));
  expect(afterRename.entries.filter((e) => e.author === renamed)).toHaveLength(2);
  expect(afterRename.entries.filter((e) => e.author === pen)).toHaveLength(0);
});

test("browsers and feed readers find the feeds; robots.txt allows them", async ({ page, request }) => {
  const id = unique();
  const pen = `Discover Poet ${id}`;
  const email = `discover-${id}@example.com`;
  await signUpAs(page, email, pen);
  await publish(page, `Found ${id}`, "a line");
  const { rows } = await sql(
    `SELECT e.slug, p.slug AS poem FROM poems p JOIN editors e ON e.id = p.editor_id WHERE e.email = '${email}'`,
  );
  const { slug, poem } = rows[0] as { slug: string; poem: string };
  const abs = (path: string) => new RegExp(`^https?://[^/]+${path.replace(/[.]/g, "\\.")}$`);

  await page.goto("/");
  let links = await feedLinks(page);
  expect(links).toHaveLength(1);
  expect(links[0].href).toMatch(abs("/feed.xml"));

  // Author page: their feed first, then the board's, plus a visible link.
  await page.goto(`/a/${slug}`);
  links = await feedLinks(page);
  expect(links.map((l) => l.href)).toEqual([expect.stringMatching(abs(`/a/${slug}/feed.xml`)), expect.stringMatching(abs("/feed.xml"))]);
  expect(links[0].title).toBe(`${pen} on InkBoard`);
  const follow = page.getByRole("main").getByRole("link", { name: `Follow ${pen} in a feed reader` });
  await expect(follow).toHaveAttribute("href", `/a/${slug}/feed.xml`);
  await follow.focus();
  await expect(follow).toBeFocused();
  const fromLink = await request.get((await follow.getAttribute("href"))!);
  expect(await fromLink.text()).toContain(`Found ${id}`);

  // Poem page (hard load): the author's feed and the board's.
  await page.goto(`/p/${slug}/${poem}`);
  links = await feedLinks(page);
  expect(links.map((l) => l.href)).toEqual([expect.stringMatching(abs(`/a/${slug}/feed.xml`)), expect.stringMatching(abs("/feed.xml"))]);

  // Nothing in robots.txt blocks a feed.
  const robots = await (await request.get("/robots.txt")).text();
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gim)].map((m) => m[1]);
  for (const path of ["/feed.xml", `/a/${slug}/feed.xml`]) {
    expect(disallowed.some((d) => path.startsWith(d)), `${path} vs ${disallowed.join(", ")}`).toBe(false);
  }
});

test("the board has a visible Subscribe, on phones and desktops, that explains, opens and copies the feed", async ({ page, context, request }) => {
  const id = unique();
  const pen = `Subscribe Poet ${id}`;
  const email = `subscribe-${id}@example.com`;
  await signUpAs(page, email, pen);
  await publish(page, `Follow me ${id}`, "a line");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");
    await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();

    for (const view of ["board", "list view"]) {
      if (view === "list view") await page.getByRole("button", { name: "List view", exact: true }).click();
      const where = `${view} at ${width}px`;
      // Icon-only on phones, but named.
      const subscribe = page.getByRole("button", { name: "Subscribe", exact: true });
      await expect(subscribe, where).toBeVisible();

      // Keyboard: Enter opens the popover and moves focus into it.
      await subscribe.focus();
      await page.keyboard.press("Enter");
      const popover = page.getByRole("dialog", { name: "Follow new poems" });
      await expect(popover, where).toBeVisible();
      await expect(popover).toContainText("feed reader");
      await expect(popover.locator(":focus")).toHaveCount(1);

      // The feed link: a plain <a> to the Atom feed, which serves it.
      const open = popover.getByRole("link", { name: "Open feed" });
      await expect(open).toHaveAttribute("href", "/feed.xml");
      await expect(open).toHaveAttribute("type", "application/atom+xml");
      const feed = await request.get((await open.getAttribute("href"))!);
      expect(feed.headers()["content-type"]).toBe("application/atom+xml; charset=utf-8");
      expect(await feed.text()).toContain(`Follow me ${id}`);

      // Copy puts the absolute feed URL (from siteUrl()) on the clipboard, shown in the popover too.
      const shown = (await popover.locator("[data-feed-url]").textContent())!;
      expect(shown).toMatch(/^https?:\/\/[^/]+\/feed\.xml$/);
      await popover.getByRole("button", { name: "Copy feed link" }).click();
      await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Feed link copied" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);

      // Escape closes it and returns focus to Subscribe.
      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0);
      await expect(subscribe).toBeFocused();
    }
  }

  // The reading page offers the author's feed after the poem.
  const { rows } = await sql(
    `SELECT e.slug, p.slug AS poem FROM poems p JOIN editors e ON e.id = p.editor_id WHERE e.email = '${email}'`,
  );
  await page.goto(`/p/${rows[0].slug}/${rows[0].poem}`);
  const follow = page.getByRole("main").getByRole("link", { name: `Follow ${pen} in a feed reader` });
  await expect(follow).toHaveAttribute("href", `/a/${rows[0].slug}/feed.xml`);
  await expect(follow).toHaveAttribute("type", "application/atom+xml");
});
