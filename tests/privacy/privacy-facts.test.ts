import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECOVERY_CODES_PER_SET } from "@/lib/recovery-code-format";
import { PRIVACY_FACTS, PRIVACY_UPDATED, periodSeconds } from "@/lib/privacy-facts";
import { UNUSED_SUBSCRIPTION_DAYS } from "@/lib/push-rules";
import { PRIVACY_CONTACT_EMAIL } from "@/lib/site";
import { DEVICE_COOKIE_MAX_AGE } from "@/server/auth/cookie";
import { OTP_TTL_SECONDS } from "@/server/auth/otp-config";
import { PASSKEY_CHALLENGE_TTL_SECONDS } from "@/server/auth/passkeys";
import { PUBLIC_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS } from "@/server/auth/sessions";
import { STEP_UP_TTL_SECONDS } from "@/server/auth/step-up-config";
import { CLEANUP_DAYS } from "@/server/maintenance";
import { REVISIONS_KEPT } from "@/server/poem-history";
import { UNLOCK_TTL_SECONDS } from "@/server/unlock";
import { SHARE_VISIT_WINDOW_SECONDS } from "@/lib/share-image/visits";

/*
 * The Privacy page (docs/PLAN.md, Phase 19) states how long things last.
 * Each statement must match the code it describes: change a constant and
 * this fails until the page's wording (src/lib/privacy-facts.ts) and its
 * "Updated" date are revisited.
 */
const DAY = 86400;

const ACTUAL: Record<keyof typeof PRIVACY_FACTS, number> = {
  signInCodeLife: OTP_TTL_SECONDS,
  stepUpCodeLife: STEP_UP_TTL_SECONDS,
  usedCodeCleanup: CLEANUP_DAYS.usedOrExpiredCodes * DAY,
  sessionLife: SESSION_TTL_SECONDS,
  publicSessionLife: PUBLIC_SESSION_TTL_SECONDS,
  expiredSessionCleanup: CLEANUP_DAYS.expiredSessions * DAY,
  deviceCookieLife: DEVICE_COOKIE_MAX_AGE,
  signInMemory: CLEANUP_DAYS.unusedSignInMemory * DAY,
  passkeyChallengeLife: PASSKEY_CHALLENGE_TTL_SECONDS,
  unlockLife: UNLOCK_TTL_SECONDS,
  rateLimitCleanup: CLEANUP_DAYS.rateLimitWindows * DAY,
  shareVisitRepeat: SHARE_VISIT_WINDOW_SECONDS,
  pushDeliveryCleanup: CLEANUP_DAYS.pushDeliveries * DAY,
  unusedSubscription: UNUSED_SUBSCRIPTION_DAYS * DAY,
  revisionsKept: REVISIONS_KEPT,
  recoveryCodesPerSet: RECOVERY_CODES_PER_SET,
};
const COUNTS = new Set<keyof typeof PRIVACY_FACTS>(["revisionsKept", "recoveryCodesPerSet"]);

const page = readFileSync("src/app/privacy/page.tsx", "utf8");

describe("the Privacy page's facts match the code", () => {
  for (const [key, phrase] of Object.entries(PRIVACY_FACTS) as [keyof typeof PRIVACY_FACTS, string][]) {
    it(`${key}: "${phrase}"`, () => {
      const stated = COUNTS.has(key) ? Number(phrase) : periodSeconds(phrase);
      expect(stated).toBe(ACTUAL[key]);
    });
  }

  it("reads periods the way the page writes them", () => {
    expect(periodSeconds("10 minutes")).toBe(600);
    expect(periodSeconds("a day")).toBe(DAY);
    expect(periodSeconds("two years")).toBe(2 * 365 * DAY);
    expect(() => periodSeconds("about a week")).toThrow();
  });

  it("the page shows every fact, and writes no period or count of its own", () => {
    for (const key of Object.keys(PRIVACY_FACTS)) expect(page, key).toContain(`{F.${key}}`);
    // Durations only ever come from PRIVACY_FACTS ("{F.sessionLife}"), never typed into the page.
    const prose = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{F\.\w+\}/g, "");
    expect(prose).not.toMatch(/\b(\d+|a|an|one|two|three|four|five|six|seven|ten|twelve|thirty|ninety)\s+(second|minute|hour|day|week|month|year)s?\b/i);
  });

  it("has a real 'Updated' date", () => {
    expect(PRIVACY_UPDATED).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(Number.isNaN(new Date(PRIVACY_UPDATED).getTime())).toBe(false);
  });
});

describe("the privacy contact address", () => {
  it("is written in one place only (src/lib/site.ts)", () => {
    const hits = execFileSync("git", ["grep", "-l", "--untracked", PRIVACY_CONTACT_EMAIL, "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["src/lib/site.ts"]);
  });

  it("is rendered as a mailto link on the Privacy page", () => {
    expect(page).toContain("href={`mailto:${PRIVACY_CONTACT_EMAIL}`}");
  });
});
