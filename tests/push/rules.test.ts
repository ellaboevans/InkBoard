import { afterEach, describe, expect, it } from "vitest";
import webpush from "web-push";
import { env, resetEnvCache } from "@/env";
import {
  isAllowedPushEndpoint,
  isUsableVapidSubject,
  newPoemPayload,
  parseEndpoint,
  parsePushSubscription,
  pushOutcome,
  pushTopic,
  resolveVapidSubject,
} from "@/lib/push-rules";

// Real key material, as a browser sends it.
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const sub = (endpoint: string, keys: Record<string, unknown> = { p256dh: P256DH, auth: AUTH }) => ({
  endpoint,
  expirationTime: null,
  keys,
});

describe("push endpoints: only known push services", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/dP58-HKhsxk:APA91bEoVcly",
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://api.push.apple.com/3/device/x",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
  ])("accepts %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    ["plain http", "http://fcm.googleapis.com/fcm/send/x"],
    ["another host", "https://evil.example.com/fcm/send/x"],
    ["a look-alike suffix", "https://fcm.googleapis.com.evil.example/x"],
    ["a look-alike prefix", "https://evilpush.apple.com.attacker.net/x"],
    ["the bare suffix", "https://.notify.windows.com/x"],
    ["credentials", "https://user:pw@fcm.googleapis.com/fcm/send/x"],
    ["a port", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["our own site", "https://inkboard.example.org/api/x"],
    ["localhost", "https://localhost/x"],
    ["not a URL", "fcm.googleapis.com/fcm/send/x"],
    ["too long", `https://fcm.googleapis.com/fcm/send/${"a".repeat(1100)}`],
  ])("refuses %s", (_, url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});

describe("subscriptions: strict shape", () => {
  it("keeps exactly endpoint and the two keys", () => {
    expect(parsePushSubscription(sub("https://fcm.googleapis.com/fcm/send/x"))).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      p256dh: P256DH,
      auth: AUTH,
    });
  });

  it("accepts padded base64url keys and stores them unpadded", () => {
    expect(parsePushSubscription(sub("https://fcm.googleapis.com/fcm/send/x", { p256dh: `${P256DH}=`, auth: `${AUTH}==` })))
      .toMatchObject({ p256dh: P256DH, auth: AUTH });
  });

  it.each([
    ["no keys", { endpoint: "https://fcm.googleapis.com/fcm/send/x" }],
    ["a short public key", sub("https://fcm.googleapis.com/fcm/send/x", { p256dh: P256DH.slice(0, 80), auth: AUTH })],
    ["a long auth secret", sub("https://fcm.googleapis.com/fcm/send/x", { p256dh: P256DH, auth: `${AUTH}AAAA` })],
    ["non-base64url keys", sub("https://fcm.googleapis.com/fcm/send/x", { p256dh: P256DH.replace("B", "+"), auth: AUTH })],
    ["keys that aren't strings", sub("https://fcm.googleapis.com/fcm/send/x", { p256dh: 1, auth: AUTH })],
    ["a disallowed endpoint", sub("https://example.org/push")],
    ["null", null],
    ["a string", "https://fcm.googleapis.com/fcm/send/x"],
  ])("refuses %s", (_, input) => {
    expect(parsePushSubscription(input)).toBeNull();
  });

  it("unsubscribing takes just an allowlisted endpoint", () => {
    expect(parseEndpoint({ endpoint: "https://fcm.googleapis.com/fcm/send/x" })).toBe("https://fcm.googleapis.com/fcm/send/x");
    expect(parseEndpoint({ endpoint: "https://example.org/x" })).toBeNull();
    expect(parseEndpoint({})).toBeNull();
  });
});

describe("the VAPID subject: a real https URL or mailto", () => {
  it.each(["https://inkboard.app", "https://poems.example.org", "mailto:owner@inkboard.app", "mailto:poems@example.com"])(
    "accepts %s",
    (s) => expect(isUsableVapidSubject(s)).toBe(true),
  );

  it.each([
    "https://localhost",
    "https://localhost:3000",
    "http://inkboard.app",
    "https://127.0.0.1",
    "https://[::1]",
    "https://intranet",
    "https://inkboard.test",
    "https://inkboard.localhost",
    "mailto:push@inkboard.invalid",
    "mailto:me@localhost",
    "mailto:not-an-address",
    "inkboard.app",
    "",
  ])("refuses %s (Apple answers BadJwtToken)", (s) => {
    expect(isUsableVapidSubject(s)).toBe(false);
  });

  it("defaults to the site's URL when that is a public https origin", () => {
    expect(resolveVapidSubject(undefined, new URL("https://inkboard.app/some/path"))).toBe("https://inkboard.app");
    expect(resolveVapidSubject(undefined, new URL("http://localhost:3000"))).toBeNull();
    expect(resolveVapidSubject("mailto:owner@inkboard.app", new URL("http://localhost:3000"))).toBe("mailto:owner@inkboard.app");
    expect(resolveVapidSubject("https://localhost", new URL("https://inkboard.app"))).toBeNull();
  });
});

describe("env: VAPID settings", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });
  const keys = webpush.generateVAPIDKeys();
  function load(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
    return () => env();
  }

  it("is optional: no keys, no notifications", () => {
    expect(load({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined })().VAPID_PUBLIC_KEY).toBe("");
  });

  it("needs both keys, as web-push makes them", () => {
    expect(load({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: undefined })).toThrow(/must both be set/);
    expect(load({ VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: keys.privateKey })).toThrow(/must both be set/);
  });

  it("fails clearly when the subject would be localhost", () => {
    expect(
      load({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: undefined, APP_URL: "http://localhost:3000" }),
    ).toThrow(/VAPID_SUBJECT is required/);
    expect(
      load({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:x@inkboard.invalid" }),
    ).toThrow(/VAPID_SUBJECT must be an https URL or a mailto/);
  });

  it("defaults the subject to a public https site URL", () => {
    expect(
      load({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: undefined, APP_URL: "https://inkboard.app" })()
        .VAPID_SUBJECT,
    ).toBe("");
  });
});

describe("the payload", () => {
  it("has exactly title, author, url and tag: never poem text", () => {
    const p = newPoemPayload({
      poemId: "01859f03-6106-449e-be49-6097a0618d11",
      title: "Night Market",
      penName: "Ama Owusu",
      authorSlug: "ama-owusu",
      poemSlug: "night-market",
    });
    expect(p).toStrictEqual({
      title: "Night Market",
      author: "Ama Owusu",
      url: "/p/ama-owusu/night-market",
      tag: "poem:01859f03-6106-449e-be49-6097a0618d11",
    });
    expect(Object.keys(JSON.parse(JSON.stringify(p))).sort()).toEqual(["author", "tag", "title", "url"]);
  });

  it("uses a Topic of at most 32 URL-safe characters", () => {
    const t = pushTopic("01859f03-6106-449e-be49-6097a0618d11");
    expect(t).toBe("01859f036106449ebe496097a0618d11");
    expect(t.length).toBeLessThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("classifies push service answers", () => {
    expect([201, 200, 202].map(pushOutcome)).toEqual(["sent", "sent", "sent"]);
    expect([404, 410].map(pushOutcome)).toEqual(["gone", "gone"]);
    expect([429, 500, 503, 0].map(pushOutcome)).toEqual(["retry", "retry", "retry", "retry"]);
    expect([400, 403, 413].map(pushOutcome)).toEqual(["error", "error", "error"]);
  });
});
