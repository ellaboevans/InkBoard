import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { getDb } from "@/db";
import { chapters, editors, pushDeliveries } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { DEVICE_DAILY_LIMIT, newChapterPayload, newPoemPayload } from "@/lib/push-rules";
import { createChapter, createNovel, publishChapter, saveChapter, unpublishChapter, updateNovel } from "@/server/novels";
import { createPoem } from "@/server/poems";
import { announceChapter, announcePoem, saveSubscription } from "@/server/push";

/*
 * "New chapter" notifications (docs/PLAN.md, Phase 24), with real SQL and
 * the network send mocked: a chapter is announced once (its first publish,
 * claimed in that transaction), only to devices that follow its author (an
 * owner's decision: "All new poems" alone never brings chapters), with the
 * same limits and grouping as poems, shared with them.
 */

vi.mock("web-push", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("web-push") }>()).default;
  return { default: { ...real, sendNotification: vi.fn() } };
});
const send = vi.mocked(webpush.sendNotification);

const db = getDb();
const saved = { ...process.env };
beforeAll(() => {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:owner@inkboard.app";
  resetEnvCache();
});
afterAll(() => {
  process.env = { ...saved };
  resetEnvCache();
});

const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const fcm = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const apple = (n: number) => `https://web.push.apple.com/device-${n}`;
async function device(endpoint: string, prefs?: { mode: "all" | "followed"; follows: string[] }) {
  const r = await saveSubscription({ endpoint, p256dh: P256DH, auth: AUTH }, prefs ?? null);
  if (!r.ok) throw new Error("not saved");
}
const sentTo = () => send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
const payloads = () => send.mock.calls.map((c) => JSON.parse(c[1] as string) as Record<string, unknown>);

let ama: string;
let kofi: string;
let novelId: string;
beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  const rows = await db
    .insert(editors)
    .values([
      { email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama-sewaa" },
      { email: "kofi@example.com", penName: "Kofi", slug: "kofi" },
    ])
    .returning();
  [ama, kofi] = rows.map((r) => r.id);
  const novel = await createNovel(ama, { title: "The Ferry at Yeji" });
  if (!novel.ok) throw new Error("novel");
  novelId = novel.novel.id;
});

async function chapter(title: string, status: "draft" | "published" = "published") {
  const res = await createChapter(ama, novelId, { title, body: "SECRET CHAPTER TEXT", status });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res;
}
const notifiedAt = async (id: string) => (await db.select({ at: chapters.notifiedAt }).from(chapters).where(eq(chapters.id, id)))[0].at;

