import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { createChapter, createNovel, scheduleChapter, updateNovel } from "@/server/novels";
import { saveSubscription } from "@/server/push";
import { announceReleasedChapters } from "@/server/release-announcements";
import { GET as cleanupRoute } from "@/app/api/cron/cleanup/route";

/*
 * Scheduled chapters' "new chapter" notifications (docs/PLAN.md, Phase 28):
 * readers see a scheduled chapter at its time without anything running, and
 * its notification goes out by the next daily cleanup at the latest (or when
 * its writer next works on their novels), through the publish path's own
 * once-only claim: followers only, the usual limits, never for a novel that
 * was private at the release. Real SQL; the network send is mocked.
 */

vi.mock("web-push", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("web-push") }>()).default;
  return { default: { ...real, sendNotification: vi.fn() } };
});
const send = vi.mocked(webpush.sendNotification);
// The cron route opts out of prerendering with connection(); outside a request (here) that throws.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    void task();
  },
  connection: async () => {},
}));

const db = getDb();
const saved = { ...process.env };
beforeAll(() => {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:owner@inkboard.app";
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
  resetEnvCache();
});
afterAll(() => {
  process.env = { ...saved };
  resetEnvCache();
});

const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const fcm = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
async function device(endpoint: string, prefs: { mode: "all" | "followed"; follows: string[] }) {
  const r = await saveSubscription({ endpoint, p256dh: P256DH, auth: AUTH }, prefs);
  if (!r.ok) throw new Error("not saved");
}
const sentTo = () => send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
const payloads = () => send.mock.calls.map((c) => JSON.parse(c[1] as string) as Record<string, unknown>);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const release = (id: string) =>
  db.execute(sql`UPDATE chapters SET release_at = now() - interval '1 minute', published_at = now() - interval '1 minute' WHERE id = ${id}`);

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

async function scheduled(title: string, editor = ama, novel = novelId) {
  const c = await createChapter(editor, novel, { title, body: "SECRET CHAPTER TEXT" });
  if (!c.ok) throw new Error("chapter");
  const s = await scheduleChapter(editor, c.chapter.id, inDays(1));
  if (!s.ok) throw new Error(JSON.stringify(s));
  return c.chapter.id;
}

describe("a released scheduled chapter is announced once, to its author's followers only", () => {
  it("nothing before its time; once after it, never twice; followers only", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    await device(fcm(2), { mode: "all", follows: [] }); // all new poems, follows no one: never chapters
    await device(fcm(3), { mode: "followed", follows: ["kofi"] });
    const id = await scheduled("Thursday");

    expect(await announceReleasedChapters()).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();

    await release(id);
    expect(await announceReleasedChapters()).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sentTo()).toEqual([fcm(1)]);
    expect(payloads()[0]).toMatchObject({ title: "New chapter: The Ferry at Yeji, Chapter 1", author: "Ama Sɛwaa" });
    expect(JSON.stringify(payloads())).not.toContain("SECRET");

    expect(await announceReleasedChapters()).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the writer's own trigger claims only that writer's chapters; the daily step claims the rest", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa", "kofi"] });
    const amas = await scheduled("Thursday");
    const kbook = await createNovel(kofi, { title: "Harmattan" });
    if (!kbook.ok) throw new Error("novel");
    const kofis = await scheduled("Dust", kofi, kbook.novel.id);
    await release(amas);
    await release(kofis);
    expect(await announceReleasedChapters(kofi)).toMatchObject({ claimed: 1, sent: 1 });
    expect(payloads()[0]).toMatchObject({ author: "Kofi" });
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 1, sent: 1 });
    expect(payloads()[1]).toMatchObject({ author: "Ama Sɛwaa" });
  });

  it("the usual limits: a second chapter by the same author within 12 hours is the quiet grouped update", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    const now = await createChapter(ama, novelId, { title: "Thursday", body: "Text.", status: "published" });
    if (!now.ok || !now.announce) throw new Error("published");
    const { announceChapter } = await import("@/server/push");
    await announceChapter(now.chapter.id);
    const id = await scheduled("The Landing");
    await release(id);
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 1, sent: 1 });
    expect(payloads().map((p) => p.count)).toEqual([1, 2]);
  });
});

describe("never for a novel that was private at the release (Phase 25 rules hold)", () => {
  const makePrivate = () => updateNovel(ama, novelId, { title: "The Ferry at Yeji", visibility: "private", password: "novel-pass" });
  const makePublic = () => updateNovel(ama, novelId, { title: "The Ferry at Yeji", visibility: "public" });

  it("released while private: not then, not after the novel goes public", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    expect(await makePrivate()).toMatchObject({ ok: true });
    const id = await scheduled("Thursday");
    await release(id);
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 0, sent: 0 });
    expect(await makePublic()).toMatchObject({ ok: true });
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("released while public, made private before the step ran: never sent, even once public again", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    const id = await scheduled("Thursday");
    await release(id);
    expect(await makePrivate()).toMatchObject({ ok: true });
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 0, sent: 0 });
    expect(await makePublic()).toMatchObject({ ok: true });
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("scheduled while private, the novel public by the release: announced (its first publish is public)", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    await makePrivate();
    const id = await scheduled("Thursday");
    await makePublic(); // before the release: nothing released yet to settle
    await release(id);
    expect(await announceReleasedChapters()).toMatchObject({ claimed: 1, sent: 1 });
  });
});

describe("the daily cleanup runs the step (/api/cron/cleanup)", () => {
  it("announces released chapters and reports them, behind the cron secret", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    await release(await scheduled("Thursday"));
    expect((await cleanupRoute(new Request("http://x/api/cron/cleanup"))).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
    const res = await cleanupRoute(new Request("http://x/api/cron/cleanup", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, released: { claimed: 1, sent: 1, failed: 0 } });
    expect(sentTo()).toEqual([fcm(1)]);
  });
});
