import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { POST as PREFS } from "@/app/api/push/preferences/route";
import { POST as SUBSCRIBE } from "@/app/api/push/subscription/route";
import { getDb } from "@/db";
import { editors, pushDeliveries, pushFollows, pushSubscriptions } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { UPDATES_PER_WINDOW } from "@/lib/push-rules";
import { createPoem, type PoemInput } from "@/server/poems";
import { announcePoem, changePrefs, deleteSubscription, saveSubscription } from "@/server/push";

/* Phase 18 round 2: following authors, proof of ownership, grouped bursts. */

vi.mock("web-push", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("web-push") }>()).default;
  return { default: { ...real, sendNotification: vi.fn() } };
});
const meta = vi.hoisted(() => ({ ip: "203.0.113.9" as string | null }));
vi.mock("@/server/auth/dal", () => ({ getRequestMeta: async () => ({ ip: meta.ip, userAgent: "test" }) }));
const send = vi.mocked(webpush.sendNotification);

const db = getDb();
const saved = { ...process.env };
beforeAll(() => {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:owner@inkboard.app";
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
});
afterAll(() => {
  process.env = { ...saved };
  resetEnvCache();
});

const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const WRONG = "AAAAAAAAAAAAAAAAAAAAAA";
const fcm = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const apple = (n: number) => `https://web.push.apple.com/device-${n}`;
const own = (endpoint: string) => ({ endpoint, auth: AUTH });

let ama: string;
let kofi: string;
let efua: string;
let yaw: string;
beforeEach(async () => {
  meta.ip = "203.0.113.9";
  send.mockReset();
  send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  const rows = await db
    .insert(editors)
    .values([
      { email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama-sewaa" },
      { email: "kofi@example.com", penName: "Kofi", slug: "kofi" },
      { email: "efua@example.com", penName: "Efua", slug: "efua" },
      { email: "yaw@example.com", penName: "Yaw", slug: "yaw" },
    ])
    .returning();
  [ama, kofi, efua, yaw] = rows.map((r) => r.id);
});

async function device(endpoint: string, prefs?: { mode: "all" | "followed"; follows: string[] }) {
  const r = await saveSubscription({ endpoint, p256dh: P256DH, auth: AUTH }, prefs ?? null);
  if (!r.ok) throw new Error("not saved");
  return r;
}
const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Night Market",
  body: "kerosene lamps in a row",
  visibility: "public",
  status: "published",
  ...over,
});
async function announce(editorId: string, title = "Night Market") {
  const res = await createPoem(editorId, input({ title }));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return announcePoem(res.poem.id);
}
const sentTo = () => send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
const lastPayloads = () => send.mock.calls.map((c) => JSON.parse(c[1] as string) as Record<string, unknown>);

describe("modes and follows: who receives a poem", () => {
  it("'All new poems' devices get every author; 'followed' devices only the authors they follow", async () => {
    await device(fcm(1)); // all
    await device(fcm(2), { mode: "followed", follows: ["ama-sewaa"] });
    await device(fcm(3), { mode: "followed", follows: ["kofi"] });
    await device(fcm(4), { mode: "followed", follows: [] }); // follows nobody: gets nothing
    await device(fcm(5), { mode: "all", follows: ["kofi"] }); // follows are kept, mode wins
    expect(await announce(ama)).toMatchObject({ sent: 3 });
    expect(sentTo()).toEqual([fcm(1), fcm(2), fcm(5)]);
    send.mockClear();
    expect(await announce(kofi)).toMatchObject({ sent: 3 });
    expect(sentTo()).toEqual([fcm(1), fcm(3), fcm(5)]);
  });

  it("changing the mode and follows changes what arrives", async () => {
    await device(fcm(1));
    expect(await changePrefs(own(fcm(1)), { op: "mode", mode: "followed" })).toEqual({ mode: "followed", follows: [] });
    expect(await announce(ama)).toMatchObject({ sent: 0 });
    expect(await changePrefs(own(fcm(1)), { op: "follow", author: "efua" })).toEqual({
      mode: "followed",
      follows: [{ slug: "efua", penName: "Efua" }],
    });
    expect(await announce(efua)).toMatchObject({ sent: 1 });
    expect(await changePrefs(own(fcm(1)), { op: "unfollow", author: "efua" })).toMatchObject({ follows: [] });
    expect(await announce(efua, "Second")).toMatchObject({ sent: 0 });
  });

  it("following is idempotent, ignores unknown or not-onboarded authors, and lists by pen name", async () => {
    await db.insert(editors).values({ email: "new@example.com", slug: "not-yet" }); // no pen name
    await device(fcm(1), { mode: "followed", follows: ["kofi", "ama-sewaa", "nobody", "not-yet"] });
    await changePrefs(own(fcm(1)), { op: "follow", author: "kofi" });
    expect(await changePrefs(own(fcm(1)), { op: "get" })).toEqual({
      mode: "followed",
      follows: [
        { slug: "ama-sewaa", penName: "Ama Sɛwaa" },
        { slug: "kofi", penName: "Kofi" },
      ],
    });
  });
});

