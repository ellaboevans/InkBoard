import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { setPenName } from "@/server/auth/profile";
import { sendWelcomeOnce } from "@/server/welcome";
import { welcomes } from "../support/outbox";

const db = getDb();
async function newcomer(email = "new@example.com") {
  const [e] = await db.insert(editors).values({ email }).returning();
  return e;
}

describe("welcome email", () => {
  it("is sent once, after onboarding, with the pen name and author slug", async () => {
    const e = await newcomer();
    await setPenName(e.id, "Ada Verse");
    expect(await sendWelcomeOnce(e.id)).toBe(true);
    expect(welcomes).toEqual([{ to: "new@example.com", penName: "Ada Verse", slug: "ada-verse" }]);
    // Resubmitting onboarding (back button, double click) doesn't send another.
    await setPenName(e.id, "Ada Verse");
    expect(await sendWelcomeOnce(e.id)).toBe(false);
    expect(welcomes).toHaveLength(1);
  });

  it("is sent once even when onboarding is submitted twice at the same time", async () => {
    const e = await newcomer();
    await setPenName(e.id, "Ada Verse");
    const results = await Promise.all([sendWelcomeOnce(e.id), sendWelcomeOnce(e.id), sendWelcomeOnce(e.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(welcomes).toHaveLength(1);
  });

  it("isn't sent before onboarding (no pen name yet)", async () => {
    const e = await newcomer();
    expect(await sendWelcomeOnce(e.id)).toBe(false);
    expect(welcomes).toEqual([]);
    // ...and isn't used up: it still goes out once they onboard.
    await setPenName(e.id, "Ada Verse");
    expect(await sendWelcomeOnce(e.id)).toBe(true);
  });

  it("isn't sent to editors already marked welcomed (those who onboarded before it existed)", async () => {
    const [e] = await db
      .insert(editors)
      .values({ email: "old@example.com", penName: "Old Hand", slug: "old-hand", welcomedAt: new Date() })
      .returning();
    expect(await sendWelcomeOnce(e.id)).toBe(false);
    expect(welcomes).toEqual([]);
  });

  it("is per editor", async () => {
    const a = await newcomer("a@example.com");
    const b = await newcomer("b@example.com");
    await setPenName(a.id, "Rumi");
    await setPenName(b.id, "Rumi");
    await sendWelcomeOnce(a.id);
    await sendWelcomeOnce(b.id);
    expect(welcomes.map((w) => [w.to, w.slug])).toEqual([["a@example.com", "rumi"], ["b@example.com", "rumi-2"]]);
    const [row] = await db.select().from(editors).where(eq(editors.id, a.id));
    expect(row.welcomedAt).toBeInstanceOf(Date);
  });
});
