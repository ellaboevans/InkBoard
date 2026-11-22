import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { getDb } from "@/db";
import { chapters, collections, editors, novels, poems, shortLinks } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { BOARD_TAG, poemTag } from "@/server/cache-tags";
import {
  loadAuthorPage,
  loadBoardSections,
  loadCollectionPage,
  loadNovelPage,
  loadReaderChapter,
  loadReaderPoem,
  loadSerialsPage,
  loadShareChapter,
  loadSharePoem,
  loadSitemapChapters,
  readerPathExists,
} from "@/server/board";
import { contentHiddenEmail, contentRestoredEmail, reportEmail } from "@/server/email-templates";
import { loadEditorExport } from "@/server/export";
import { loadAuthorFeed, loadNovelFeed, loadSiteFeed } from "@/server/feeds";
import { isCurrentCover } from "@/server/novel-covers";
import { claimReleasedChapters, createChapter, getNovel, listNovels } from "@/server/novels";
import { hashPassword } from "@/server/passwords";
import { createPoem, getEditorPoem, listEditorPoems, updatePoem } from "@/server/poems";
import { isCurrentPhoto } from "@/server/profile-photos";
import { announceChapter, announcePoem } from "@/server/push";
import { resolveReportTarget } from "@/server/reports";
import { searchBoard } from "@/server/search";
import { resolveShortCode } from "@/server/short-links";
import { applyTakedown, findTakedownTarget, hiddenStateFor, parseTakedownLink, type TakedownLink } from "@/server/takedown";
import { handleTakedown } from "@/server/takedown-route";
import { attemptUnlock } from "@/server/unlock";
import { withRelease } from "../support/chapters";
import { takedownNotices } from "../support/outbox";

/*
 * The owner's takedown (docs/PLAN.md, Phase 32 round 2): a hidden poem, novel
 * or author is missing to readers everywhere, and comes back exactly as it was.
 */

vi.mock("web-push", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("web-push") }>()).default;
  return { default: { ...real, sendNotification: vi.fn() } };
});
vi.spyOn(console, "info").mockImplementation(() => {});

const db = getDb();
const saved = { ...process.env };
const SECRET = "owner-secret-owner-secret-owner-secret-1";
beforeAll(() => {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:owner@inkboard.app";
  process.env.CRON_SECRET = SECRET;
  resetEnvCache();
});
afterAll(() => {
  process.env = { ...saved };
  resetEnvCache();
});

const PHOTO = "PhotoKeyPhotoKeyPhoto1";
const COVER = "CoverKeyCoverKeyCover1";
let ama: string;
let kofi: string;
let duskId: string;
let novelId: string;
let chapterId: string;