describe("proof of ownership", () => {
  it("a wrong auth secret, or an unknown endpoint, reads and changes nothing", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    for (const op of [{ op: "get" }, { op: "mode", mode: "all" }, { op: "follow", author: "kofi" }, { op: "unfollow", author: "ama-sewaa" }] as const) {
      expect(await changePrefs({ endpoint: fcm(1), auth: WRONG }, op)).toBeNull();
      expect(await changePrefs({ endpoint: fcm(9), auth: AUTH }, op)).toBeNull();
    }
    expect(await changePrefs(own(fcm(1)), { op: "get" })).toEqual({ mode: "followed", follows: [{ slug: "ama-sewaa", penName: "Ama Sɛwaa" }] });
    expect(await deleteSubscription({ endpoint: fcm(1), auth: WRONG })).toBe(false);
  });

  it("re-registering with someone else's endpoint can't replace their keys or prefs", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa"] });
    expect(await saveSubscription({ endpoint: fcm(1), p256dh: P256DH, auth: WRONG }, { mode: "all", follows: [] })).toEqual({ ok: false });
    expect(await changePrefs(own(fcm(1)), { op: "get" })).toMatchObject({ mode: "followed" });
  });

  describe("POST /api/push/preferences", () => {
    const req = (body: unknown, origin: string | null = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/push/preferences", {
        method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      });

    it("answers the owner, and the same 404 for a wrong secret or an unknown endpoint", async () => {
      await device(fcm(1), { mode: "followed", follows: ["kofi"] });
      const ok = await PREFS(req({ endpoint: fcm(1), auth: AUTH, op: "get" }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ mode: "followed", follows: [{ slug: "kofi", penName: "Kofi" }] });
      const wrong = await PREFS(req({ endpoint: fcm(1), auth: WRONG, op: "get" }));
      const unknown = await PREFS(req({ endpoint: fcm(2), auth: AUTH, op: "get" }));
      expect([wrong.status, unknown.status]).toEqual([404, 404]);
      expect(await wrong.json()).toEqual(await unknown.json());
    });

    it("refuses an endpoint alone, other origins, bad operations and foreign hosts", async () => {
      await device(fcm(1));
      expect((await PREFS(req({ endpoint: fcm(1), op: "get" }))).status).toBe(400);
      expect((await PREFS(req({ endpoint: fcm(1), auth: AUTH, op: "get" }, "https://evil.example.com"))).status).toBe(403);
      expect((await PREFS(req({ endpoint: fcm(1), auth: AUTH, op: "mode", mode: "everything" }))).status).toBe(400);
      expect((await PREFS(req({ endpoint: "https://evil.example.com/x", auth: AUTH, op: "get" }))).status).toBe(400);
      expect(await changePrefs(own(fcm(1)), { op: "get" })).toMatchObject({ mode: "all" });
    });

    it("is rate-limited per IP bucket", async () => {
      await device(fcm(1));
      for (let i = 0; i < 60; i++) expect((await PREFS(req({ endpoint: fcm(1), auth: AUTH, op: "get" }))).status).toBe(200);
      const limited = await PREFS(req({ endpoint: fcm(1), auth: AUTH, op: "get" }));
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
      meta.ip = "198.51.100.4";
      expect((await PREFS(req({ endpoint: fcm(1), auth: AUTH, op: "get" }))).status).toBe(200);
    });
  });
});

