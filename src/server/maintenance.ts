import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { UNUSED_SUBSCRIPTION_DAYS } from "@/lib/push-rules";
import { safeEqual, sha256 } from "./crypto";
import { sweepOrphanCovers } from "./novel-covers";
import { describeStorageError, sweepOrphanPhotos } from "./profile-photos";

/*
 * Periodic cleanup of rows that are useless once expired (Phase 6). Runs
 * daily from /api/cron/cleanup. All cut-offs leave a grace period, so
 * nothing that could still matter (audit, a just-expired retry) vanishes
 * the instant it expires.
 */

/**
 * Grace periods, in days, before the daily cleanup deletes each kind of row.
 * The Privacy page states them (src/lib/privacy-facts.ts); a test fails if
 * the two drift apart, so change both together.
 */
export const CLEANUP_DAYS = {
  /** Sign-in and step-up codes, after they expire or are used. */
  usedOrExpiredCodes: 1,
  /** Sessions, after their fixed expiry. */
  expiredSessions: 1,
  /** Rate-limit counters, after their window started (the longest window is 1 day). */
  rateLimitWindows: 2,
  /** Known sign-in networks and browsers, after they were last seen. */
  unusedSignInMemory: 365,
  /** Notification delivery records (the longest limit window is 24 hours). */
  pushDeliveries: 2,
} as const;

const days = (n: number) => sql`make_interval(days => ${n})`;

export type CleanupResult = {
  otps: number;
  stepUpCodes: number;
  webauthnChallenges: number;
  sessions: number;
  rateLimits: number;
  signInLocations: number;
  signInDevices: number;
  pushSubscriptions: number;
  pushDeliveries: number;
  /** Profile photos whose files no editor points at (Phase 22); null when photo storage isn't available. */
  orphanPhotos: number | null;
  /** Novel covers' files no novel points at (Phase 25); null when storage isn't available. */
  orphanCovers: number | null;
};

export async function cleanupExpiredRows(): Promise<CleanupResult> {
  const db = getDb();
  const count = (r: unknown) => (r as { rowCount?: number | null }).rowCount ?? 0;

  // Sign-in codes: expired or used more than a day ago.
  const otps = await db.execute(sql`
    DELETE FROM email_otps
    WHERE expires_at < now() - ${days(CLEANUP_DAYS.usedOrExpiredCodes)}
       OR consumed_at < now() - ${days(CLEANUP_DAYS.usedOrExpiredCodes)}
  `);
  // Step-up confirmation codes (Phase 16): same rule as sign-in codes. (They
  // also go with their session. Recovery codes don't expire: a new set
  // replaces the old one, so they never pile up.)
  const stepUpCodes = await db.execute(sql`
    DELETE FROM step_up_codes
    WHERE expires_at < now() - ${days(CLEANUP_DAYS.usedOrExpiredCodes)}
       OR consumed_at < now() - ${days(CLEANUP_DAYS.usedOrExpiredCodes)}
  `);
  // WebAuthn challenges (Phase 16 round 2): used ones are already deleted;
  // these are the ones nobody finished. Expired is useless, so no grace.
  const webauthnChallenges = await db.execute(sql`
    DELETE FROM webauthn_challenges WHERE expires_at < now()
  `);
  // Sessions: past their (fixed) expiry by more than a day.
  const sessions = await db.execute(sql`
    DELETE FROM sessions WHERE expires_at < now() - ${days(CLEANUP_DAYS.expiredSessions)}
  `);
  // Rate-limit windows: the longest window in use is 1 day.
  const rateLimits = await db.execute(sql`
    DELETE FROM rate_limits WHERE window_start < now() - ${days(CLEANUP_DAYS.rateLimitWindows)}
  `);
  // Known sign-in networks: forget ones unused for a year (a sign-in from one
  // again then counts as new, which errs on the side of telling the editor).
  const signInLocations = await db.execute(sql`
    DELETE FROM sign_in_locations WHERE last_seen_at < now() - ${days(CLEANUP_DAYS.unusedSignInMemory)}
  `);
  // Known browsers: same rule. (The device cookie itself lasts two years.)
  const signInDevices = await db.execute(sql`
    DELETE FROM sign_in_devices WHERE last_seen_at < now() - ${days(CLEANUP_DAYS.unusedSignInMemory)}
  `);
  // Notification addresses (Phase 18) we haven't been able to use for 90
  // days: we tried since the last success (or since it was made) and nothing
  // has succeeded in 90 days. A device we simply had nothing to send to stays.
  const pushSubscriptions = await db.execute(sql`
    DELETE FROM push_subscriptions WHERE id IN (
      -- Locked in id order, like every multi-row write on push_subscriptions (claimDeliveries,
      -- sendAll in push.ts), so the cleanup can't deadlock with an announcement.
      SELECT id FROM push_subscriptions
      WHERE COALESCE(last_success_at, created_at) < now() - make_interval(days => ${UNUSED_SUBSCRIPTION_DAYS})
        AND last_attempt_at IS NOT NULL
        AND last_attempt_at > COALESCE(last_success_at, created_at)
      ORDER BY id FOR UPDATE
    )
  `);
  // What the limits count: the longest window is 24 hours.
  const pushDeliveries = await db.execute(sql`
    DELETE FROM push_deliveries WHERE sent_at < now() - ${days(CLEANUP_DAYS.pushDeliveries)}
  `);
  // Profile photo files no editor points at (a failed or interrupted save, a
  // failed delete), once PHOTO_ORPHAN_GRACE_HOURS old so an upload in progress
  // is never touched. Storage trouble mustn't stop the rest of the cleanup.
  let orphanPhotos: number | null = null;
  try {
    orphanPhotos = await sweepOrphanPhotos();
  } catch (err) {
    console.error("[cron] photo sweep failed", describeStorageError(err));
  }
  // The same for uploaded novel covers (covers/), with the same grace period.
  let orphanCovers: number | null = null;
  try {
    orphanCovers = await sweepOrphanCovers();
  } catch (err) {
    console.error("[cron] cover sweep failed", describeStorageError(err));
  }
  return {
    otps: count(otps),
    stepUpCodes: count(stepUpCodes),
    webauthnChallenges: count(webauthnChallenges),
    sessions: count(sessions),
    rateLimits: count(rateLimits),
    signInLocations: count(signInLocations),
    signInDevices: count(signInDevices),
    pushSubscriptions: count(pushSubscriptions),
    pushDeliveries: count(pushDeliveries),
    orphanPhotos,
    orphanCovers,
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
