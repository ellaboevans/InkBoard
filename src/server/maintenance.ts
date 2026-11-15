import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { safeEqual, sha256 } from "./crypto";

/*
 * Periodic cleanup of rows that are useless once expired (Phase 6). Runs
 * daily from /api/cron/cleanup. All cut-offs leave a grace period, so
 * nothing that could still matter (audit, a just-expired retry) vanishes
 * the instant it expires.
 */

export type CleanupResult = {
  otps: number;
  stepUpCodes: number;
  sessions: number;
  rateLimits: number;
  signInLocations: number;
  signInDevices: number;
};

export async function cleanupExpiredRows(): Promise<CleanupResult> {
  const db = getDb();
  const count = (r: unknown) => (r as { rowCount?: number | null }).rowCount ?? 0;

  // Sign-in codes: expired or used more than a day ago.
  const otps = await db.execute(sql`
    DELETE FROM email_otps
    WHERE expires_at < now() - interval '1 day'
       OR consumed_at < now() - interval '1 day'
  `);
  // Step-up confirmation codes (Phase 16): same rule as sign-in codes. (They
  // also go with their session. Recovery codes don't expire: a new set
  // replaces the old one, so they never pile up.)
  const stepUpCodes = await db.execute(sql`
    DELETE FROM step_up_codes
    WHERE expires_at < now() - interval '1 day'
       OR consumed_at < now() - interval '1 day'
  `);
  // Sessions: past their (fixed) expiry by more than a day.
  const sessions = await db.execute(sql`
    DELETE FROM sessions WHERE expires_at < now() - interval '1 day'
  `);
  // Rate-limit windows: the longest window in use is 1 day.
  const rateLimits = await db.execute(sql`
    DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'
  `);
  // Known sign-in networks: forget ones unused for a year (a sign-in from one
  // again then counts as new, which errs on the side of telling the editor).
  const signInLocations = await db.execute(sql`
    DELETE FROM sign_in_locations WHERE last_seen_at < now() - interval '1 year'
  `);
  // Known browsers: same rule. (The device cookie itself lasts two years.)
  const signInDevices = await db.execute(sql`
    DELETE FROM sign_in_devices WHERE last_seen_at < now() - interval '1 year'
  `);
  return {
    otps: count(otps),
    stepUpCodes: count(stepUpCodes),
    sessions: count(sessions),
    rateLimits: count(rateLimits),
    signInLocations: count(signInLocations),
    signInDevices: count(signInDevices),
  };
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Compare hashes in
 * constant time (equal length) so the secret can't be probed by timing.
 */
export function isAuthorizedCron(header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  return safeEqual(sha256(header), sha256(`Bearer ${secret}`));
}
