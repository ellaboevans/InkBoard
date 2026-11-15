import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  deletionNoticesFor,
  expectBackOnList,
  latestStepUpCode,
  signUpAs,
  sql,
  welcomesFor,
} from "./helpers";

/*
 * Your poems as files, and leaving (docs/PLAN.md, Phase 17): downloads from
 * Settings, and deleting the account through step-up and the pen name.
 */

test.beforeEach(() => sql("DELETE FROM rate_limits"));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const GHANAIAN = "Ɛ ɛ Ɔ ɔ Ŋ ŋ Ɖ ɖ Ƒ ƒ Ɣ ɣ Ʋ ʋ Ʒ ʒ ɛ́ ɔ̀";

async function writePoem(page: Page, title: string, body: string, opts: { password?: string; draft?: boolean } = {}) {
  await page.goto("/admin/poems/new");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Poem" }).fill(body);
  if (opts.password) {
    await page.getByRole("switch", { name: "Password protected" }).click();
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(opts.password);
  }
  if (opts.draft) {
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/admin\/poems\/[0-9a-f-]{36}/, { timeout: 45_000 });
  } else {
    await page.getByRole("button", { name: "Publish to board" }).click();
    await expectBackOnList(page);
  }
}

async function download(page: Page, name: RegExp) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name }).click();
  const file = await downloading;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, "utf8") };
}

test("download your poems as Markdown and JSON, drafts and private poems included", async ({ page, browser }) => {
  const id = unique();
  const pen = `Archivist ${id}`;
  await signUpAs(page, `export-${id}@example.com`, pen);
  await writePoem(page, `Ŋkɔ ${id}`, `ɖeka\n  ${GHANAIAN}\n\nlast line`);
  await writePoem(page, `Locked ${id}`, "only for friends", { password: "poem-pass-123" });
  await writePoem(page, `Unfinished ${id}`, "half a line", { draft: true });

  await page.goto("/admin/settings");
  const section = page.getByRole("region", { name: "Download your poems" });
  await expect(section).toContainText("3 poems (1 draft)");

  const md = await download(page, /^Download Markdown/);
  expect(md.name).toMatch(new RegExp(`^inkboard-archivist-${id}-\\d{4}-\\d\\d-\\d\\d\\.md$`));
  expect(md.text.startsWith(`# ${pen}\n`)).toBe(true);
  for (const s of [`### Ŋkɔ ${id}`, `### Locked ${id}`, `### Unfinished ${id}`, "only for friends", "half a line", "- Status: Draft"]) {
    expect(md.text).toContain(s);
  }
  expect(md.text).toContain(`ɖeka\n  ${GHANAIAN}\n\nlast line`);
  expect(md.text).toContain("- Visibility: Private");
  expect(md.text).not.toContain("poem-pass-123");
  expect(md.text).not.toContain("scrypt$");
  expect(md.text).not.toContain(`export-${id}@example.com`);

  const json = await download(page, /^Download JSON/);
  expect(json.name).toMatch(/\.json$/);
  const data = JSON.parse(json.text);
  expect(data).toMatchObject({ format: "inkboard-export", version: 1, profile: { penName: pen } });
  expect(data.poems.map((p: { title: string }) => p.title)).toEqual([`Ŋkɔ ${id}`, `Locked ${id}`, `Unfinished ${id}`]);
  expect(data.poems[1]).toMatchObject({ visibility: "private", text: "only for friends" });
  expect(data.poems[2]).toMatchObject({ status: "draft", text: "half a line" });
  expect(data.poems[0].text).toBe(`ɖeka\n  ${GHANAIAN}\n\nlast line`);
  expect(json.text).not.toMatch(/scrypt\$|password_?hash|passwordVersion|poem-pass-123/i);

  // Headers: a download, with a charset, never cached.
  const res = await page.request.get("/admin/export/json");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/json; charset=utf-8");
  expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="inkboard-archivist-.+\.json"$/);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect((await page.request.get("/admin/export/markdown")).headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect((await page.request.get("/admin/export/pdf")).status()).toBe(404);

  // Signed out: no file, just the way to sign in.
  const stranger = await browser.newContext();
  const out = await stranger.request.get("/admin/export/json", { maxRedirects: 0 });
  expect(out.status()).toBe(307);
  expect(out.headers().location).toMatch(/\/sign-in$/);
  await stranger.close();
});