describe("a chapter is announced once: on its first publish, claimed in that transaction", () => {
  it("claims it when created published, or when a draft is first published; never for a draft", async () => {
    const one = await chapter("Thursday");
    expect(one.announce).toBe(true);
    expect(await notifiedAt(one.chapter.id)).toBeInstanceOf(Date);

    const draft = await chapter("The Landing", "draft");
    expect(draft.announce).toBe(false);
    expect(await notifiedAt(draft.chapter.id)).toBeNull();
    expect(await saveChapter(ama, draft.chapter.id, { title: "The Landing", body: "edited" })).toMatchObject({ announce: false });
    expect(await saveChapter(ama, draft.chapter.id, { title: "The Landing", body: "text", status: "published" })).toMatchObject({
      ok: true,
      announce: true,
    });
  });

  it("never again: not on edits, not after unpublishing and publishing again (either path)", async () => {
    const { chapter: c } = await chapter("Thursday");
    const first = await notifiedAt(c.id);
    expect(await saveChapter(ama, c.id, { title: "Thursday", body: "an edit" })).toMatchObject({ announce: false });
    expect(await saveChapter(ama, c.id, { title: "Thursday", body: "x", status: "draft" })).toMatchObject({ announce: false });
    expect(await saveChapter(ama, c.id, { title: "Thursday", body: "x", status: "published" })).toMatchObject({ announce: false });
    expect(await unpublishChapter(ama, c.id)).toMatchObject({ announce: false });
    expect(await publishChapter(ama, c.id)).toMatchObject({ announce: false });
    expect(await notifiedAt(c.id)).toEqual(first);
  });

  it("re-checks before sending: nothing for a chapter never claimed, or unpublished since", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    const draft = await chapter("Draft", "draft");
    expect(await announceChapter(draft.chapter.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });
    const { chapter: c } = await chapter("Thursday");
    await saveChapter(ama, c.id, { title: "Thursday", body: "x", status: "draft" });
    expect(await announceChapter(c.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("who hears about a chapter: followers only", () => {
  it("devices that follow the author, in either mode; never an 'all new poems' device that doesn't follow them", async () => {
    await device(fcm(1)); // all new poems, follows nobody
    await device(fcm(2), { mode: "followed", follows: ["ama-sewaa"] });
    await device(fcm(3), { mode: "all", follows: ["ama-sewaa"] });
    await device(fcm(4), { mode: "followed", follows: ["kofi"] });
    const { chapter: c } = await chapter("Thursday");
    expect(await announceChapter(c.id)).toMatchObject({ sent: 2, limited: 0 });
    expect(sentTo()).toEqual([fcm(2), fcm(3)].sort());
    // The "all" device still gets the author's poems, as before.
    send.mockClear();
    const poem = await createPoem(ama, { title: "Harbour", body: "boats", visibility: "public", status: "published" });
    if (!poem.ok) throw new Error("poem");
    await announcePoem(poem.poem.id);
    expect(sentTo()).toContain(fcm(1));
  });

  it("sends the poems' five fields: 'New chapter: <novel>, Chapter n' (numbered among published chapters), the chapter's URL, no text", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    await chapter("Thursday");
    await chapter("Not Yet", "draft");
    const { chapter: c } = await chapter("The Radio");
    await db.execute(sql`DELETE FROM push_deliveries`); // a fresh window for this device
    await announceChapter(c.id);
    expect(payloads()).toEqual([
      {
        title: "New chapter: The Ferry at Yeji, Chapter 2",
        author: "Ama Sɛwaa",
        url: "/a/ama-sewaa/n/the-ferry-at-yeji/the-radio",
        tag: `author:${ama}`,
        count: 1,
      },
    ]);
    expect(JSON.stringify(payloads())).not.toContain("SECRET");
    expect(Object.keys(newChapterPayload({ editorId: ama, novelTitle: "N", number: 1, penName: "P", authorSlug: "a", novelSlug: "n", chapterSlug: "c", count: 1 })).sort()).toEqual(
      Object.keys(newPoemPayload({ editorId: ama, title: "T", penName: "P", authorSlug: "a", poemSlug: "p", count: 1 })).sort(),
    );
  });
});

describe("the same limits and grouping as poems, shared with them", () => {
  it("a poem then a chapter by the same author: one alert, then a quiet update ('2 new', the author page); Apple gets only the alert", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    await device(apple(2), { mode: "followed", follows: ["ama-sewaa"] });
    const poem = await createPoem(ama, { title: "Harbour", body: "boats", visibility: "public", status: "published" });
    if (!poem.ok) throw new Error("poem");
    expect(await announcePoem(poem.poem.id)).toMatchObject({ sent: 2, updates: 0 });
    send.mockClear();
    const { chapter: c } = await chapter("Thursday");
    expect(await announceChapter(c.id)).toMatchObject({ sent: 1, updates: 1, limited: 1 });
    expect(sentTo()).toEqual([fcm(1)]);
    expect(payloads()[0]).toMatchObject({ url: "/a/ama-sewaa", count: 2 });
    const kinds = await db.select({ kind: pushDeliveries.kind, poem: pushDeliveries.poemId, chapter: pushDeliveries.chapterId }).from(pushDeliveries);
    expect(kinds.filter((k) => k.chapter === c.id).map((k) => k.kind)).toEqual(["update"]);
    expect(kinds.every((k) => (k.poem === null) !== (k.chapter === null))).toBe(true);
  });

  it("chapters and poems count together toward a device's alerts a day", async () => {
    await device(fcm(1), { mode: "all", follows: ["ama-sewaa"] });
    // Alerts from other authors fill the device's day, one short of the limit.
    for (let i = 0; i < DEVICE_DAILY_LIMIT - 1; i++) {
      const [e] = await db.insert(editors).values({ email: `p${i}@x.com`, penName: `Poet ${i}`, slug: `poet-${i}` }).returning();
      const p = await createPoem(e.id, { title: `P${i}`, body: "x", visibility: "public", status: "published" });
      if (!p.ok) throw new Error("poem");
      await announcePoem(p.poem.id);
    }
    expect(send).toHaveBeenCalledTimes(DEVICE_DAILY_LIMIT - 1);
    // The chapter takes the last alert of the day…
    const one = await chapter("Thursday");
    expect(await announceChapter(one.chapter.id)).toMatchObject({ sent: 1 });
    // …so Kofi's poem is over the limit for this device.
    const k = await createPoem(kofi, { title: "K", body: "x", visibility: "public", status: "published" });
    if (!k.ok) throw new Error("poem");
    expect(await announcePoem(k.poem.id)).toMatchObject({ sent: 0, limited: 1 });
  });
});

describe("private novels (Phase 25): a chapter first published while its novel is private is never announced", () => {
  const makePrivate = () => updateNovel(ama, novelId, { title: "The Ferry at Yeji", visibility: "private", password: "novel-pass" });
  const makePublic = () => updateNovel(ama, novelId, { title: "The Ferry at Yeji", visibility: "public" });

  it("not when published private, not when the novel goes public later, not after republishing; a chapter first published once it's public is", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    expect(await makePrivate()).toMatchObject({ ok: true });
    const created = await chapter("Thursday");
    expect(created.announce).toBe(false);
    expect(await notifiedAt(created.chapter.id)).toBeNull();
    const draft = await chapter("The Landing", "draft");
    expect(await publishChapter(ama, draft.chapter.id)).toMatchObject({ ok: true, announce: false });
    expect(await announceChapter(created.chapter.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });

    expect(await makePublic()).toMatchObject({ ok: true });
    expect(await unpublishChapter(ama, created.chapter.id)).toMatchObject({ announce: false });
    expect(await publishChapter(ama, created.chapter.id)).toMatchObject({ announce: false });
    expect(await saveChapter(ama, draft.chapter.id, { title: "The Landing", body: "x", status: "draft" })).toMatchObject({ announce: false });
    expect(await saveChapter(ama, draft.chapter.id, { title: "The Landing", body: "x", status: "published" })).toMatchObject({ announce: false });
    expect(await notifiedAt(created.chapter.id)).toBeNull();
    expect(await notifiedAt(draft.chapter.id)).toBeNull();
    expect(await announceChapter(created.chapter.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });
    expect(send).not.toHaveBeenCalled();

    const later = await chapter("The Return");
    expect(later.announce).toBe(true);
    expect(await announceChapter(later.chapter.id)).toMatchObject({ sent: 1 });
  });

  it("re-checks before sending: a claimed chapter whose novel went private since isn't sent", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    const { chapter: c, announce } = await chapter("Thursday");
    expect(announce).toBe(true);
    await makePrivate();
    expect(await announceChapter(c.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
