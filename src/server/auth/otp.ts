import "server-only";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { editors, emailOtps, type Editor } from "@/db/schema";
import { env } from "@/env";
import {
  generateOtpCode,
  generateToken,
  hmac,
  safeEqual,
  sha256,
} from "@/server/crypto";
import { sendOtpEmail } from "@/server/email";
import { rateLimit } from "@/server/rate-limit";
import { isEmailAllowed, normalizeEmail } from "./email";
import { ipBucket } from "./ip";

import { OTP_TTL_SECONDS } from "./otp-config";
export { OTP_TTL_SECONDS };
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

// Short-window rate limits (per 15 minutes)
const WINDOW = 15 * 60;
const REQUESTS_PER_EMAIL = 5;
const REQUESTS_PER_IP = 20;
const VERIFICATIONS_PER_IP = 30;
// Caps total sends (protects email quota/reputation if IP limits are evaded).
const REQUESTS_GLOBAL_PER_HOUR = 500;
// Guess caps per email. Two layers, so that one attacker can't lock an editor
// out of sign-in (review finding #5) while brute force stays bounded:
// - per (email, client): what a single client may spend on one address. The
//   editor's own browser has its own budget, untouched by others' guesses.
// - per email, all clients: a higher backstop against IP rotation. A guess
//   only counts here once the client is within its own budget, so a single
//   client can never push this one up to lock the editor out.
// At the backstop, an attacker gets at most 100 guesses/day on a 6-digit
// code (~3.7% per year of nonstop effort, which also needs 4+ clients a day).
const VERIFICATIONS_PER_EMAIL_CLIENT_PER_HOUR = 10;
const VERIFICATIONS_PER_EMAIL_CLIENT_PER_DAY = 30;
const VERIFICATIONS_PER_EMAIL_PER_HOUR = 30;
const VERIFICATIONS_PER_EMAIL_PER_DAY = 100;

/** Per-client bucket: IPv6 grouped by /64; no known IP -> one shared bucket. */
const ipKey = ipBucket;

const hashCode = (email: string, code: string) =>
  hmac("email-otp", `${email}:${code}`);

export type RequestOtpResult =
  | { ok: true; email: string; resendIn: number }
  | { ok: false; error: "invalid_email" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

/**
 * Issue a new sign-in code and email it.
 *
 * Responds identically whether or not the address is on the allowlist, so the
 * form cannot be used to discover who is an editor.
 */
export async function requestOtp(input: {
  email: unknown;
  ip?: string | null;
}): Promise<RequestOtpResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };

  // Applied identically to every address (allowed or not) so that timing of
  // "please wait" responses can't reveal who is an editor.
  const emailKey = sha256(email);
  const limits = await Promise.all([
    rateLimit(`otp:cooldown:${emailKey}`, 1, OTP_RESEND_COOLDOWN_SECONDS),
    rateLimit(`otp:req:email:${emailKey}`, REQUESTS_PER_EMAIL, WINDOW),
    rateLimit(`otp:req:ip:${ipKey(input.ip)}`, REQUESTS_PER_IP, WINDOW),
    rateLimit("otp:req:global", REQUESTS_GLOBAL_PER_HOUR, 3600),
  ]);
  const blocked = limits.find((l) => !l.allowed);
  if (blocked) {
    return { ok: false, error: "rate_limited", retryAfter: blocked.retryAfter };
  }

  // Non-allowed addresses get a decoy row whose hash matches no 6-digit code,
  // so the verify step (attempt counts, error messages, timing) behaves
  // exactly as it does for real editors (N9: no enumeration).
  const allowed = isEmailAllowed(email, env().EDITOR_ALLOWLIST);
  const code = generateOtpCode();
  const codeHash = allowed
    ? hashCode(email, code)
    : hmac("email-otp-decoy", `${email}:${generateToken()}`);

  await getDb().transaction(async (tx) => {
    // Only the newest code is ever valid.
    await tx
      .update(emailOtps)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(emailOtps.email, email), isNull(emailOtps.consumedAt)));
    await tx.insert(emailOtps).values({
      email,
      codeHash,
      expiresAt: sql`now() + make_interval(secs => ${OTP_TTL_SECONDS})`,
      requestedIp: input.ip ?? null,
    });
  });

  if (allowed) {
    // Deliver after the response is sent: otherwise the email API's latency
    // (and failures) would make allowed addresses distinguishable by timing.
    after(async () => {
      try {
        await sendOtpEmail(email, code);
      } catch (err) {
        console.error("[otp] failed to send sign-in email", err);
      }
    });
  }

  return { ok: true, email, resendIn: OTP_RESEND_COOLDOWN_SECONDS };
}