test("delete an account: step-up, pen name, then gone everywhere; the same email starts afresh", async ({ page }) => {
  const id = unique();
  const pen = `Leaver ${id}`;
  const email = `leave-${id}@example.com`;
  await signUpAs(page, email, pen);
  await writePoem(page, `Farewell ${id}`, "the last poem");
  const { rows } = await sql(
    `SELECT e.slug, p.slug AS poem FROM poems p JOIN editors e ON e.id = p.editor_id WHERE e.email = '${email}'`,
  );
  const { slug, poem } = rows[0] as { slug: string; poem: string };

  // The sign-in is old now: deleting needs an emailed code first.
  await sql(`UPDATE sessions SET email_verified_at = now() - interval '11 minutes'
    WHERE editor_id = (SELECT id FROM editors WHERE email = '${email}')`);
  await page.goto("/admin/settings");
  const danger = page.getByRole("region", { name: "Delete account" });
  await expect(danger).toContainText("your poem, drafts and private ones included");
  await expect(danger).toContainText("out of our reach");
  await expect(danger.getByRole("link", { name: "Download them first" })).toHaveAttribute("href", "#download");
  await danger.getByRole("button", { name: "Delete my account…" }).click();
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeFocused();
  await expect(page.getByRole("main")).toContainText("Deleting your account needs a recent sign-in.");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByRole("textbox", { name: "Confirmation code" }).fill(await latestStepUpCode(email));

  const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("textbox", { name: /Type your pen name/ });
  const confirm = dialog.getByRole("button", { name: "Delete my account" });
  await field.fill(pen.toLowerCase());
  await expect(confirm).toBeDisabled();
  await field.fill(pen);
  await confirm.click();

  // A full page load to the board, with the flash.
  await expect(page).toHaveURL(/\/$/, { timeout: 45_000 });
  await expect(page.locator("[data-sileo-toast]").getByText("Your account was deleted")).toBeVisible();
  expect((await page.context().cookies()).find((c) => c.name === "poemhub_session" && c.value)).toBeUndefined();
  await expect.poll(() => deletionNoticesFor(email)).toEqual([{ device: "Chrome on macOS" }]);

  // Gone for readers at once.
  await expect(page.locator('[aria-label="Poem board"][data-ready="true"]')).toBeAttached();
  await expect(page.getByRole("region", { name: new RegExp(`^${pen}`) })).toHaveCount(0);
  const search = await page.request.get(`/api/search?q=${encodeURIComponent(pen)}`);
  expect(await search.json()).toEqual({ authors: [], poems: [] });
  const poemSearch = await page.request.get(`/api/search?q=${encodeURIComponent(`Farewell ${id}`)}`);
  expect((await poemSearch.json()).poems).toEqual([]);
  await page.goto(`/a/${slug}`);
  await expect(page.getByRole("heading", { name: "Author not found" })).toBeVisible();
  await page.goto(`/p/${slug}/${poem}`);
  await expect(page.getByRole("heading", { name: "Poem not found" })).toBeVisible();
  expect((await page.request.get(`/a/${slug}/feed.xml`)).status()).toBe(404);
  expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(`/a/${slug}`);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);

  // Signing up again with the same email: a fresh account, a new slug, a welcome again.
  await signUpAs(page, email, pen);
  await expect(page.getByRole("main").getByText("No poems yet")).toBeVisible();
  const again = await sql(`SELECT slug FROM editors WHERE email = '${email}'`);
  expect(again.rows[0].slug).toBe(`${slug}-2`);
  await expect.poll(() => welcomesFor(email)).toHaveLength(2);
  // The old address still shows nobody's poems.
  await page.goto(`/a/${slug}`);
  await expect(page.getByRole("heading", { name: "Author not found" })).toBeVisible();
});
