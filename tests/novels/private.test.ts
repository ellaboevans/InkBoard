import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, novels } from "@/db/schema";
import { PRIVATE_CHAPTER_TEXT } from "@/lib/atom-feed";
import { chapterDescription, chapterJsonLd, novelJsonLd } from "@/lib/novel-seo";
import { sitemapEntries } from "@/lib/sitemap-entries";
import { isCheckViolation } from "@/lib/slug";
import {
  loadAuthorPage,
  loadBoardSections,
  loadNovelPage,
  loadReaderChapter,
  loadSitemapChapters,
  readerPathExists,
} from "@/server/board";
import { loadAuthorFeed, loadNovelFeed, loadSiteFeed } from "@/server/feeds";
import {
  createChapter,
  createNovel,
  deleteChapter,
  getNovel,
  listNovels,
  publishChapter,
  saveChapter,
  unpublishChapter,
  updateNovel,
  type NovelInput,
} from "@/server/novels";
import { getPasswordSettings, setSharedPassword, switchToPerPoemPasswords } from "@/server/password-settings";
import { createPoem } from "@/server/poems";
import { searchBoard } from "@/server/search";
import { attemptNovelUnlock, attemptUnlock, readUnlockedBody, readUnlockedChapterBody, type Grant } from "@/server/unlock";

/*
 * Private novels (docs/PLAN.md, Phase 25), with real SQL: one password for
 * the whole book following the author's password mode, the DB invariant
 * (triggers), the mode switch, unlock grants n:<novelId>:<version> and every
 * version bump, the rate-limit keys, and N1: no chapter text of a private
 * novel in any reader JSON, unlocked or not.
 */

const db = getDb();
const SECRET = "SECRET-CHAPTER-TEXT";
const SECRET_TWO = "SECOND-SECRET-TEXT";
let ama: string;
let novelId: string;
let one: string;
let two: string;

const details = (over: Partial<NovelInput> = {}): NovelInput => ({ title: "The Locked Room", blurb: "A public blurb.", ...over });

beforeEach(async () => {
  const [e] = await db.insert(editors).values({ email: "ama@example.com", penName: "Ama", slug: "ama" }).returning();
  ama = e.id;
  const n = await createNovel(ama, details());
  if (!n.ok) throw new Error(JSON.stringify(n));
  novelId = n.novel.id;
  const c1 = await createChapter(ama, novelId, { title: "Thursday", body: `${SECRET} *one*`, status: "published" });
  const c2 = await createChapter(ama, novelId, { title: "The Landing", body: SECRET_TWO, status: "published" });
  if (!c1.ok || !c2.ok) throw new Error("chapters");
  one = c1.chapter.id;
  two = c2.chapter.id;
});

async function makePrivate(password = "novel-pass") {
  const res = await updateNovel(ama, novelId, details({ visibility: "private", password }));
  if (!res.ok) throw new Error(JSON.stringify(res));
}

const version = async () =>
  (await db.select({ v: novels.passwordVersion }).from(novels).where(eq(novels.id, novelId)))[0].v;
const hashOf = async () =>
  (await db.select({ h: novels.passwordHash }).from(novels).where(eq(novels.id, novelId)))[0].h;

async function unlock(password: string, grants: Grant[] = [], ip = "10.0.0.1") {
  return attemptNovelUnlock({ authorSlug: "ama", novelSlug: "the-locked-room", password, ip, grants });
}
async function unlockOk(password: string, grants: Grant[] = []) {
  const res = await unlock(password, grants);
  if (!res.ok) throw new Error(`unlock failed: ${res.error}`);
  return res.grants;
}
const read = (chapterSlug: string, grants: Grant[]) => readUnlockedChapterBody("ama", "the-locked-room", chapterSlug, grants);

