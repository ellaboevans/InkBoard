import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { rateLimit } from "@/server/rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit, then blocks", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("k", 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3].retryAfter).toBeGreaterThan(0);
    expect(results[3].retryAfter).toBeLessThanOrEqual(60);
  });

  it("is atomic under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit("burst", 5, 60)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("resets after the window passes", async () => {
    await rateLimit("w", 1, 60);
    expect((await rateLimit("w", 1, 60)).allowed).toBe(false);
    await getDb().execute(
      sql`UPDATE rate_limits SET window_start = now() - interval '61 seconds'`,
    );
    expect((await rateLimit("w", 1, 60)).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    await rateLimit("a", 1, 60);
    expect((await rateLimit("b", 1, 60)).allowed).toBe(true);
  });
});
