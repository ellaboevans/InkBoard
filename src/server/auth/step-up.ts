import "server-only";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { editors, sessions, stepUpCodes } from "@/db/schema";
import { generateOtpCode, hmac, safeEqual } from "@/server/crypto";
import { sendStepUpEmail } from "@/server/email";
import { rateLimit } from "@/server/rate-limit";
import { STEP_UP_TTL_SECONDS, STEP_UP_WINDOW_SECONDS } from "./step-up-config";

/*
 * Step-up (docs/PLAN.md, Phase 16): before a sensitive change (making or
 * replacing recovery codes, adding or removing a passkey), the session must
 * have proved, within STEP_UP_WINDOW_SECONDS, access to the editor's inbox
 * (an email sign-in, or a confirmation code emailed now) or possession of one
 * of their passkeys with user verification (a passkey sign-in, or a passkey
 * confirmation: passkeys.ts). A stolen long-lived session cookie alone can't
 * do it, and a recovery-code sign-in doesn't count (it proved neither).
 * (Adding a passkey right after a recovery sign-in is the one exception:
 * passkeyStepUp in passkeys.ts.) Codes work like sign-in codes (HMAC only, attempts counted
 * before comparing, conditional consume) and are bound to the session that
 * asked, so a code can't confirm some other browser.
 */

export { STEP_UP_TTL_SECONDS, STEP_UP_WINDOW_SECONDS };
export const STEP_UP_MAX_ATTEMPTS = 5;
export const STEP_UP_RESEND_COOLDOWN_SECONDS = 60;
const REQUESTS_PER_EDITOR = 5; // per 15 minutes
const VERIFICATIONS_PER_SESSION = 15; // per 15 minutes
const VERIFICATIONS_PER_EDITOR_PER_DAY = 50;

const hashCode = (sessionId: string, code: string) => hmac("step-up", `${sessionId}:${code}`);

type Db = Pick<ReturnType<typeof getDb>, "select">;

/**
 * Whether this live session of this editor proved inbox access, or a
 * passkey, within the step-up window. Times come from the database clock. Pass a transaction to
 * check inside one (generateRecoveryCodes does, under the editor lock).
 */
export async function isSessionFresh(editorId: string, sessionId: string, db: Db = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.editorId, editorId),
        gt(sessions.expiresAt, sql`now()`),
        or(
          gt(sessions.emailVerifiedAt, sql`now() - make_interval(secs => ${STEP_UP_WINDOW_SECONDS})`),
          gt(sessions.passkeyVerifiedAt, sql`now() - make_interval(secs => ${STEP_UP_WINDOW_SECONDS})`),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type RequestStepUpResult =
  | { ok: true; email: string; resendIn: number }
  | { ok: false; error: "rate_limited"; retryAfter: number }
  | { ok: false; error: "no_session" };

/** Email a confirmation code for this session. Only the newest code works. */
export async function requestStepUpCode(input: { editorId: string; sessionId: string }): Promise<RequestStepUpResult> {
  const { editorId, sessionId } = input;
  const limits = await Promise.all([
    rateLimit(`stepup:cooldown:${sessionId}`, 1, STEP_UP_RESEND_COOLDOWN_SECONDS),
    rateLimit(`stepup:req:editor:${editorId}`, REQUESTS_PER_EDITOR, 15 * 60),
  ]);
  const blocked = limits.find((l) => !l.allowed);
  if (blocked) return { ok: false, error: "rate_limited", retryAfter: blocked.retryAfter };

  const db = getDb();
  const [owner] = await db
    .select({ email: editors.email })
    .from(sessions)
    .innerJoin(editors, eq(editors.id, sessions.editorId))
    .where(and(eq(sessions.id, sessionId), eq(sessions.editorId, editorId), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!owner) return { ok: false, error: "no_session" };

  const code = generateOtpCode();
  await db.transaction(async (tx) => {
    await tx
      .update(stepUpCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(stepUpCodes.sessionId, sessionId), isNull(stepUpCodes.consumedAt)));
    await tx.insert(stepUpCodes).values({
      sessionId,
      codeHash: hashCode(sessionId, code),
      expiresAt: sql`now() + make_interval(secs => ${STEP_UP_TTL_SECONDS})`,
    });
  });

  after(async () => {
    try {
      await sendStepUpEmail(owner.email, code);
    } catch (err) {
      console.error("[step-up] failed to send confirmation email", err);
    }
  });
  return { ok: true, email: owner.email, resendIn: STEP_UP_RESEND_COOLDOWN_SECONDS };
}

export type VerifyStepUpResult =
  | { ok: true }
  | { ok: false; error: "invalid_code"; attemptsLeft?: number }
  | { ok: false; error: "too_many_attempts" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

/** Check a confirmation code; on success the session counts as freshly verified. */
export async function verifyStepUpCode(input: {
  editorId: string;
  sessionId: string;
  code: unknown;
}): Promise<VerifyStepUpResult> {
  const { editorId, sessionId } = input;
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "invalid_code" };

  for (const limit of [
    () => rateLimit(`stepup:verify:session:${sessionId}`, VERIFICATIONS_PER_SESSION, 15 * 60),
    () => rateLimit(`stepup:verify:editor:${editorId}`, VERIFICATIONS_PER_EDITOR_PER_DAY, 86400),
  ]) {
    const res = await limit();
    if (!res.allowed) return { ok: false, error: "rate_limited", retryAfter: res.retryAfter };
  }

  const db = getDb();
  const [row] = await db
    .select({ id: stepUpCodes.id, codeHash: stepUpCodes.codeHash })
    .from(stepUpCodes)
    .innerJoin(sessions, eq(sessions.id, stepUpCodes.sessionId))
    .where(
      and(
        eq(stepUpCodes.sessionId, sessionId),
        eq(sessions.editorId, editorId),
        isNull(stepUpCodes.consumedAt),
        gt(stepUpCodes.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(stepUpCodes.createdAt))
    .limit(1);
  if (!row) return { ok: false, error: "invalid_code" };

  // Count the attempt before comparing, atomically (as in otp.ts).
  const [counted] = await db
    .update(stepUpCodes)
    .set({ attempts: sql`${stepUpCodes.attempts} + 1` })
    .where(and(eq(stepUpCodes.id, row.id), isNull(stepUpCodes.consumedAt), lt(stepUpCodes.attempts, STEP_UP_MAX_ATTEMPTS)))
    .returning({ attempts: stepUpCodes.attempts });
  if (!counted) return { ok: false, error: "too_many_attempts" };

  if (!safeEqual(row.codeHash, hashCode(sessionId, code))) {
    const attemptsLeft = STEP_UP_MAX_ATTEMPTS - counted.attempts;
    return attemptsLeft <= 0 ? { ok: false, error: "too_many_attempts" } : { ok: false, error: "invalid_code", attemptsLeft };
  }

  const consumed = await db
    .update(stepUpCodes)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(stepUpCodes.id, row.id), isNull(stepUpCodes.consumedAt)))
    .returning({ id: stepUpCodes.id });
  if (consumed.length === 0) return { ok: false, error: "invalid_code" };

  const marked = await db
    .update(sessions)
    .set({ emailVerifiedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), eq(sessions.editorId, editorId), gt(sessions.expiresAt, sql`now()`)))
    .returning({ id: sessions.id });
  return marked.length > 0 ? { ok: true } : { ok: false, error: "invalid_code" };
}