describe("the writer's side", () => {
  it("a private novel needs a password in per_poem mode; the hash never leaves novels.ts", async () => {
    expect(await updateNovel(ama, novelId, details({ visibility: "private" }))).toEqual({
      ok: false,
      errors: { password: "Private novels need a password readers can use" },
    });
    expect(await updateNovel(ama, novelId, details({ visibility: "private", password: "short" }))).toMatchObject({
      ok: false,
      errors: { password: expect.stringMatching(/at least/) },
    });
    await makePrivate();
    expect(await hashOf()).toMatch(/^scrypt\$/);
    const n = (await getNovel(ama, novelId))!;
    expect(n).toMatchObject({ visibility: "private", hasPassword: true });
    expect(JSON.stringify(n)).not.toMatch(/scrypt|novel-pass|passwordHash|passwordVersion/);
    expect((await listNovels(ama))[0].visibility).toBe("private");
    // Blank keeps the current password (and the version).
    const v = await version();
    expect(await updateNovel(ama, novelId, details({ visibility: "private", title: "The Locked Room", blurb: "New blurb" }))).toMatchObject({ ok: true });
    expect(await version()).toBe(v);
    expect(await hashOf()).toMatch(/^scrypt\$/);
  });

  it("a new novel can be created private, and is public by default", async () => {
    const pub = await createNovel(ama, { title: "Open Book" });
    const priv = await createNovel(ama, { title: "Closed Book", visibility: "private", password: "closed-pass" });
    expect(await createNovel(ama, { title: "No Password", visibility: "private" })).toMatchObject({ ok: false, errors: { password: expect.any(String) } });
    if (!pub.ok || !priv.ok) throw new Error();
    expect((await getNovel(ama, pub.novel.id))!).toMatchObject({ visibility: "public", hasPassword: false });
    expect((await getNovel(ama, priv.novel.id))!).toMatchObject({ visibility: "private", hasPassword: true });
  });

  it("in shared mode the novel uses the author's one password and ignores a typed one", async () => {
    await setSharedPassword(ama, "shared-pass");
    expect(await updateNovel(ama, novelId, details({ visibility: "private", password: "ignored-pass" }))).toMatchObject({ ok: true });
    expect(await hashOf()).toBeNull();
    expect((await getNovel(ama, novelId))!).toMatchObject({ visibility: "private", hasPassword: false });
    expect(await unlock("ignored-pass")).toEqual({ ok: false, error: "wrong_password" });
    expect(await read("thursday", await unlockOk("shared-pass"))).toBe(`${SECRET} *one*`);
  });
});

describe("the database invariant: a private novel is always readable with some password", () => {
  it("refuses a private novel without a password while its author is in per_poem mode", async () => {
    const err = await db
      .update(novels)
      .set({ visibility: "private", passwordHash: null })
      .where(eq(novels.id, novelId))
      .then(() => null, (e: unknown) => e);
    expect(isCheckViolation(err)).toBe(true);
    const insert = await db
      .insert(novels)
      .values({ editorId: ama, title: "Raw", slug: "raw", visibility: "private" })
      .then(() => null, (e: unknown) => e);
    expect(isCheckViolation(insert)).toBe(true);
  });

  it("allows it in shared mode, and refuses switching back to per_poem behind the app's back", async () => {
    await setSharedPassword(ama, "shared-pass");
    await db.update(novels).set({ visibility: "private", passwordHash: null }).where(eq(novels.id, novelId));
    const err = await db
      .update(editors)
      .set({ passwordMode: "per_poem", sharedPasswordHash: null })
      .where(eq(editors.id, ama))
      .then(() => null, (e: unknown) => e);
    expect(isCheckViolation(err)).toBe(true);
    // The app's switch gives every private novel the shared password first.
    expect(await switchToPerPoemPasswords(ama)).toEqual({ ok: true });
    expect(await hashOf()).toMatch(/^scrypt\$/);
  });
});

