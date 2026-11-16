import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { DELETE, POST } from "@/app/api/push/subscription/route";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { resetEnvCache } from "@/env";

// The route reads the client IP through the DAL (headers()); give it one.
const meta = vi.hoisted(() => ({ ip: "203.0.113.7" as string | null }));
vi.mock("@/server/auth/dal", () => ({
  getRequestMeta: async () => ({ ip: meta.ip, userAgent: "test" }),
}));

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
beforeEach(() => {
  meta.ip = "203.0.113.7";
});

const ORIGIN = "http://localhost:3000";
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc:APA91b";
const body = (endpoint = ENDPOINT) => ({ endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } });
const req = (method: string, data: unknown, origin: string | null = ORIGIN) =>
  new Request("http://localhost:3000/api/push/subscription", {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof data === "string" ? data : JSON.stringify(data),
  });

describe("POST/DELETE /api/push/subscription", () => {
  it("stores a subscription (201), re-registers it (200) and deletes it", async () => {
    expect((await POST(req("POST", body()))).status).toBe(201);
    expect((await POST(req("POST", body()))).status).toBe(200);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
    expect((await DELETE(req("DELETE", { endpoint: ENDPOINT }))).status).toBe(200);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("refuses endpoints outside the push-service allowlist, bad keys and junk", async () => {
    for (const bad of [
      body("https://attacker.example.net/collect"),
      body("http://fcm.googleapis.com/fcm/send/x"),
      { ...body(), keys: { p256dh: "short", auth: AUTH } },
      "not json",
      {},
    ]) {
      expect((await POST(req("POST", bad))).status).toBe(400);
    }
    expect((await DELETE(req("DELETE", { endpoint: "https://attacker.example.net/x" }))).status).toBe(400);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("refuses large bodies", async () => {
    const big = { ...body(), padding: "x".repeat(4000) };
    expect((await POST(req("POST", big))).status).toBe(400);
  });

  it("refuses other origins", async () => {
    expect((await POST(req("POST", body(), "https://evil.example.com"))).status).toBe(403);
    expect((await DELETE(req("DELETE", { endpoint: ENDPOINT }, "https://evil.example.com"))).status).toBe(403);
  });

  it("is rate-limited per IP bucket (IPv6 grouped by /64)", async () => {
    meta.ip = "2001:db8:1:2::1";
    for (let i = 0; i < 30; i++) expect((await POST(req("POST", body(`${ENDPOINT}${i}`)))).status).toBe(201);
    meta.ip = "2001:db8:1:2::ffff"; // same /64
    const res = await POST(req("POST", body(`${ENDPOINT}x`)));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    meta.ip = "198.51.100.1"; // another client is fine
    expect((await POST(req("POST", body(`${ENDPOINT}y`)))).status).toBe(201);
  });

  it("answers 404 when notifications aren't configured", async () => {
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VAPID_PRIVATE_KEY = "";
    resetEnvCache();
    try {
      expect((await POST(req("POST", body()))).status).toBe(404);
    } finally {
      process.env = { ...process.env, ...{ VAPID_PUBLIC_KEY: saved.VAPID_PUBLIC_KEY } };
      const keys = webpush.generateVAPIDKeys();
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
      process.env.VAPID_PRIVATE_KEY = keys.privateKey;
      resetEnvCache();
    }
  });
});
