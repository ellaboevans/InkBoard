import "server-only";
import { and, count, eq, isNull, max, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { editors, recoveryCodes, type Editor } from "@/db/schema";
import { env } from "@/env";
import { RECOVERY_CODES_PER_SET, normalizeRecoveryCode } from "@/lib/recovery-code-format";
import { describeUserAgent } from "@/lib/user-agent";
import { generateRecoveryCode, generateToken, hmac, safeEqual, sha256 } from "@/server/crypto";
import { sendRecoveryCodesChangedEmail, sendRecoveryCodeUsedEmail } from "@/server/email";
import { rateLimit } from "@/server/rate-limit";
import { isEmailAllowed, normalizeEmail } from "./email";
import { ipBucket } from "./ip";
import { isSessionFresh } from "./step-up";

/*
 * Recovery codes (docs/PLAN.md, Phase 16): ten single-use codes an editor
 * makes while signed in and keeps, to sign in later from any computer without
 * their email. Same discipline as otp.ts:
 *  - only an HMAC of each code is stored (purpose "recovery-code", keyed by
 *    AUTH_SECRET, bound to the editor id), compared in constant time;
 *  - using a code is one conditional UPDATE (`used_at IS NULL`), so a code
 *    works once even when two requests race;
 *  - unknown, not-allowlisted, code-less and wrong all get the same answer
 *    after the same rate limits and the same queries (no enumeration);
 *  - guesses are counted (rate limits) before anything is compared, in tiers:
 *    client IP, then email + client, then email across all clients. A client
 *    over its own budget stops before the shared tier, so it can't lock the
 *    editor out.
 * Codes have 60 bits each, so the limits are about lockout and noise more
 * than brute force (100 guesses a day against 10 codes: ~1e-15 per day).
 */

export const RECOVERY_LIMITS = {
  /** Per client IP bucket, any email, per 15 minutes. */
  perIp: 20,
  /** Per (email, client) per hour / per day. */
  perEmailClientHour: 10,
  perEmailClientDay: 20,
  /** Per email across all clients per hour / per day. */
  perEmailHour: 30,
  perEmailDay: 100,
} as const;

/** Never a real editor id: stands in for "no editor" so the same queries run. */
const NO_EDITOR = "00000000-0000-0000-0000-000000000000";

const hashCode = (editorId: string, code: string) => hmac("recovery-code", `${editorId}:${code}`);

export type RecoveryCodeStatus = {
  /** Codes in the current set (0 = never set up). */
  total: number;
  unused: number;
  /** When the current set was made. */
  createdAt: Date | null;
  /** "Not now" on the dashboard's setup prompt. */
  promptDismissed: boolean;
};

/** The editor's own recovery-code status (never the hashes). */
export async function getRecoveryCodeStatus(editorId: string): Promise<RecoveryCodeStatus> {
  const db = getDb();
  const [[codes], [editor]] = await Promise.all([
    db
      .select({
        total: count(),
        unused: sql<number>`count(*) FILTER (WHERE ${recoveryCodes.usedAt} IS NULL)`.mapWith(Number),
        createdAt: max(recoveryCodes.createdAt),
      })
      .from(recoveryCodes)
      .where(eq(recoveryCodes.editorId, editorId)),
    db
      .select({ dismissedAt: editors.recoveryPromptDismissedAt })
      .from(editors)
      .where(eq(editors.id, editorId)),
  ]);
  return {
    total: codes?.total ?? 0,
    unused: codes?.unused ?? 0,
    createdAt: codes?.createdAt ?? null,
    promptDismissed: Boolean(editor?.dismissedAt),
  };
}

export type GenerateRecoveryCodesResult =
  | { ok: true; codes: string[] }
  | { ok: false; error: "step_up_required" };

/**
 * Make a new set of codes, replacing any old one, and return them (the only
 * time they exist in plain text). Needs a fresh session (step-up.ts), checked
 * under the editor row lock in the same transaction. Emails a notice.
 */
export async function generateRecoveryCodes(input: {
  editorId: string;
  sessionId: string;
  userAgent?: string | null;
}): Promise<GenerateRecoveryCodesResult> {
  const { editorId, sessionId } = input;
  const codes = Array.from({ length: RECOVERY_CODES_PER_SET }, generateRecoveryCode);

  const result = await getDb().transaction(async (tx) => {
    // Lock order: the editor row first (CLAUDE.md), which also serialises
    // two concurrent "new set" requests.
    const [editor] = await tx
      .select({ email: editors.email, penName: editors.penName })
      .from(editors)
      .where(eq(editors.id, editorId))
      .for("no key update");
    if (!editor || !(await isSessionFresh(editorId, sessionId, tx))) return null;

    const replaced = await tx
      .delete(recoveryCodes)
      .where(eq(recoveryCodes.editorId, editorId))
      .returning({ id: recoveryCodes.id });
    await tx.insert(recoveryCodes).values(codes.map((code) => ({ editorId, codeHash: hashCode(editorId, code) })));
    return { editor, firstSet: replaced.length === 0 };
  });
  if (!result) return { ok: false, error: "step_up_required" };

  const { editor, firstSet } = result;
  const details = { penName: editor.penName, device: describeUserAgent(input.userAgent), at: new Date(), firstSet };
  after(async () => {
    try {
      await sendRecoveryCodesChangedEmail(editor.email, details);
    } catch (err) {
      console.error("[recovery] failed to send codes-changed notice", err);
    }
  });
  return { ok: true, codes };
}

/** "Not now" on the dashboard's setup prompt. Stored on the editor, so it holds on every device. */
export async function dismissRecoveryPrompt(editorId: string): Promise<void> {
  await getDb()
    .update(editors)
    .set({ recoveryPromptDismissedAt: sql`now()` })
    .where(and(eq(editors.id, editorId), isNull(editors.recoveryPromptDismissedAt)));
}

export type VerifyRecoveryCodeResult =
  | { ok: true; editor: Editor; remaining: number }
  | { ok: false; error: "invalid" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

/**
 * Sign in with an email address and a recovery code. On success the code is
 * used up, the editor is told by email (device, time, codes left), and the
 * caller starts the session. Every failure is the same `invalid`.
 */
export async function verifyRecoveryCode(input: {
  email: unknown;
  code: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<VerifyRecoveryCodeResult> {
  const client = ipBucket(input.ip);
  const ipLimit = await rateLimit(`recovery:verify:ip:${client}`, RECOVERY_LIMITS.perIp, 15 * 60);
  if (!ipLimit.allowed) return { ok: false, error: "rate_limited", retryAfter: ipLimit.retryAfter };

  const email = normalizeEmail(input.email);
  // Not an email address at all: nothing to look up, and no account to protect.
  if (!email) return { ok: false, error: "invalid" };

  const emailKey = sha256(email);
  const tiers = [
    () => [
      rateLimit(`recovery:verify:email-ip:h:${emailKey}:${client}`, RECOVERY_LIMITS.perEmailClientHour, 3600),
      rateLimit(`recovery:verify:email-ip:d:${emailKey}:${client}`, RECOVERY_LIMITS.perEmailClientDay, 86400),
    ],
    () => [
      rateLimit(`recovery:verify:email:h:${emailKey}`, RECOVERY_LIMITS.perEmailHour, 3600),
      rateLimit(`recovery:verify:email:d:${emailKey}`, RECOVERY_LIMITS.perEmailDay, 86400),
    ],
  ];
  for (const tier of tiers) {
    const blocked = (await Promise.all(tier())).find((l) => !l.allowed);
    if (blocked) return { ok: false, error: "rate_limited", retryAfter: blocked.retryAfter };
  }

  // From here on, the same work happens whether or not the address belongs
  // to an editor with codes: one editor lookup, one code lookup (for a
  // stand-in id when there's no editor), and RECOVERY_CODES_PER_SET
  // constant-time comparisons against real or decoy hashes.
  const db = getDb();
  const [found] = await db.select({ id: editors.id }).from(editors).where(eq(editors.email, email)).limit(1);
  const editorId = found && isEmailAllowed(email, env().EDITOR_ALLOWLIST) ? found.id : NO_EDITOR;
  const unused = await db
    .select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.editorId, editorId), isNull(recoveryCodes.usedAt)));

  const code = normalizeRecoveryCode(input.code);
  const guess = hashCode(editorId, code ?? "-");
  const candidates: { id: string | null; codeHash: string }[] = [...unused];
  while (candidates.length < RECOVERY_CODES_PER_SET) {
    candidates.push({ id: null, codeHash: hmac("recovery-code-decoy", generateToken()) });
  }
  let match: string | null = null;
  for (const c of candidates) {
    // No early exit: every candidate is compared.
    if (safeEqual(c.codeHash, guess) && c.id && code) match = c.id;
  }
  if (!match) return { ok: false, error: "invalid" };

  // Single use: only one concurrent request can win this update.
  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(and(eq(recoveryCodes.id, match), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  if (used.length === 0) return { ok: false, error: "invalid" };

  const [editor] = await db
    .update(editors)
    .set({ lastSignInAt: new Date() })
    .where(eq(editors.id, editorId))
    .returning();
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.editorId, editorId), isNull(recoveryCodes.usedAt)));

  const details = { penName: editor.penName, device: describeUserAgent(input.userAgent), at: new Date(), remaining };
  after(async () => {
    try {
      await sendRecoveryCodeUsedEmail(editor.email, details);
    } catch (err) {
      console.error("[recovery] failed to send code-used notice", err);
    }
  });
  return { ok: true, editor, remaining };
}