describe("switching the author's password mode handles novels like poems", () => {
  it("per_poem -> shared: the novel's own password is removed (version bumped); shared -> per_poem: it starts with the shared one", async () => {
    await makePrivate("novel-pass");
    const perNovel = await unlockOk("novel-pass");
    expect(perNovel[0].s).toBe(`n:${novelId}:${await version()}`);
    const v = await version();

    await setSharedPassword(ama, "shared-pass");
    expect(await hashOf()).toBeNull();
    expect(await version()).toBe(v + 1);
    expect(await read("thursday", perNovel)).toBeNull();
    expect(await unlock("novel-pass")).toEqual({ ok: false, error: "wrong_password" });
    const sharedGrant = await unlockOk("shared-pass");
    expect(sharedGrant[0].s).toMatch(new RegExp(`^a:${ama}:\\d+$`));
    expect(await read("thursday", sharedGrant)).toBe(`${SECRET} *one*`);
    expect(await getPasswordSettings(ama)).toMatchObject({ mode: "shared", privateNovelCount: 1 });

    await switchToPerPoemPasswords(ama);
    expect(await version()).toBe(v + 2);
    expect(await read("thursday", sharedGrant)).toBeNull();
    expect(await read("thursday", await unlockOk("shared-pass"))).toBe(`${SECRET} *one*`);
  });

  it("one shared unlock opens the author's private poems and novels alike", async () => {
    await setSharedPassword(ama, "shared-pass");
    await makePrivate();
    const poem = await createPoem(ama, { title: "Hidden", body: "POEM-SECRET", visibility: "private", status: "published" });
    if (!poem.ok) throw new Error();
    const res = await attemptUnlock({ authorSlug: "ama", poemSlug: "hidden", password: "shared-pass", ip: "10.0.0.1", grants: [] });
    if (!res.ok) throw new Error();
    expect(await read("the-landing", res.grants)).toBe(SECRET_TWO);
    expect(await readUnlockedBody("ama", "hidden", await unlockOk("shared-pass"))).toBe("POEM-SECRET");
  });
});