export type VerifyOtpResult =
  | { ok: true; editor: Editor }
  | { ok: false; error: "invalid_code"; attemptsLeft?: number }
  | { ok: false; error: "too_many_attempts" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

/**
 * Check a code. On success the code is consumed and the editor record is
 * created (first sign-in) or updated (returning editor).
 */
export async function verifyOtp(input: {
  email: unknown;
  code: unknown;
  ip?: string | null;
}): Promise<VerifyOtpResult> {
  const email = normalizeEmail(input.email);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "invalid_code" };
  }

  const emailKey = sha256(email);
  const client = ipKey(input.ip);
  // Checked in tiers: a client over its own budget is stopped before it can
  // count against the next tier (see the limits above).
  const tiers = [
    () => [rateLimit(`otp:verify:ip:${client}`, VERIFICATIONS_PER_IP, WINDOW)],
    () => [
      rateLimit(`otp:verify:email-ip:h:${emailKey}:${client}`, VERIFICATIONS_PER_EMAIL_CLIENT_PER_HOUR, 3600),
      rateLimit(`otp:verify:email-ip:d:${emailKey}:${client}`, VERIFICATIONS_PER_EMAIL_CLIENT_PER_DAY, 86400),
    ],
    () => [
      rateLimit(`otp:verify:email:h:${emailKey}`, VERIFICATIONS_PER_EMAIL_PER_HOUR, 3600),
      rateLimit(`otp:verify:email:d:${emailKey}`, VERIFICATIONS_PER_EMAIL_PER_DAY, 86400),
    ],
  ];
  for (const tier of tiers) {
    const blocked = (await Promise.all(tier())).find((l) => !l.allowed);
    if (blocked) {
      return { ok: false, error: "rate_limited", retryAfter: blocked.retryAfter };
    }
  }

  const db = getDb();
  const [otp] = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, email),
        isNull(emailOtps.consumedAt),
        gt(emailOtps.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);
  if (!otp) return { ok: false, error: "invalid_code" };

  // Count the attempt *before* comparing, atomically, so concurrent guesses
  // can never exceed OTP_MAX_ATTEMPTS.
  const [counted] = await db
    .update(emailOtps)
    .set({ attempts: sql`${emailOtps.attempts} + 1` })
    .where(
      and(
        eq(emailOtps.id, otp.id),
        isNull(emailOtps.consumedAt),
        lt(emailOtps.attempts, OTP_MAX_ATTEMPTS),
      ),
    )
    .returning({ attempts: emailOtps.attempts });

  if (!counted) {
    await consume(otp.id);
    return { ok: false, error: "too_many_attempts" };
  }

  if (!safeEqual(otp.codeHash, hashCode(email, code))) {
    const attemptsLeft = OTP_MAX_ATTEMPTS - counted.attempts;
    if (attemptsLeft <= 0) {
      await consume(otp.id);
      return { ok: false, error: "too_many_attempts" };
    }
    return { ok: false, error: "invalid_code", attemptsLeft };
  }

  // Single use: only one concurrent request can win this update.
  const consumed = await consume(otp.id);
  if (!consumed) return { ok: false, error: "invalid_code" };

  if (!isEmailAllowed(email, env().EDITOR_ALLOWLIST)) {
    return { ok: false, error: "invalid_code" };
  }

  const now = new Date();
  const [editor] = await db
    .insert(editors)
    .values({ email, lastSignInAt: now })
    .onConflictDoUpdate({
      target: editors.email,
      set: { lastSignInAt: now },
    })
    .returning();

  return { ok: true, editor };
}

async function consume(id: string): Promise<boolean> {
  const rows = await getDb()
    .update(emailOtps)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(emailOtps.id, id), isNull(emailOtps.consumedAt)))
    .returning({ id: emailOtps.id });
  return rows.length > 0;
}
