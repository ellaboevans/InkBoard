import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { getDb } from "@/db";
import { editors, poems, pushDeliveries, pushSubscriptions } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { cleanupExpiredRows } from "@/server/maintenance";
import { createPoem, updatePoem, type PoemInput } from "@/server/poems";
import { announcePoem, claimDeliveries, deleteSubscription, saveSubscription } from "@/server/push";

// The network send is mocked; everything else (SQL, locks, limits) is real.
vi.mock("web-push", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("web-push") }>()).default;
  return { default: { ...real, sendNotification: vi.fn() } };
});
const send = vi.mocked(webpush.sendNotification);

const db = getDb();
const saved = { ...process.env };
const keys = webpush.generateVAPIDKeys();
beforeAll(() => {
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
const device = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
async function subscribeDevices(n: number) {
  for (let i = 1; i <= n; i++) await saveSubscription({ endpoint: device(i), p256dh: P256DH, auth: AUTH });
}

let ada: string;
let eve: string;
let kofi: string;
let yaa: string;
let nameless: string;
beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  const rows = await db
    .insert(editors)
    .values([
      { email: "ada@example.com", penName: "Ada", slug: "ada" },
      { email: "eve@example.com", penName: "Eve", slug: "eve" },
      { email: "kofi@example.com", penName: "Kofi", slug: "kofi" },
      { email: "yaa@example.com", penName: "Yaa", slug: "yaa" },
      { email: "new@example.com" }, // not onboarded: no pen name
    ])
    .returning();
  [ada, eve, kofi, yaa, nameless] = rows.map((r) => r.id);
});

const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Night Market",
  body: "kerosene lamps in a row,\nthe smell of roasting plantain",
  visibility: "public",
  status: "published",
  ...over,
});
async function publish(editorId: string, over: Partial<PoemInput> = {}) {
  const res = await createPoem(editorId, input(over));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res;
}
const notifiedAt = async (id: string) =>
  (await db.select({ at: poems.notifiedAt }).from(poems).where(eq(poems.id, id)))[0].at;
const sentTo = () => send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);
async function age(hours: number) {
  await db.execute(sql`UPDATE push_deliveries SET sent_at = sent_at - make_interval(hours => ${hours})`);
}