describe("unlocking a private novel", () => {
  it("a wrong password fails; the right one opens every chapter with one grant", async () => {
    await makePrivate("novel-pass");
    expect(await unlock("wrong-pass")).toEqual({ ok: false, error: "wrong_password" });
    const grants = await unlockOk("novel-pass");
    expect(grants).toHaveLength(1);
    expect(grants[0].s).toBe(`n:${novelId}:${await version()}`);
    expect(await read("thursday", grants)).toBe(`${SECRET} *one*`);
    expect(await read("the-landing", grants)).toBe(SECRET_TWO);
    // A draft, an unknown chapter, an expired grant or another novel's grant: nothing.
    await createChapter(ama, novelId, { title: "Draft", body: "DRAFT-SECRET" });
    expect(await read("draft", grants)).toBeNull();
    expect(await read("nope", grants)).toBeNull();
    expect(await read("thursday", [{ s: grants[0].s, e: Date.now() - 1 }])).toBeNull();
    expect(await read("thursday", [{ s: `n:00000000-0000-0000-0000-000000000000:0`, e: Date.now() + 1e6 }])).toBeNull();
    expect(await read("thursday", [])).toBeNull();
  });

  it("is not_found for a public novel, a novel with nothing published, and unknown slugs", async () => {
    expect(await unlock("anything")).toEqual({ ok: false, error: "not_found" });
    expect(await read("thursday", [{ s: `n:${novelId}:0`, e: Date.now() + 1e6 }])).toBeNull(); // public: the loader has it
    await makePrivate();
    await unpublishChapter(ama, one);
    await unpublishChapter(ama, two);
    expect(await unlock("novel-pass")).toEqual({ ok: false, error: "not_found" });
    expect(await attemptNovelUnlock({ authorSlug: "nobody", novelSlug: "the-locked-room", password: "novel-pass", ip: null, grants: [] })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("uses rate-limit keys shaped like the poems': unlock:n:<id>:ip:<bucket>, unlock:ip:<bucket>, unlock:n:<id>:all", async () => {
    await makePrivate();
    await unlock("wrong-pass", [], "2001:db8:1:2::7");
    const { rows } = (await db.execute(sql`SELECT key FROM rate_limits ORDER BY key`)) as unknown as { rows: { key: string }[] };
    expect(rows.map((r) => r.key)).toEqual(
      [`unlock:n:${novelId}:ip:2001:db8:1:2::/64`, "unlock:ip:2001:db8:1:2::/64", `unlock:n:${novelId}:all`].sort(),
    );
    // Ten wrong guesses from one /64 block the eleventh, even with the right password.
    for (let i = 0; i < 9; i++) await unlock("wrong-pass", [], `2001:db8:1:2::${i + 10}`);
    expect(await unlock("novel-pass", [], "2001:db8:1:2::99")).toMatchObject({ ok: false, error: "rate_limited" });
    // All clients together.
    await db.execute(sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${`unlock:n:${novelId}:all`}, now(), 300)
      ON CONFLICT (key) DO UPDATE SET count = 300`);
    expect(await unlock("novel-pass", [], "198.51.100.1")).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("in shared mode, guesses count on the author's bucket, with the poems'", async () => {
    await setSharedPassword(ama, "shared-pass");
    await makePrivate();
    await unlock("wrong-pass", [], "10.0.0.9");
    const { rows } = (await db.execute(sql`SELECT key FROM rate_limits ORDER BY key`)) as unknown as { rows: { key: string }[] };
    expect(rows.map((r) => r.key)).toEqual([`unlock:a:${ama}:all`, `unlock:a:${ama}:ip:10.0.0.9`, "unlock:ip:10.0.0.9"].sort());
  });
});

describe("every version bump locks readers out again", () => {
  async function bumped(change: () => Promise<unknown>, password = "novel-pass") {
    const grants = await unlockOk(password);
    expect(await read("thursday", grants)).not.toBeNull();
    const before = await version();
    await change();
    expect(await version()).toBe(before + 1);
    expect(await read("thursday", grants)).toBeNull();
  }

  it("changing the password", async () => {
    await makePrivate("novel-pass");
    await bumped(() => updateNovel(ama, novelId, details({ visibility: "private", password: "new-novel-pass" })));
    expect(await unlock("novel-pass")).toEqual({ ok: false, error: "wrong_password" });
    expect(await read("thursday", await unlockOk("new-novel-pass"))).toBe(`${SECRET} *one*`);
  });

  it("making it public (which removes the password)", async () => {
    await makePrivate("novel-pass");
    const grants = await unlockOk("novel-pass");
    const before = await version();
    await updateNovel(ama, novelId, details({ visibility: "public" }));
    expect(await version()).toBe(before + 1);
    expect(await hashOf()).toBeNull();
    // Private again with the same password: the old grant still doesn't open it.
    await makePrivate("novel-pass");
    expect(await read("thursday", grants)).toBeNull();
  });

  it("unpublishing every chapter (by saving as draft, or Unpublish), not just one of them", async () => {
    await makePrivate("novel-pass");
    const grants = await unlockOk("novel-pass");
    const v = await version();
    await unpublishChapter(ama, two);
    expect(await version()).toBe(v); // chapter 1 is still published
    expect(await read("thursday", grants)).toBe(`${SECRET} *one*`);
    await saveChapter(ama, one, { title: "Thursday", body: SECRET, status: "draft" });
    expect(await version()).toBe(v + 1);
    await publishChapter(ama, one);
    expect(await read("thursday", grants)).toBeNull();
    // And through Unpublish on the last one.
    await bumped(() => unpublishChapter(ama, one));
  });

  it("deleting the last published chapter", async () => {
    await makePrivate("novel-pass");
    await deleteChapter(ama, two);
    await bumped(() => deleteChapter(ama, one));
  });

  it("ordinary edits keep unlocks", async () => {
    await makePrivate("novel-pass");
    const grants = await unlockOk("novel-pass");
    await saveChapter(ama, one, { title: "Thursday", body: "typo fixed" });
    await updateNovel(ama, novelId, details({ visibility: "private", blurb: "A new blurb" }));
    expect(await read("thursday", grants)).toBe("typo fixed");
  });
});

describe("N1: no chapter text of a private novel in any reader JSON", () => {
  const noText = (value: unknown) => {
    const json = JSON.stringify(value);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(SECRET_TWO);
  };

  it("board, author page, novel page, chapter loader, link-card and sitemap loaders, JSON-LD and meta descriptions; titles and blurb stay", async () => {
    await makePrivate();
    const sections = await loadBoardSections();
    noText(sections);
    expect(sections[0].novels[0]).toMatchObject({ title: "The Locked Room", visibility: "private", blurb: "A public blurb.", chapterCount: 2 });

    const author = await loadAuthorPage("ama");
    noText(author);
    expect(author!.novels[0].visibility).toBe("private");

    const page = (await loadNovelPage("ama", "the-locked-room"))!;
    noText(page);
    expect(page).toMatchObject({ visibility: "private", sharedPassword: false, fullBlurb: "A public blurb." });
    expect(page.chapters.map((c) => [c.number, c.displayTitle])).toEqual([
      [1, "Thursday"],
      [2, "The Landing"],
    ]);
    noText(novelJsonLd(page));

    // The chapter page's and its link card's loader: no body, whatever cookie the reader has.
    for (const slug of ["thursday", "the-landing"]) {
      const c = (await loadReaderChapter("ama", "the-locked-room", slug))!;
      expect(c.body).toBeNull();
      expect(c.novel).toMatchObject({ visibility: "private", sharedPassword: false });
      noText(c);
      noText(chapterJsonLd(c));
      expect(chapterDescription(c)).toBe(`Chapter ${c.number} of The Locked Room, a novel by Ama.`);
    }

    const sitemap = await loadSitemapChapters();
    noText(sitemap);
    expect(sitemap.map((s) => [s.chapterSlug, s.visibility])).toEqual([
      ["thursday", "private"],
      ["the-landing", "private"],
    ]);
    expect(sitemapEntries(sections, sitemap).filter((e) => e.url.includes("/n/")).map((e) => e.priority)).toEqual([0.8, 0.4, 0.4]);

    // The page exists (200 with its unlock form), like a private poem's.
    expect(await readerPathExists({ kind: "chapter", author: "ama", novel: "the-locked-room", chapter: "thursday" })).toBe(true);
    expect(await readerPathExists({ kind: "novel", author: "ama", novel: "the-locked-room" })).toBe(true);
  });

  it("stays out of the cached loaders after a reader unlocks it", async () => {
    await makePrivate();
    const grants = await unlockOk("novel-pass");
    expect(await read("thursday", grants)).toBe(`${SECRET} *one*`);
    noText(await loadReaderChapter("ama", "the-locked-room", "thursday"));
    noText(await loadNovelPage("ama", "the-locked-room"));
    noText(await loadBoardSections());
  });

  it("feeds: title-only entries with the fixed English line, in the site, author and novel feeds", async () => {
    await makePrivate();
    for (const xml of [await loadSiteFeed(), (await loadAuthorFeed("ama"))!, (await loadNovelFeed("ama", "the-locked-room"))!]) {
      noText(xml);
      expect(xml).toContain(`<content type="text" xml:lang="en">${PRIVATE_CHAPTER_TEXT}</content>`);
      expect(xml).not.toContain('<content type="html"');
    }
    const novelFeed = (await loadNovelFeed("ama", "the-locked-room"))!;
    expect(novelFeed).toContain("The Locked Room: Chapter 1 · Thursday");
    expect(novelFeed).toContain("The Locked Room: Chapter 2 · The Landing");
    // Public again: the text is back.
    await updateNovel(ama, novelId, details({ visibility: "public" }));
    expect((await loadNovelFeed("ama", "the-locked-room"))!).toContain(SECRET_TWO);
  });

  it("search: the novel's title only, never its text", async () => {
    await makePrivate();
    const byTitle = await searchBoard("locked");
    expect(byTitle.novels.map((n) => n.title)).toEqual(["The Locked Room"]);
    noText(byTitle);
    const byText = await searchBoard("SECRET-CHAPTER");
    expect([...byText.novels, ...byText.poems]).toEqual([]);
  });
});