beforeEach(async () => {
  const [a, k] = await db
    .insert(editors)
    .values([
      { email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama", photoKey: PHOTO },
      { email: "kofi@example.com", penName: "Kofi", slug: "kofi" },
    ])
    .returning();
  ama = a.id;
  kofi = k.id;
  const [col] = await db.insert(collections).values({ editorId: ama, title: "Cycle", slug: "cycle" }).returning();
  const now = new Date();
  const [dusk] = await db
    .insert(poems)
    .values([
      { editorId: ama, title: "Dusk", slug: "dusk", body: "Dusk lines.", status: "published", publishedAt: now, collectionId: col.id, collectionPosition: 1 },
      { editorId: ama, title: "Dawn", slug: "dawn", body: "Dawn lines.", status: "published", publishedAt: now, collectionId: col.id, collectionPosition: 2 },
      { editorId: ama, title: "Locked", slug: "locked", body: "Secret.", status: "published", publishedAt: now, visibility: "private", passwordHash: await hashPassword("pass-123456") },
      { editorId: kofi, title: "Other", slug: "other", body: "Kofi's.", status: "published", publishedAt: now },
    ])
    .returning();
  duskId = dusk.id;
  const [n] = await db.insert(novels).values({ editorId: ama, title: "The Ferry", slug: "ferry", coverKey: COVER }).returning();
  novelId = n.id;
  const [c] = await db
    .insert(chapters)
    .values(withRelease({ novelId, title: "Landing", slug: "landing", body: "It began.", position: 1, status: "published", publishedAt: now, wordCount: 2 }))
    .returning();
  chapterId = c.id;
  await db.insert(shortLinks).values([
    { poemId: duskId, code: "bcdfgh" },
    { chapterId, code: "bcdfgj" },
  ]);
});

const link = (raw: string) => parseTakedownLink(raw) as TakedownLink;
async function act(raw: string, action: "hide" | "restore") {
  const target = await findTakedownTarget(link(raw));
  if (!target) throw new Error(`nothing at ${raw}`);
  return applyTakedown(target, action);
}

/** Everything readers could see of Ama's poem Dusk. */
async function duskSeen() {
  const sections = await loadBoardSections();
  const author = await loadAuthorPage("ama");
  const dawn = await loadReaderPoem("ama", "dawn");
  const search = await searchBoard("Dusk");
  return {
    board: sections.find((s) => s.slug === "ama")?.poems.some((p) => p.slug === "dusk") ?? false,
    authorPage: author?.poems.some((p) => p.slug === "dusk") ?? false,
    page: (await loadReaderPoem("ama", "dusk")) !== null,
    exists: await readerPathExists({ kind: "poem", author: "ama", poem: "dusk" }),
    collectionPage: (await loadCollectionPage("ama", "cycle"))?.poems.map((p) => p.slug) ?? [],
    // Dawn's place in the collection: a hidden Dusk leaves the numbering like a draft.
    dawnPart: dawn?.collection ? `${dawn.collection.part}/${dawn.collection.parts}` : null,
    authorCollections: author?.collections.map((c) => c.poemCount) ?? [],
    siteFeed: (await loadSiteFeed()).includes("Dusk"),
    authorFeed: (await loadAuthorFeed("ama"))?.includes("Dusk") ?? false,
    search: search.poems.some((p) => p.slug === "dusk"),
    share: (await loadSharePoem("ama", "dusk")) !== null,
    shortLink: (await resolveShortCode("bcdfgh")) !== null,
    report: (await resolveReportTarget({ kind: "poem", author: "ama", poem: "dusk" })) !== null,
  };
}

const DUSK_SHOWN = {
  board: true,
  authorPage: true,
  page: true,
  exists: true,
  collectionPage: ["dusk", "dawn"],
  dawnPart: "2/2",
  authorCollections: [2],
  siteFeed: true,
  authorFeed: true,
  search: true,
  share: true,
  shortLink: true,
  report: true,
};

/** Everything readers could see of Ama's novel The Ferry. */
async function ferrySeen() {
  const sections = await loadBoardSections();
  const serials = await loadSerialsPage();
  return {
    board: sections.find((s) => s.slug === "ama")?.novels.some((n) => n.slug === "ferry") ?? false,
    authorPage: (await loadAuthorPage("ama"))?.novels.some((n) => n.slug === "ferry") ?? false,
    novelPage: (await loadNovelPage("ama", "ferry")) !== null,
    chapterPage: (await loadReaderChapter("ama", "ferry", "landing")) !== null,
    novelExists: await readerPathExists({ kind: "novel", author: "ama", novel: "ferry" }),
    chapterExists: await readerPathExists({ kind: "chapter", author: "ama", novel: "ferry", chapter: "landing" }),
    serials: [...serials.ongoing, ...serials.complete].some((n) => n.slug === "ferry"),
    sitemap: (await loadSitemapChapters()).some((c) => c.novelSlug === "ferry"),
    siteFeed: (await loadSiteFeed()).includes("The Ferry"),
    authorFeed: (await loadAuthorFeed("ama"))?.includes("The Ferry") ?? false,
    novelFeed: (await loadNovelFeed("ama", "ferry")) !== null,
    search: (await searchBoard("Ferry")).novels.length > 0,
    sharePassage: (await loadShareChapter("ama", "ferry", "landing")) !== null,
    shortLink: (await resolveShortCode("bcdfgj")) !== null,
    cover: await isCurrentCover(COVER),
  };
}
const FERRY_KEYS = ["board", "authorPage", "novelPage", "chapterPage", "novelExists", "chapterExists", "serials", "sitemap", "siteFeed", "authorFeed", "novelFeed", "search", "sharePassage", "shortLink", "cover"];
const FERRY_SHOWN = Object.fromEntries(FERRY_KEYS.map((k) => [k, true]));
const FERRY_HIDDEN = Object.fromEntries(Object.keys(FERRY_SHOWN).map((k) => [k, false]));

describe("a hidden poem is missing to readers everywhere, and comes back on restore", () => {
  it("board, author page, page, 404 check, collection, feeds, search, share image, short link, report", async () => {
    expect(await duskSeen()).toEqual(DUSK_SHOWN);
    expect(await act("/p/ama/dusk", "hide")).toMatchObject({ changed: true });
    expect(await duskSeen()).toEqual({
      board: false,
      authorPage: false,
      page: false,
      exists: false,
      collectionPage: ["dawn"],
      dawnPart: "1/1",
      authorCollections: [1],
      siteFeed: false,
      authorFeed: false,
      search: false,
      share: false,
      shortLink: false,
      report: false,
    });
    // Nothing else of the author's is touched.
    expect(await loadReaderPoem("ama", "dawn")).not.toBeNull();
    expect(await loadNovelPage("ama", "ferry")).not.toBeNull();
    expect(await act("/p/ama/dusk", "restore")).toMatchObject({ changed: true });
    expect(await duskSeen()).toEqual(DUSK_SHOWN);
  });

  it("a hidden private poem can't be unlocked either", async () => {
    const attempt = () => attemptUnlock({ authorSlug: "ama", poemSlug: "locked", password: "pass-123456", ip: "198.51.100.1", grants: [] });
    expect(await attempt()).toMatchObject({ ok: true });
    await act("/p/ama/locked", "hide");
    expect(await attempt()).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("a hidden novel (and every chapter) is missing to readers everywhere", () => {
  it("board, author page, novel and chapter pages, 404 checks, serials, sitemap, feeds, search, passage, short link, cover", async () => {
    expect(await ferrySeen()).toEqual(FERRY_SHOWN);
    // A chapter link hides its novel.
    const target = await findTakedownTarget(link("/a/ama/n/ferry/landing"));
    expect(target).toMatchObject({ kind: "novel", id: novelId, viaChapter: { slug: "landing" } });
    await applyTakedown(target!, "hide");
    expect(await ferrySeen()).toEqual(FERRY_HIDDEN);
    // The author is still there (their poems are).
    expect(await loadAuthorPage("ama")).not.toBeNull();
    await act("/a/ama/n/ferry", "restore");
    expect(await ferrySeen()).toEqual(FERRY_SHOWN);
  });
});

describe("a hidden author takes everything of theirs, their page and photo included", () => {
  it("is missing everywhere, and only them", async () => {
    expect(await isCurrentPhoto(PHOTO)).toBe(true);
    await act("/a/ama", "hide");
    expect((await loadBoardSections()).map((s) => s.slug)).toEqual(["kofi"]);
    expect(await loadAuthorPage("ama")).toBeNull();
    expect(await readerPathExists({ kind: "author", author: "ama" })).toBe(false);
    expect(await loadAuthorFeed("ama")).toBeNull();
    expect(await isCurrentPhoto(PHOTO)).toBe(false);
    expect(await searchBoard("Ama")).toEqual({ authors: [], novels: [], poems: [] });
    expect({ ...(await duskSeen()), dawnPart: null }).toEqual({
      ...Object.fromEntries(Object.keys(DUSK_SHOWN).map((k) => [k, false])),
      collectionPage: [],
      dawnPart: null,
      authorCollections: [],
    });
    expect(await ferrySeen()).toEqual(FERRY_HIDDEN);
    expect(await resolveReportTarget({ kind: "author", author: "ama" })).toBeNull();
    // Kofi is untouched.
    expect(await loadReaderPoem("kofi", "other")).not.toBeNull();

    await act("/a/ama", "restore");
    expect(await duskSeen()).toEqual(DUSK_SHOWN);
    expect(await ferrySeen()).toEqual(FERRY_SHOWN);
    expect(await isCurrentPhoto(PHOTO)).toBe(true);
  });
});

describe("the writer still has everything", () => {
  it("their own loaders, the hidden state and the export say what's hidden", async () => {
    await act("/p/ama/dusk", "hide");
    await act("/a/ama/n/ferry", "hide");
    expect((await listEditorPoems(ama)).map((p) => [p.slug, p.hidden]).sort()).toEqual([
      ["dawn", false],
      ["dusk", true],
      ["locked", false],
    ]);
    expect(await getEditorPoem(ama, duskId)).toMatchObject({ body: "Dusk lines.", hidden: true });
    expect((await listNovels(ama))[0]).toMatchObject({ slug: "ferry", hidden: true });
    expect(await getNovel(ama, novelId)).toMatchObject({ hidden: true, chapters: [expect.objectContaining({ slug: "landing" })] });
    expect(await hiddenStateFor(ama)).toEqual({ account: false, poems: 1, novels: 1 });
    await act("/a/ama", "hide");
    expect(await hiddenStateFor(ama)).toEqual({ account: true, poems: 1, novels: 1 });
    expect(await hiddenStateFor(kofi)).toEqual({ account: false, poems: 0, novels: 0 });

    const data = await loadEditorExport(ama, { site: "https://inkboard.example" });
    expect(data?.version).toBe(10);
    expect(data?.profile.hiddenAt).toEqual(expect.any(String));
    expect(data?.poems.find((p) => p.slug === "dusk")?.hiddenAt).toEqual(expect.any(String));
    expect(data?.poems.find((p) => p.slug === "dawn")?.hiddenAt).toBeNull();
    expect(data?.novels[0].hiddenAt).toEqual(expect.any(String));
  });

  it("saving or publishing never unhides", async () => {
    await act("/p/ama/dusk", "hide");
    const res = await updatePoem(ama, duskId, { title: "Dusk", body: "Dusk, edited.", visibility: "public", status: "published" });
    expect(res).toMatchObject({ ok: true });
    expect((await db.select({ h: poems.hiddenAt }).from(poems).where(eq(poems.id, duskId)))[0].h).not.toBeNull();
    expect(await loadReaderPoem("ama", "dusk")).toBeNull();
  });
});

describe("hidden work is never announced", () => {
  it("a poem first published while its author is hidden isn't claimed, then or after restore; a claimed poem since hidden isn't sent", async () => {
    const claimed = await createPoem(ama, { title: "Announced", body: "x", visibility: "public", status: "published" });
    expect(claimed).toMatchObject({ ok: true, announce: true });
    await act("/a/ama", "hide");
    if (!claimed.ok) throw new Error();
    expect(await announcePoem(claimed.poem.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });
    const res = await createPoem(ama, { title: "While hidden", body: "x", visibility: "public", status: "published" });
    expect(res).toMatchObject({ ok: true, announce: false });
    await act("/a/ama", "restore");
    if (!res.ok) throw new Error();
    expect((await db.select({ n: poems.notifiedAt }).from(poems).where(eq(poems.id, res.poem.id)))[0].n).toBeNull();
    expect(await updatePoem(ama, res.poem.id, { title: "While hidden", body: "y", visibility: "public", status: "published" })).toMatchObject({ announce: false });
  });

  it("a chapter published, or a scheduled one released, while its novel is hidden is never announced", async () => {
    await act("/a/ama/n/ferry", "hide");
    const now = await createChapter(ama, novelId, { title: "Two", body: "More.", status: "published" });
    expect(now).toMatchObject({ ok: true, announce: false });
    // A scheduled chapter whose time came while hidden (as if the daily step ran late).
    const [scheduled] = await db
      .insert(chapters)
      .values({ novelId, title: "Three", slug: "three", body: "Later.", position: 3, status: "published", publishedAt: sql`now() - interval '1 minute'`, releaseAt: sql`now() - interval '1 minute'` })
      .returning();
    await db.execute(sql`UPDATE chapters SET published_at = release_at WHERE id = ${scheduled.id}`);
    expect(await claimReleasedChapters()).toEqual([]);
    await act("/a/ama/n/ferry", "restore");
    expect(await claimReleasedChapters()).toEqual([]);
    const notified = await db.execute(sql`SELECT notified_at = '-infinity' AS never FROM chapters WHERE id = ${scheduled.id}`);
    expect((notified as unknown as { rows: { never: boolean }[] }).rows[0].never).toBe(true);
    expect(await announceChapter(scheduled.id)).toMatchObject({ skipped: "not-announceable" });
  });
});

describe("the owner's route: POST /api/owner/takedown", () => {
  const revalidate = vi.fn();
  const notify = vi.fn(async (to: string, change: "hidden" | "restored", d: { penName: string; kind: "poem" | "novel" | "author"; title: string | null; at: Date }) => {
    takedownNotices.push({ to, change, ...d });
  });
  const call = (body: unknown, auth = `Bearer ${SECRET}`) =>
    handleTakedown(
      new Request("http://localhost/api/owner/takedown", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) }),
      revalidate,
      notify,
    );
  beforeEach(() => {
    revalidate.mockClear();
    notify.mockClear();
  });

  it("401 without the secret, 400 for a bad action or a link it can't read, 404 for nothing there", async () => {
    expect((await call({ link: "/p/ama/dusk", action: "hide" }, "Bearer wrong")).status).toBe(401);
    expect((await call({ link: "/p/ama/dusk", action: "hide" }, "")).status).toBe(401);
    expect((await call({ link: "/p/ama/dusk", action: "delete" })).status).toBe(400);
    for (const bad of ["", "/", "/about", "/a/ama/c/cycle", "/s/0000", "https://x/p/ama", 42]) {
      expect((await call({ link: bad, action: "hide" })).status, String(bad)).toBe(400);
    }
    for (const missing of ["/p/ama/nope", "/a/nobody", "/a/ama/n/nope", "/a/ama/n/ferry/nope", "/s/bcdfgk"]) {
      expect((await call({ link: missing, action: "hide" })).status, missing).toBe(404);
    }
    expect(revalidate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(await loadReaderPoem("ama", "dusk")).not.toBeNull();
  });

  it("hides, says when it already is, restores, refreshes every cache at once and emails the writer", async () => {
    const hide = await call({ link: "https://inkboard.example/p/ama/dusk?x=1#y", action: "hide" });
    expect(hide.status).toBe(200);
    expect(await hide.json()).toEqual({
      ok: true,
      action: "hide",
      changed: true,
      kind: "poem",
      title: "Dusk",
      penName: "Ama Sɛwaa",
      path: "/p/ama/dusk",
      hidden: true,
    });
    expect(revalidate).toHaveBeenCalledWith(BOARD_TAG, { expire: 0 });
    expect(revalidate).toHaveBeenCalledWith(poemTag(duskId), { expire: 0 });
    expect(takedownNotices).toEqual([{ to: "ama@example.com", change: "hidden", penName: "Ama Sɛwaa", kind: "poem", title: "Dusk", at: expect.any(Date) }]);

    // Already hidden: nothing changes, nothing sent. The short link still names it for the owner.
    revalidate.mockClear();
    expect(await (await call({ link: "/s/BCDFGH", action: "hide" })).json()).toMatchObject({ changed: false, path: "/p/ama/dusk" });
    expect(revalidate).not.toHaveBeenCalled();
    expect(takedownNotices).toHaveLength(1);

    expect(await (await call({ link: "/s/bcdfgh", action: "restore" })).json()).toMatchObject({ changed: true, kind: "poem" });
    expect(takedownNotices.at(-1)).toMatchObject({ change: "restored", title: "Dusk" });
    expect(await (await call({ link: "/p/ama/dusk", action: "restore" })).json()).toMatchObject({ changed: false });
    expect(takedownNotices).toHaveLength(2);
    expect(await loadReaderPoem("ama", "dusk")).not.toBeNull();
  });

  it("a chapter link (or a chapter's short link) acts on its novel and says so; an author link on everything", async () => {
    expect(await (await call({ link: "/s/bcdfgj", action: "hide" })).json()).toMatchObject({
      changed: true,
      kind: "novel",
      title: "The Ferry",
      path: "/a/ama/n/ferry",
      viaChapter: { title: "Landing", slug: "landing" },
    });
    expect(await (await call({ link: "/a/ama", action: "hide" })).json()).toMatchObject({ changed: true, kind: "author", title: "Ama Sɛwaa", path: "/a/ama" });
    expect(takedownNotices.map((n) => [n.change, n.kind, n.title])).toEqual([
      ["hidden", "novel", "The Ferry"],
      ["hidden", "author", null],
    ]);
  });

  it("a failed email doesn't undo the takedown, and never logs the address", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    notify.mockRejectedValueOnce(new Error("smtp down for ama@example.com"));
    expect((await call({ link: "/p/ama/dusk", action: "hide" })).status).toBe(200);
    expect(await loadReaderPoem("ama", "dusk")).toBeNull();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("ama@example.com");
    errors.mockRestore();
  });
});

describe("the writer's emails", () => {
  const base = { penName: "Ama Sɛwaa", title: "Dusk", at: new Date("2026-11-21T10:30:00Z"), contact: "owner@inkboard.example", appUrl: "https://inkboard.example" };

  it("say what, when and where to ask, never the report or a reader", () => {
    const hidden = contentHiddenEmail({ ...base, kind: "poem" });
    expect(hidden.subject).toBe("Your poem was hidden on InkBoard");
    const restored = contentRestoredEmail({ ...base, kind: "novel", title: "The Ferry" });
    expect(restored.subject).toBe("Your novel is back on InkBoard");
    expect(contentHiddenEmail({ ...base, kind: "author", title: null }).subject).toBe("Your InkBoard author page was hidden");
    for (const m of [hidden, restored]) {
      for (const part of [m.text, m.html]) {
        expect(part).toContain("owner@inkboard.example");
        expect(part).toContain("Sat 21 Nov, 10:30 UTC");
        expect(part).toContain("https://inkboard.example/admin");
        // Nothing of the report (digits and "code": tests/email/templates.test.ts).
        expect(part).not.toMatch(/reason|details|reported by/i);
      }
    }
    expect(hidden.text).toContain("your poem “Dusk”");
    expect(hidden.text).toContain("Nothing is deleted");
    expect(hidden.html).toContain('href="mailto:owner@inkboard.example"');
    expect(restored.text).toContain("exactly as it was");
  });

  it("escape the title, and leave out one that breaks the notice rules", () => {
    expect(contentHiddenEmail({ ...base, kind: "poem", title: "<b>x</b>" }).html).not.toContain("<b>x</b>");
    for (const title of ["Poem 2026", "The code"]) {
      const m = contentHiddenEmail({ ...base, kind: "poem", title });
      expect(m.text).toContain("one of your poems");
      expect(m.text).not.toContain(title);
    }
  });

  it("the report email carries the command to hide that page", () => {
    const m = reportEmail({
      kind: "chapter",
      title: "The Ferry, Landing",
      penName: "Ama",
      link: "https://inkboard.example/a/ama/n/ferry/landing",
      reason: "Spam or advertising",
      details: null,
      at: new Date(),
      earlier: 0,
      path: "/a/ama/n/ferry/landing",
      appUrl: "https://inkboard.example",
    });
    expect(m.text).toContain("pnpm content:hide /a/ama/n/ferry/landing");
  });
});
