import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, signInLocations } from "@/db/schema";
import { notifyIfNewSignIn, recordSignInLocation } from "@/server/auth/sign-in-alerts";
import { alerts } from "../support/outbox";

const db = getDb();
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function editor(email = "poet@example.com") {
  const [e] = await db.insert(editors).values({ email, penName: "Ada", slug: email.split("@")[0] }).returning();
  return e;
}
const signIn = (e: { id: string; email: string; penName: string | null }, ip: string | null, userAgent = UA) =>
  notifyIfNewSignIn({ editorId: e.id, email: e.email, penName: e.penName, ip, userAgent });

describe("new sign-in alerts", () => {
  it("stays quiet on the first sign-in and on known networks", async () => {
    const e = await editor();
    expect(await signIn(e, "203.0.113.5")).toBe("first");
    expect(await signIn(e, "203.0.113.5")).toBe("known");
    expect(alerts).toEqual([]);
  });

  it("emails the editor when a new network signs in", async () => {
    const e = await editor();
    await signIn(e, "203.0.113.5");
    expect(await signIn(e, "198.51.100.7")).toBe("new");
    expect(alerts).toEqual([{ to: "poet@example.com", device: "Chrome on macOS", ip: "198.51.100.7", penName: "Ada" }]);
    // That network is now known.
    expect(await signIn(e, "198.51.100.7")).toBe("known");
    expect(alerts).toHaveLength(1);
  });

  it("treats one IPv6 /64 as one network", async () => {
    const e = await editor();
    await signIn(e, "2001:db8:1:2::10");
    expect(await signIn(e, "2001:db8:1:2:abcd::99")).toBe("known");
    expect(await signIn(e, "2001:db8:1:3::10")).toBe("new");
  });

  it("does nothing without a client IP", async () => {
    const e = await editor();
    await signIn(e, "203.0.113.5");
    expect(await signIn(e, null)).toBe("unknown");
    expect(alerts).toEqual([]);
  });

  it("keeps networks per editor", async () => {
    const a = await editor("a@example.com");
    const b = await editor("b@example.com");
    await signIn(a, "203.0.113.5");
    expect(await recordSignInLocation(b.id, "203.0.113.5")).toBe("first");
  });

  it("stores only a keyed hash, never the IP", async () => {
    const e = await editor();
    await signIn(e, "203.0.113.5");
    const rows = await db.select().from(signInLocations);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
    expect(rows[0].ipKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("caps alerts at 5 per editor per day", async () => {
    const e = await editor();
    await signIn(e, "10.0.0.1");
    for (let i = 2; i <= 8; i++) expect(await signIn(e, `10.0.0.${i}`)).toBe("new");
    expect(alerts).toHaveLength(5);
  });
});