describe("keeping follows in sync with the browser", () => {
  it("a subscription the server lost comes back with the follows the browser remembers", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa", "kofi"] });
    await db.delete(pushSubscriptions); // lost (cleanup, restore…)
    const res = await SUBSCRIBE(
      new Request("http://localhost:3000/api/push/subscription", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ endpoint: fcm(1), keys: { p256dh: P256DH, auth: AUTH }, prefs: { mode: "followed", follows: ["ama-sewaa", "kofi"] } }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).prefs).toEqual({
      mode: "followed",
      follows: [
        { slug: "ama-sewaa", penName: "Ama Sɛwaa" },
        { slug: "kofi", penName: "Kofi" },
      ],
    });
  });

  it("re-registering an existing row keeps the server's prefs (the remembered copy only fills a lost one)", async () => {
    await device(fcm(1), { mode: "followed", follows: ["kofi"] });
    const again = await saveSubscription({ endpoint: fcm(1), p256dh: P256DH, auth: AUTH }, { mode: "all", follows: [] });
    expect(again).toMatchObject({ ok: true, created: false, prefs: { mode: "followed", follows: [{ slug: "kofi" }] } });
  });

  it("a replaced subscription (pushsubscriptionchange) keeps the follows on its new address", async () => {
    await device(fcm(1), { mode: "followed", follows: ["kofi"] });
    // The worker posts the new address with the remembered prefs, then deletes the old one with its secret.
    expect(await device(fcm(2), { mode: "followed", follows: ["kofi"] })).toMatchObject({ created: true, prefs: { mode: "followed" } });
    expect(await deleteSubscription(own(fcm(1)))).toBe(true);
    expect(await announce(kofi)).toMatchObject({ sent: 1 });
    expect(sentTo()).toEqual([fcm(2)]);
  });
});

describe("cascades", () => {
  it("deleting an author removes their follows; removing a subscription removes its follows", async () => {
    await device(fcm(1), { mode: "followed", follows: ["ama-sewaa", "kofi"] });
    await device(fcm(2), { mode: "followed", follows: ["kofi"] });
    await db.delete(editors).where(eq(editors.id, kofi));
    expect(await changePrefs(own(fcm(1)), { op: "get" })).toEqual({ mode: "followed", follows: [{ slug: "ama-sewaa", penName: "Ama Sɛwaa" }] });
    expect(await db.select().from(pushFollows)).toHaveLength(1);
    await deleteSubscription(own(fcm(1)));
    expect(await db.select().from(pushFollows)).toHaveLength(0);
  });
});