describe("when a poem is announced: once, public only", () => {
  it("announces a poem published public, and records it on the poem", async () => {
    const res = await publish(ada);
    expect(res.announce).toBe(true);
    expect(await notifiedAt(res.poem.id)).toBeInstanceOf(Date);
  });

  it("announces a draft when it is first published", async () => {
    const draft = await publish(ada, { status: "draft" });
    expect(draft.announce).toBe(false);
    expect(await notifiedAt(draft.poem.id)).toBeNull();
    const res = await updatePoem(ada, draft.poem.id, input());
    expect(res).toMatchObject({ ok: true, announce: true });
  });

  it("never again: not on edits, not after unpublishing and republishing", async () => {
    const { poem } = await publish(ada);
    const first = await notifiedAt(poem.id);
    expect(await updatePoem(ada, poem.id, input({ body: "an edit" }))).toMatchObject({ announce: false });
    expect(await updatePoem(ada, poem.id, input({ status: "draft" }))).toMatchObject({ announce: false });
    expect(await updatePoem(ada, poem.id, input())).toMatchObject({ announce: false });
    expect(await notifiedAt(poem.id)).toEqual(first);
  });

  it("never for a private poem, not even when it is later made public", async () => {
    const res = await publish(ada, { visibility: "private", password: "lantern-light-1" });
    expect(res.announce).toBe(false);
    expect(await notifiedAt(res.poem.id)).toBeNull();
    const made = await updatePoem(ada, res.poem.id, input({ visibility: "public" }));
    expect(made).toMatchObject({ ok: true, announce: false });
    expect(await notifiedAt(res.poem.id)).toBeNull();
  });

  it("never for an author without a pen name", async () => {
    expect((await publish(nameless)).announce).toBe(false);
  });

  it("sending re-checks: a poem made private (or unclaimed) is not sent", async () => {
    await subscribeDevices(1);
    const { poem } = await publish(ada);
    await db.update(poems).set({ visibility: "private", passwordHash: "scrypt$x" }).where(eq(poems.id, poem.id));
    expect(await announcePoem(poem.id)).toMatchObject({ skipped: "not-announceable", sent: 0 });
    const draft = await publish(eve, { status: "draft" });
    expect(await announcePoem(draft.poem.id)).toMatchObject({ skipped: "not-announceable" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("what is sent", () => {
  it("one push per device, with exactly title, author, url and tag, and the delivery options", async () => {
    await subscribeDevices(2);
    const { poem } = await publish(ada, { title: "Ɔdɔ Song", body: "SECRET-BODY-LINE never leaves" });
    expect(await announcePoem(poem.id)).toMatchObject({ sent: 2, gone: 0, limited: 0 });
    expect(sentTo().sort()).toEqual([device(1), device(2)]);
    const [sub, payload, options] = send.mock.calls[0];
    expect(sub).toEqual({ endpoint: expect.any(String), keys: { p256dh: P256DH, auth: AUTH } });
    expect(JSON.parse(payload as string)).toStrictEqual({
      title: "Ɔdɔ Song",
      author: "Ada",
      url: `/p/ada/${poem.slug}`,
      tag: `poem:${poem.id}`,
    });
    expect(payload).not.toContain("SECRET-BODY-LINE");
    expect(options).toMatchObject({
      TTL: 86400,
      urgency: "normal",
      topic: poem.id.replace(/-/g, ""),
      timeout: 10_000,
      vapidDetails: { subject: "mailto:owner@inkboard.app", publicKey: keys.publicKey, privateKey: keys.privateKey },
    });
    expect((options as { topic: string }).topic.length).toBeLessThanOrEqual(32);
  });

  it("does nothing when notifications aren't configured", async () => {
    await subscribeDevices(1);
    const { poem } = await publish(ada);
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VAPID_PRIVATE_KEY = "";
    resetEnvCache();
    try {
      expect(await announcePoem(poem.id)).toMatchObject({ skipped: "not-configured" });
    } finally {
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
      process.env.VAPID_PRIVATE_KEY = keys.privateKey;
      resetEnvCache();
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe("limits per device", () => {
  it("one notification per author in 12 hours", async () => {
    await subscribeDevices(1);
    const one = await publish(ada, { title: "One" });
    const two = await publish(ada, { title: "Two" });
    expect(await announcePoem(one.poem.id)).toMatchObject({ sent: 1 });
    expect(await announcePoem(two.poem.id)).toMatchObject({ sent: 0, limited: 1 });
    // Another author is still fine.
    expect(await announcePoem((await publish(eve)).poem.id)).toMatchObject({ sent: 1 });
    // After 12 hours, Ada again.
    await age(12);
    expect(await announcePoem((await publish(ada, { title: "Three" })).poem.id)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("three notifications per device in 24 hours", async () => {
    await subscribeDevices(1);
    for (const ed of [ada, eve, kofi]) expect(await announcePoem((await publish(ed)).poem.id)).toMatchObject({ sent: 1 });
    expect(await announcePoem((await publish(yaa)).poem.id)).toMatchObject({ sent: 0, limited: 1 });
    await age(13); // the per-author window is over, the daily one isn't
    expect(await announcePoem((await publish(ada, { title: "Later" })).poem.id)).toMatchObject({ sent: 0, limited: 1 });
    await age(11); // 24 hours after the first three
    expect(await announcePoem((await publish(yaa, { title: "Next day" })).poem.id)).toMatchObject({ sent: 1 });
  });

  it("limits are per device: a fresh device still gets it", async () => {
    await subscribeDevices(1);
    for (const ed of [ada, eve, kofi]) await announcePoem((await publish(ed)).poem.id);
    await saveSubscription({ endpoint: device(2), p256dh: P256DH, auth: AUTH });
    send.mockClear();
    expect(await announcePoem((await publish(yaa)).poem.id)).toMatchObject({ sent: 1, limited: 1 });
    expect(sentTo()).toEqual([device(2)]);
  });

  it("two poems published at once can't both take a device's last slot", async () => {
    await subscribeDevices(5);
    for (const ed of [ada, eve]) await announcePoem((await publish(ed)).poem.id); // 2 of 3 used
    send.mockClear();
    const [k, y] = [await publish(kofi), await publish(yaa)];
    const results = await Promise.all([announcePoem(k.poem.id), announcePoem(y.poem.id)]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(5); // one of the two per device
    expect(results.reduce((n, r) => n + r.limited, 0)).toBe(5);
    const perDevice = (await db.execute(sql`
      SELECT subscription_id, count(*)::int AS n FROM push_deliveries GROUP BY subscription_id
    `)) as unknown as { rows: { n: number }[] };
    expect(perDevice.rows.map((r) => r.n)).toEqual([3, 3, 3, 3, 3]);
  });

  it("the same author's two poems at once: one notification per device", async () => {
    await subscribeDevices(3);
    const [a, b] = [await publish(ada, { title: "A" }), await publish(ada, { title: "B" })];
    const ids = (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)).map((r) => r.id);
    const claims = await Promise.all([claimDeliveries(ada, a.poem.id, ids), claimDeliveries(ada, b.poem.id, ids)]);
    expect(claims[0].length + claims[1].length).toBe(3);
  });
});

describe("what push services answer", () => {
  it("404 and 410 delete the subscription; 429/5xx keep it; success is recorded", async () => {
    await subscribeDevices(4);
    send.mockImplementation(async (s) => {
      const n = Number(/device-(\d)/.exec((s as { endpoint: string }).endpoint)![1]);
      const status = [0, 201, 404, 410, 503][n];
      if (status >= 400) throw Object.assign(new Error("push failed"), { statusCode: status });
      return { statusCode: status, body: "", headers: {} };
    });
    expect(await announcePoem((await publish(ada)).poem.id)).toMatchObject({ sent: 1, gone: 2, failed: 1 });
    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((r) => r.endpoint).sort()).toEqual([device(1), device(4)]);
    const ok = rows.find((r) => r.endpoint === device(1))!;
    const retry = rows.find((r) => r.endpoint === device(4))!;
    expect(ok.lastSuccessAt).toBeInstanceOf(Date);
    expect(retry.lastSuccessAt).toBeNull();
    expect(retry.lastAttemptAt).toBeInstanceOf(Date);
  });

  it("a network error or timeout keeps the subscription", async () => {
    await subscribeDevices(1);
    send.mockRejectedValue(new Error("ETIMEDOUT"));
    expect(await announcePoem((await publish(ada)).poem.id)).toMatchObject({ failed: 1, gone: 0 });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("stops starting batches when the time budget is spent", async () => {
    await subscribeDevices(3);
    let t = 0;
    const res = await announcePoem((await publish(ada)).poem.id, { budgetMs: 1000, now: () => (t += 2000) });
    expect(res).toMatchObject({ sent: 0, unreached: 3 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("subscriptions", () => {
  it("saving is an upsert on the endpoint; deleting removes the row", async () => {
    expect(await saveSubscription({ endpoint: device(1), p256dh: P256DH, auth: AUTH })).toBe(true);
    expect(await saveSubscription({ endpoint: device(1), p256dh: P256DH, auth: "AAAAAAAAAAAAAAAAAAAAAA" })).toBe(false);
    expect((await db.select().from(pushSubscriptions))[0].auth).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(await deleteSubscription(device(1))).toBe(true);
    expect(await deleteSubscription(device(1))).toBe(false);
  });

  it("deleting a subscription removes its delivery history", async () => {
    await subscribeDevices(1);
    await announcePoem((await publish(ada)).poem.id);
    expect(await db.select().from(pushDeliveries)).toHaveLength(1);
    await deleteSubscription(device(1));
    expect(await db.select().from(pushDeliveries)).toHaveLength(0);
  });
});

describe("cleanup cron", () => {
  it("deletes addresses we couldn't use for 90 days, keeps the rest", async () => {
    await subscribeDevices(5);
    await announcePoem((await publish(ada)).poem.id); // one delivery row per device, recent
    const set = (n: number, v: Record<string, unknown>) =>
      db.update(pushSubscriptions).set(v).where(eq(pushSubscriptions.endpoint, device(n)));
    const days = (d: number) => sql`now() - make_interval(days => ${d})`;
    // 1: tried, last success 91 days ago → deleted
    await set(1, { createdAt: days(200), lastSuccessAt: days(91), lastAttemptAt: days(1) });
    // 2: never succeeded, made 100 days ago, tried since → deleted
    await set(2, { createdAt: days(100), lastSuccessAt: null, lastAttemptAt: days(5) });
    // 3: succeeded 30 days ago → kept
    await set(3, { createdAt: days(200), lastSuccessAt: days(30), lastAttemptAt: days(30) });
    // 4: old, but we never had anything to send since its last success → kept
    await set(4, { createdAt: days(300), lastSuccessAt: days(120), lastAttemptAt: days(120) });
    // 5: brand new → kept
    await db.execute(sql`UPDATE push_deliveries SET sent_at = now() - interval '3 days' WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE endpoint = ${device(3)})`);
    const res = await cleanupExpiredRows();
    expect(res).toMatchObject({ pushSubscriptions: 2, pushDeliveries: 1 });
    expect((await db.select().from(pushSubscriptions)).map((r) => r.endpoint).sort()).toEqual([device(3), device(4), device(5)]);
  });
});
