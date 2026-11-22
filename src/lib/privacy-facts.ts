/**
 * Every period and number the Privacy page (src/app/privacy/page.tsx) states,
 * written the way the page says it. The page renders these and writes no
 * durations of its own; tests/privacy/privacy-facts.test.ts checks each one
 * against the constant in the code it describes, and fails if they drift.
 *
 * So when one of those constants changes, this file (and the page's
 * "Updated" date) must change with it: read the sentence around it again.
 */
export const PRIVACY_FACTS = {
  /** OTP_TTL_SECONDS (src/server/auth/otp-config.ts) */
  signInCodeLife: "10 minutes",
  /** STEP_UP_TTL_SECONDS (src/server/auth/step-up-config.ts) */
  stepUpCodeLife: "10 minutes",
  /** CLEANUP_DAYS.usedOrExpiredCodes (src/server/maintenance.ts) */
  usedCodeCleanup: "a day",
  /** SESSION_TTL_SECONDS (src/server/auth/sessions.ts) */
  sessionLife: "30 days",
  /** PUBLIC_SESSION_TTL_SECONDS (src/server/auth/sessions.ts) */
  publicSessionLife: "12 hours",
  /** CLEANUP_DAYS.expiredSessions (src/server/maintenance.ts) */
  expiredSessionCleanup: "a day",
  /** DEVICE_COOKIE_MAX_AGE (src/server/auth/cookie.ts) */
  deviceCookieLife: "two years",
  /** CLEANUP_DAYS.unusedSignInMemory (src/server/maintenance.ts) */
  signInMemory: "a year",
  /** PASSKEY_CHALLENGE_TTL_SECONDS (src/server/auth/passkeys.ts) */
  passkeyChallengeLife: "5 minutes",
  /** UNLOCK_TTL_SECONDS (src/server/unlock.ts) */
  unlockLife: "12 hours",
  /** CLEANUP_DAYS.rateLimitWindows (src/server/maintenance.ts) */
  rateLimitCleanup: "two days",
  /** SHARE_VISIT_WINDOW_SECONDS (src/lib/share-image/visits.ts): one visit per network per poem in this long. */
  shareVisitRepeat: "a day",
  /** CLEANUP_DAYS.pushDeliveries (src/server/maintenance.ts) */
  pushDeliveryCleanup: "two days",
  /** CLEANUP_DAYS.reports (src/server/maintenance.ts): readers' reports are deleted this long after they were made. */
  reportCleanup: "90 days",
  /** UNUSED_SUBSCRIPTION_DAYS (src/lib/push-rules.ts) */
  unusedSubscription: "90 days",
  /** PHOTO_CACHE_SECONDS (src/lib/photo-limits.ts): how long a browser may keep a served photo. */
  photoCacheLife: "an hour",
  /** PHOTO_ORPHAN_GRACE_HOURS (src/server/profile-photos.ts): unlinked photo files older than this go in the daily clean-up. */
  photoOrphanCleanup: "6 hours",
  /** COVER_CACHE_SECONDS (src/lib/photo-limits.ts): how long a browser may keep a served novel cover (Phase 25). */
  coverCacheLife: "an hour",
  /** COVER_ORPHAN_GRACE_HOURS (src/server/novel-covers.ts): unlinked cover files older than this go in the daily clean-up. */
  coverOrphanCleanup: "6 hours",
  /** REVISIONS_KEPT (src/server/poem-history.ts) */
  revisionsKept: "20",
  /** CHAPTER_REVISIONS_KEPT (src/lib/novel-limits.ts): versions kept per chapter, the current one included. */
  chapterVersionsKept: "10",
  /** READING_PLACES_MAX (src/lib/reading-place.ts): novels whose place a browser remembers. */
  readingPlacesKept: "50",
  /** FOLLOWER_THRESHOLD (src/lib/writer-stats.ts): below this many following devices a writer's stats say "fewer than". */
  followerThreshold: "3",
  /** RECOVERY_CODES_PER_SET (src/lib/recovery-code-format.ts) */
  recoveryCodesPerSet: "10",
} as const;

/** The date at the top of the Privacy page: change it whenever the page's facts change. */
export const PRIVACY_UPDATED = "2026-11-22";

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
const UNIT_SECONDS: Record<string, number> = { minute: 60, hour: 3600, day: 86400, year: 365 * 86400 };

/** "10 minutes" → 600, "a year" → 31536000, "two days" → 172800 (the forms PRIVACY_FACTS uses). */
export function periodSeconds(phrase: string): number {
  const m = /^(\d+|a|an|one|two|three) (minute|hour|day|year)s?$/.exec(phrase);
  if (!m) throw new Error(`Not a period: ${JSON.stringify(phrase)}`);
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
  return n * UNIT_SECONDS[m[2]];
}
