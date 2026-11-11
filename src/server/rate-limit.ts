import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
};

/**
 * Fixed-window counter stored in Postgres. One atomic upsert per call, so it is
 * safe under concurrency and works on serverless without extra infrastructure.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  // Both drivers (pg, Neon) return a pg-style QueryResult.
  const result = (await getDb().execute(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.window_start <= now() - make_interval(secs => ${windowSeconds})
        THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE
        WHEN rate_limits.window_start <= now() - make_interval(secs => ${windowSeconds})
        THEN now() ELSE rate_limits.window_start END
    RETURNING
      count,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM
        (window_start + make_interval(secs => ${windowSeconds})) - now()
      )))::int AS reset_in
  `)) as unknown as { rows: { count: number | string; reset_in: number | string }[] };
  const row = result.rows[0];
  // Opportunistic cleanup so spoofed/one-off keys don't accumulate forever.
  // (Longest window in use is 1 day.)
  if (Math.random() < 0.01) void pruneRateLimits().catch(() => {});
  const count = Number(row.count);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Number(row.reset_in),
  };
}

export async function pruneRateLimits(): Promise<void> {
  await getDb().execute(
    sql`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`,
  );
}
