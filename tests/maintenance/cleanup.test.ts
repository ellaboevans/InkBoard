import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, emailOtps, rateLimits, sessions, signInDevices, signInLocations, stepUpCodes, webauthnChallenges } from "@/db/schema";
import { cleanupExpiredRows, isAuthorizedCron } from "@/server/maintenance";

const db = getDb();
const ago = (interval: string) => sql`now() - ${sql.raw(`interval '${interval}'`)}`;
const ahead = (interval: string) => sql`now() + ${sql.raw(`interval '${interval}'`)}`;

describe("cleanupExpiredRows", () => {
  it("deletes only rows past their grace period", async () => {
    const [ed] = await db.insert(editors).values({ email: "c@x.com" }).returning();
    await db.insert(emailOtps).values([
      { email: "a@x.com", codeHash: "old-expired", expiresAt: ago("2 days") },
      { email: "a@x.com", codeHash: "old-used", expiresAt: ahead("5 minutes"), consumedAt: ago("2 days") },
      { email: "a@x.com", codeHash: "just-expired", expiresAt: ago("1 hour") },
      { email: "a@x.com", codeHash: "live", expiresAt: ahead("5 minutes") },
    ]);
    await db.insert(sessions).values([
      { editorId: ed.id, tokenHash: "old", expiresAt: ago("3 days") },
      { editorId: ed.id, tokenHash: "recent", expiresAt: ago("1 hour") },
      { editorId: ed.id, tokenHash: "live", expiresAt: ahead("30 days") },
    ]);
    const [live] = await db.select().from(sessions).where(sql`token_hash = 'live'`);
    await db.insert(stepUpCodes).values([
      { sessionId: live.id, codeHash: "old-expired", expiresAt: ago("2 days") },
      { sessionId: live.id, codeHash: "old-used", expiresAt: ahead("5 minutes"), consumedAt: ago("2 days") },
      { sessionId: live.id, codeHash: "live", expiresAt: ahead("5 minutes") },
    ]);
    await db.insert(webauthnChallenges).values([
      { tokenHash: "expired", purpose: "authentication", challenge: "c1", expiresAt: ago("1 minute") },
      { tokenHash: "live", purpose: "authentication", challenge: "c2", expiresAt: ahead("4 minutes") },
    ]);
    await db.insert(rateLimits).values([
      { key: "old", windowStart: ago("3 days"), count: 1 },
      { key: "today", windowStart: ago("1 hour"), count: 1 },
    ]);
    await db.insert(signInLocations).values([
      { editorId: ed.id, ipKey: "stale", lastSeenAt: ago("13 months") },
      { editorId: ed.id, ipKey: "recent", lastSeenAt: ago("11 months") },
    ]);
    await db.insert(signInDevices).values([
      { editorId: ed.id, deviceKey: "stale", lastSeenAt: ago("13 months") },
      { editorId: ed.id, deviceKey: "recent", lastSeenAt: ago("11 months") },
    ]);

    expect(await cleanupExpiredRows()).toEqual({ otps: 2, stepUpCodes: 2, webauthnChallenges: 1, sessions: 1, rateLimits: 1, signInLocations: 1, signInDevices: 1, pushSubscriptions: 0, pushDeliveries: 0 });
    expect((await db.select().from(stepUpCodes)).map((r) => r.codeHash)).toEqual(["live"]);
    expect((await db.select().from(webauthnChallenges)).map((r) => r.tokenHash)).toEqual(["live"]);
    expect((await db.select().from(emailOtps)).map((r) => r.codeHash).sort()).toEqual(["just-expired", "live"]);
    expect((await db.select().from(sessions)).map((r) => r.tokenHash).sort()).toEqual(["live", "recent"]);
    expect((await db.select().from(rateLimits)).map((r) => r.key)).toEqual(["today"]);
    expect((await db.select().from(signInLocations)).map((r) => r.ipKey)).toEqual(["recent"]);
    expect((await db.select().from(signInDevices)).map((r) => r.deviceKey)).toEqual(["recent"]);
    expect(await cleanupExpiredRows()).toEqual({ otps: 0, stepUpCodes: 0, webauthnChallenges: 0, sessions: 0, rateLimits: 0, signInLocations: 0, signInDevices: 0, pushSubscriptions: 0, pushDeliveries: 0 });
  });
});

describe("isAuthorizedCron", () => {
  const secret = "s".repeat(40);
  it("accepts only the exact bearer token", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCron(secret, secret)).toBe(false);
    expect(isAuthorizedCron(null, secret)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
  });
});