describe("grouping a burst into one notification", () => {
  it("counts up, links to the author page, keeps one tag per author, and never carries text", async () => {
    await device(fcm(1));
    for (const t of ["One", "Two", "Three"]) await announce(ama, t);
    const p = lastPayloads();
    expect(p.map((x) => x.count)).toEqual([1, 2, 3]);
    expect(p.map((x) => x.url)).toEqual([expect.stringMatching(/^\/p\/ama-sewaa\//), "/a/ama-sewaa", "/a/ama-sewaa"]);
    expect(new Set(p.map((x) => x.tag))).toEqual(new Set([`author:${ama}`]));
    expect(p[2]).toStrictEqual({ title: "Three", author: "Ama Sɛwaa", url: "/a/ama-sewaa", tag: `author:${ama}`, count: 3 });
    for (const x of p) expect(JSON.stringify(x)).not.toContain("kerosene");
  });

  it("only the first alert per author counts toward the 3 a day; updates are capped separately", async () => {
    await device(fcm(1));
    await announce(ama, "A1");
    for (let i = 0; i < UPDATES_PER_WINDOW; i++) expect(await announce(ama, `A update ${i}`)).toMatchObject({ sent: 1, updates: 1 });
    expect(await announce(ama, "A over the cap")).toMatchObject({ sent: 0, limited: 1 });
    // Ama used one alert of three, however many updates followed.
    expect(await announce(kofi)).toMatchObject({ sent: 1, updates: 0 });
    expect(await announce(efua)).toMatchObject({ sent: 1, updates: 0 });
    expect(await announce(yaw)).toMatchObject({ sent: 0, limited: 1 }); // the 4th alert today
    // …but updates for authors already alerted still go out.
    expect(await announce(kofi, "Kofi 2")).toMatchObject({ sent: 1, updates: 1 });
    const kinds = (await db.execute(sql`SELECT kind, count(*)::int AS n FROM push_deliveries GROUP BY kind ORDER BY kind`)) as unknown as {
      rows: { kind: string; n: number }[];
    };
    expect(kinds.rows).toEqual([{ kind: "alert", n: 3 }, { kind: "update", n: UPDATES_PER_WINDOW + 1 }]);
  });

  it("a new window after 12 hours starts a new alert and a fresh update cap", async () => {
    await device(fcm(1));
    await announce(ama, "A1");
    await announce(ama, "A2");
    await db.execute(sql`UPDATE push_deliveries SET sent_at = sent_at - interval '12 hours'`);
    send.mockClear();
    await announce(ama, "B1");
    await announce(ama, "B2");
    expect(lastPayloads().map((x) => x.count)).toEqual([1, 2]);
  });

  it("Apple devices get the first alert only (Safari doesn't replace notifications by tag)", async () => {
    await device(fcm(1));
    await device(apple(2));
    await announce(ama, "One");
    send.mockClear();
    expect(await announce(ama, "Two")).toMatchObject({ sent: 1, updates: 1, limited: 1 });
    expect(sentTo()).toEqual([fcm(1)]);
  });

  it("concurrent publishes by one author: one alert, then updates with distinct counts, all claimed atomically", async () => {
    for (let i = 1; i <= 3; i++) await device(fcm(i));
    const poems = [];
    for (const t of ["P1", "P2", "P3", "P4"]) {
      const r = await createPoem(ama, input({ title: t }));
      if (!r.ok) throw new Error();
      poems.push(r.poem.id);
    }
    const results = await Promise.all(poems.map((id) => announcePoem(id)));
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(12);
    expect(results.reduce((n, r) => n + r.updates, 0)).toBe(9);
    const perDevice = new Map<string, number[]>();
    for (const c of send.mock.calls) {
      const e = (c[0] as { endpoint: string }).endpoint;
      perDevice.set(e, [...(perDevice.get(e) ?? []), (JSON.parse(c[1] as string) as { count: number }).count]);
    }
    for (const counts of perDevice.values()) expect(counts.sort()).toEqual([1, 2, 3, 4]);
    const alerts = (await db.execute(sql`SELECT count(*)::int AS n FROM push_deliveries WHERE kind = 'alert'`)) as unknown as { rows: { n: number }[] };
    expect(alerts.rows[0].n).toBe(3);
  });

  it("concurrent bursts can't pass the update cap", async () => {
    await device(fcm(1));
    await announce(ama, "First");
    const ids = [];
    for (let i = 0; i < UPDATES_PER_WINDOW + 3; i++) {
      const r = await createPoem(ama, input({ title: `Burst ${i}` }));
      if (!r.ok) throw new Error();
      ids.push(r.poem.id);
    }
    const results = await Promise.all(ids.map((id) => announcePoem(id)));
    expect(results.reduce((n, r) => n + r.updates, 0)).toBe(UPDATES_PER_WINDOW);
    expect(results.reduce((n, r) => n + r.limited, 0)).toBe(3);
    expect(await db.select().from(pushDeliveries)).toHaveLength(UPDATES_PER_WINDOW + 1);
  });
});
