import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { editors, passkeys, sessions, webauthnChallenges, type Editor } from "@/db/schema";
import { env } from "@/env";
import { toNfc } from "@/lib/letters";
import { PASSKEY_NAME_MAX } from "@/lib/passkey-limits";
import { describeUserAgent } from "@/lib/user-agent";
import { generateToken, sha256 } from "@/server/crypto";
import { sendPasskeyAddedEmail, sendPasskeyRemovedEmail } from "@/server/email";
import { rateLimit } from "@/server/rate-limit";
import { isEmailAllowed } from "./email";
import { ipBucket } from "./ip";
import { isSessionFresh } from "./step-up";
import type { RelyingParty } from "./webauthn-config";

export { PASSKEY_NAME_MAX };

/*
 * Passkeys (docs/PLAN.md, Phase 16 round 2), with SimpleWebAuthn. Same
 * discipline as otp.ts and recovery-codes.ts: framework-free functions that
 * take the DAL-resolved editor and session ids, integration-tested.
 *
 * Challenges: random (SimpleWebAuthn's 32 bytes), stored server-side with a
 * ~5 minute expiry, tied to the browser that asked (a random token in a
 * short-lived httpOnly cookie, stored here only as a SHA-256) and, for
 * registration and step-up, to the editor and session. Taking one deletes it
 * (DELETE … RETURNING), whatever happens next, so each works once.
 *
 * Verification: the exact origin and RP ID from APP_URL; user verification
 * required for sign-in and step-up (preferred, not required, at
 * registration); the signature counter must go up unless both sides are 0
 * (authenticators that don't count, like synced passkeys), and is updated
 * with a conditional UPDATE so a replayed or raced assertion loses.
 *
 * Failures are one generic `invalid`: unknown credential, removed passkey,
 * wrong origin, bad signature, counter, expired or reused challenge.
 */

export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
/** How long after a recovery-code sign-in the session may add a passkey without a step-up. */
export const RECOVERY_PASSKEY_WINDOW_SECONDS = 10 * 60;
export const PASSKEYS_MAX = 20;
export const PASSKEY_LIMITS = {
  /** Sign-in options per client IP bucket per 15 minutes (each one stores a challenge). */
  signInStartsPerIp: 60,
  /** Sign-in verifications per client IP bucket per 15 minutes. */
  signInVerifiesPerIp: 30,
  /** Registration ceremonies per editor per hour. */
  registrationsPerEditor: 20,
  /** Passkey confirmations per session per 15 minutes. */
  stepUpsPerSession: 15,
} as const;

type Purpose = (typeof webauthnChallenges.$inferSelect)["purpose"];
type Db = Pick<ReturnType<typeof getDb>, "select">;

export type PasskeySummary = {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** Synced to the editor's account (iCloud Keychain, Google Password Manager…). */
  backedUp: boolean;
  deviceType: string;
};

const summaryColumns = {
  id: passkeys.id,
  name: passkeys.name,
  createdAt: passkeys.createdAt,
  lastUsedAt: passkeys.lastUsedAt,
  backedUp: passkeys.backedUp,
  deviceType: passkeys.deviceType,
};

// ---------------------------------------------------------------------------
// Challenges

async function storeChallenge(input: {
  purpose: Purpose;
  challenge: string;
  editorId?: string;
  sessionId?: string;
}): Promise<string> {
  const token = generateToken();
  await getDb()
    .insert(webauthnChallenges)
    .values({
      tokenHash: sha256(token),
      purpose: input.purpose,
      challenge: input.challenge,
      editorId: input.editorId ?? null,
      sessionId: input.sessionId ?? null,
      expiresAt: sql`now() + make_interval(secs => ${PASSKEY_CHALLENGE_TTL_SECONDS})`,
    });
  return token;
}

/**
 * Take (delete) the challenge for this browser token and return it, if it is
 * live and was made for this purpose, editor and session. Deleted whether or
 * not it matches, so a token is never good for a second try.
 */
export async function takeChallenge(input: {
  token: unknown;
  purpose: Purpose;
  editorId?: string;
  sessionId?: string;
}): Promise<string | null> {
  if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(input.token)) return null;
  const [row] = await getDb()
    .delete(webauthnChallenges)
    .where(eq(webauthnChallenges.tokenHash, sha256(input.token)))
    .returning({
      challenge: webauthnChallenges.challenge,
      purpose: webauthnChallenges.purpose,
      editorId: webauthnChallenges.editorId,
      sessionId: webauthnChallenges.sessionId,
      live: sql<boolean>`${webauthnChallenges.expiresAt} > now()`,
    });
  if (!row || !row.live || row.purpose !== input.purpose) return null;
  if ((row.editorId ?? undefined) !== input.editorId || (row.sessionId ?? undefined) !== input.sessionId) return null;
  return row.challenge;
}

// ---------------------------------------------------------------------------
// Step-up for passkeys

export type PasskeyGate =
  /** Recently verified by email or passkey. */
  | "fresh"
  /** The recovery-code exception (adding only). */
  | "recovery"
  | "step_up_required"
  | "public_device"
  | "no_session";

/**
 * May this session add (or remove) a passkey right now?
 *
 * - "This isn't my device" sessions can never add one: a passkey made there
 *   would stay on a computer the editor doesn't control, and anyone using it
 *   later could sign in as them. (Removing is allowed, with the normal step-up.)
 * - Otherwise a recent verification is needed, as for recovery codes:
 *   email or passkey within the step-up window (isSessionFresh).
 * - The exception, adding only: within RECOVERY_PASSKEY_WINDOW_SECONDS of a
 *   recovery-code sign-in, in that same session. That's the flow passkeys are
 *   for: an editor whose email is on their phone signs in on their own laptop
 *   with a recovery code and adds a passkey there; demanding an email check
 *   would defeat the point. The trade-off: someone holding a stolen recovery
 *   code (and the email address) can also add a passkey, turning one code
 *   into lasting access. What protects the editor then is that both the
 *   "recovery code used" and the "passkey added" emails go out at once (the
 *   latter says it followed a recovery sign-in), and removing a passkey or
 *   replacing codes from a session that hasn't been verified needs a step-up.
 */
export async function passkeyGate(
  editorId: string,
  sessionId: string,
  action: "add" | "remove",
  db: Db = getDb(),
): Promise<PasskeyGate> {
  const [row] = await db
    .select({
      publicDevice: sessions.publicDevice,
      method: sessions.method,
      recentSignIn: sql<boolean>`${sessions.createdAt} > now() - make_interval(secs => ${RECOVERY_PASSKEY_WINDOW_SECONDS})`,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.editorId, editorId), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row) return "no_session";
  if (action === "add" && row.publicDevice) return "public_device";
  if (await isSessionFresh(editorId, sessionId, db)) return "fresh";
  if (action === "add" && row.method === "recovery" && row.recentSignIn) return "recovery";
  return "step_up_required";
}

// ---------------------------------------------------------------------------
// Registration

const nameSchema = z
  .string()
  .transform((s) => toNfc(s).replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Give the passkey a name")
      .max(PASSKEY_NAME_MAX, `Names can be at most ${PASSKEY_NAME_MAX} characters`),
  );

/** The editor's WebAuthn user handle, made on first use (race-safe). */
async function userHandleFor(editorId: string): Promise<string> {
  const db = getDb();
  await db
    .update(editors)
    .set({ webauthnUserId: generateToken() })
    .where(and(eq(editors.id, editorId), isNull(editors.webauthnUserId)));
  const [row] = await db.select({ handle: editors.webauthnUserId }).from(editors).where(eq(editors.id, editorId));
  return row.handle!;
}

export type StartRegistrationResult =
  | { ok: true; options: PublicKeyCredentialCreationOptionsJSON; token: string }
  | { ok: false; error: "step_up_required" | "public_device" | "no_session" | "too_many" | "rate_limited" };

/** Options for navigator.credentials.create(): a discoverable credential for this editor. */
export async function startPasskeyRegistration(input: {
  editorId: string;
  sessionId: string;
  rp: RelyingParty;
}): Promise<StartRegistrationResult> {
  const { editorId, sessionId, rp } = input;
  const gate = await passkeyGate(editorId, sessionId, "add");
  if (gate !== "fresh" && gate !== "recovery") return { ok: false, error: gate };
  const limit = await rateLimit(`passkey:register:${editorId}`, PASSKEY_LIMITS.registrationsPerEditor, 3600);
  if (!limit.allowed) return { ok: false, error: "rate_limited" };

  const db = getDb();
  const [editor] = await db
    .select({ email: editors.email, penName: editors.penName })
    .from(editors)
    .where(eq(editors.id, editorId));
  const existing = await db
    .select({ id: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.editorId, editorId));
  if (existing.length >= PASSKEYS_MAX) return { ok: false, error: "too_many" };

  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: editor.email,
    userDisplayName: editor.penName ?? editor.email,
    userID: isoBase64URL.toBuffer(await userHandleFor(editorId)),
    attestationType: "none",
    // Never the same authenticator twice.
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
  });
  const token = await storeChallenge({ purpose: "registration", challenge: options.challenge, editorId, sessionId });
  return { ok: true, options, token };
}

export type FinishRegistrationResult =
  | { ok: true; passkey: PasskeySummary }
  | { ok: false; error: "invalid" | "step_up_required" | "public_device" | "no_session" | "too_many" };

/** Check the browser's registration response and store the passkey. Emails a notice. */
export async function finishPasskeyRegistration(input: {
  editorId: string;
  sessionId: string;
  token: unknown;
  response: unknown;
  rp: RelyingParty;
  userAgent?: string | null;
}): Promise<FinishRegistrationResult> {
  const { editorId, sessionId, rp } = input;
  const challenge = await takeChallenge({ token: input.token, purpose: "registration", editorId, sessionId });
  if (!challenge || !looksLikeRegistration(input.response)) return { ok: false, error: "invalid" };

  let info;
  try {
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
    if (!verification.verified) return { ok: false, error: "invalid" };
    info = verification.registrationInfo;
  } catch {
    return { ok: false, error: "invalid" };
  }

  const name = nameSchema.parse(describeUserAgent(input.userAgent));
  const result = await getDb().transaction(async (tx) => {
    // Lock order: the editor row first (CLAUDE.md). Re-check the gate here:
    // the session may have been revoked or aged since the options were made.
    const [editor] = await tx
      .select({ email: editors.email, penName: editors.penName })
      .from(editors)
      .where(eq(editors.id, editorId))
      .for("no key update");
    if (!editor) return { ok: false as const, error: "no_session" as const };
    const gate = await passkeyGate(editorId, sessionId, "add", tx);
    if (gate !== "fresh" && gate !== "recovery") return { ok: false as const, error: gate };
    const [{ n }] = await tx.select({ n: count() }).from(passkeys).where(eq(passkeys.editorId, editorId));
    if (n >= PASSKEYS_MAX) return { ok: false as const, error: "too_many" as const };
    const [row] = await tx
      .insert(passkeys)
      .values({
        editorId,
        credentialId: info.credential.id,
        publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
        counter: info.credential.counter,
        transports: (info.credential.transports ?? []).slice(0, 8),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name,
      })
      // Already registered (to anyone): refused like any other failure.
      .onConflictDoNothing({ target: passkeys.credentialId })
      .returning(summaryColumns);
    if (!row) return { ok: false as const, error: "invalid" as const };
    return { ok: true as const, editor, row, afterRecovery: gate === "recovery" };
  });
  if (!result.ok) return { ok: false, error: result.error };

  const { editor, row, afterRecovery } = result;
  const details = {
    penName: editor.penName,
    passkeyName: row.name,
    device: describeUserAgent(input.userAgent),
    at: new Date(),
    afterRecovery,
  };
  after(async () => {
    try {
      await sendPasskeyAddedEmail(editor.email, details);
    } catch (err) {
      console.error("[passkeys] failed to send passkey-added notice", err);
    }
  });
  return { ok: true, passkey: row };
}

// ---------------------------------------------------------------------------
// Assertions (sign-in and step-up)

type StoredPasskey = {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
};

/**
 * Verify an assertion against a stored passkey and move its counter forward.
 * False for anything wrong; true means the counter update won.
 */
async function checkAssertion(
  stored: StoredPasskey,
  response: AuthenticationResponseJSON,
  challenge: string,
  rp: RelyingParty,
): Promise<boolean> {
  let info;
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: stored.credentialId,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports,
      },
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) return false;
    info = verification.authenticationInfo;
  } catch {
    return false;
  }
  // SimpleWebAuthn checks this too; it's repeated here so the rule can't be
  // lost in an upgrade. A counter that doesn't go up means a cloned
  // authenticator or a replay; both 0 means the authenticator doesn't count.
  if ((info.newCounter > 0 || stored.counter > 0) && info.newCounter <= stored.counter) return false;
  const moved = await getDb()
    .update(passkeys)
    .set({ counter: info.newCounter, lastUsedAt: sql`now()`, backedUp: info.credentialBackedUp })
    .where(and(eq(passkeys.id, stored.id), eq(passkeys.counter, stored.counter)))
    .returning({ id: passkeys.id });
  return moved.length > 0;
}

const storedColumns = {
  id: passkeys.id,
  credentialId: passkeys.credentialId,
  publicKey: passkeys.publicKey,
  counter: passkeys.counter,
  transports: passkeys.transports,
};

export type StartSignInResult =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON; token: string }
  | { ok: false; error: "rate_limited"; retryAfter: number };

/** Options for a usernameless sign-in (discoverable credentials; also used for autofill). */
export async function startPasskeySignIn(input: { rp: RelyingParty; ip?: string | null }): Promise<StartSignInResult> {
  const limit = await rateLimit(`passkey:start:ip:${ipBucket(input.ip)}`, PASSKEY_LIMITS.signInStartsPerIp, 15 * 60);
  if (!limit.allowed) return { ok: false, error: "rate_limited", retryAfter: limit.retryAfter };
  const options = await generateAuthenticationOptions({
    rpID: input.rp.id,
    userVerification: "required",
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
  });
  const token = await storeChallenge({ purpose: "authentication", challenge: options.challenge });
  return { ok: true, options, token };
}

export type FinishSignInResult =
  | { ok: true; editor: Editor }
  | { ok: false; error: "invalid" }
  | { ok: false; error: "rate_limited"; retryAfter: number };

/** Check a sign-in assertion. The caller starts the session (method "passkey"). */
export async function finishPasskeySignIn(input: {
  token: unknown;
  response: unknown;
  rp: RelyingParty;
  ip?: string | null;
}): Promise<FinishSignInResult> {
  // Counted before anything is looked at or compared.
  const limit = await rateLimit(`passkey:verify:ip:${ipBucket(input.ip)}`, PASSKEY_LIMITS.signInVerifiesPerIp, 15 * 60);
  if (!limit.allowed) return { ok: false, error: "rate_limited", retryAfter: limit.retryAfter };

  const challenge = await takeChallenge({ token: input.token, purpose: "authentication" });
  if (!challenge || !looksLikeAuthentication(input.response)) return { ok: false, error: "invalid" };
  const response = input.response;

  const db = getDb();
  const [found] = await db
    .select({ ...storedColumns, editorId: editors.id, email: editors.email, userHandle: editors.webauthnUserId })
    .from(passkeys)
    .innerJoin(editors, eq(editors.id, passkeys.editorId))
    .where(eq(passkeys.credentialId, response.id))
    .limit(1);
  if (!found || !isEmailAllowed(found.email, env().EDITOR_ALLOWLIST)) return { ok: false, error: "invalid" };
  // A discoverable credential names its user; it must be this passkey's editor.
  const handle = response.response.userHandle;
  if (handle !== undefined && handle !== found.userHandle) return { ok: false, error: "invalid" };

  if (!(await checkAssertion(found, response, challenge, input.rp))) return { ok: false, error: "invalid" };

  const [editor] = await db
    .update(editors)
    .set({ lastSignInAt: new Date() })
    .where(eq(editors.id, found.editorId))
    .returning();
  return { ok: true, editor };
}

export type StartStepUpResult =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON; token: string }
  | { ok: false; error: "no_passkeys" | "rate_limited" };

/** Options to confirm it's the editor with one of their own passkeys (profile step-up). */
export async function startPasskeyStepUp(input: {
  editorId: string;
  sessionId: string;
  rp: RelyingParty;
}): Promise<StartStepUpResult> {
  const { editorId, sessionId, rp } = input;
  const limit = await rateLimit(`passkey:stepup:${sessionId}`, PASSKEY_LIMITS.stepUpsPerSession, 15 * 60);
  if (!limit.allowed) return { ok: false, error: "rate_limited" };
  const own = await getDb()
    .select({ id: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.editorId, editorId));
  if (own.length === 0) return { ok: false, error: "no_passkeys" };
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: own.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: "required",
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
  });
  const token = await storeChallenge({ purpose: "step-up", challenge: options.challenge, editorId, sessionId });
  return { ok: true, options, token };
}

/** Check a step-up assertion; on success the session counts as freshly verified. */
export async function finishPasskeyStepUp(input: {
  editorId: string;
  sessionId: string;
  token: unknown;
  response: unknown;
  rp: RelyingParty;
}): Promise<{ ok: true } | { ok: false; error: "invalid" }> {
  const { editorId, sessionId } = input;
  const challenge = await takeChallenge({ token: input.token, purpose: "step-up", editorId, sessionId });
  if (!challenge || !looksLikeAuthentication(input.response)) return { ok: false, error: "invalid" };
  const response = input.response;
  const db = getDb();
  // Scoped: only this editor's own passkeys can confirm.
  const [stored] = await db
    .select(storedColumns)
    .from(passkeys)
    .where(and(eq(passkeys.credentialId, response.id), eq(passkeys.editorId, editorId)))
    .limit(1);
  if (!stored || !(await checkAssertion(stored, response, challenge, input.rp))) return { ok: false, error: "invalid" };
  const marked = await db
    .update(sessions)
    .set({ passkeyVerifiedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), eq(sessions.editorId, editorId), gt(sessions.expiresAt, sql`now()`)))
    .returning({ id: sessions.id });
  return marked.length > 0 ? { ok: true } : { ok: false, error: "invalid" };
}

// ---------------------------------------------------------------------------
// Managing passkeys (all scoped by the DAL-resolved editor id)

/** The editor's passkeys, oldest first. Never the key material. */
export async function listPasskeys(editorId: string): Promise<PasskeySummary[]> {
  return getDb()
    .select(summaryColumns)
    .from(passkeys)
    .where(eq(passkeys.editorId, editorId))
    .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
}

const passkeyIdSchema = z.uuid();

export type RenamePasskeyResult = { ok: true; name: string } | { ok: false; error: string };

/** Rename one of the editor's passkeys. Another editor's (or a malformed) id looks missing. */
export async function renamePasskey(editorId: string, id: unknown, rawName: unknown): Promise<RenamePasskeyResult> {
  const passkeyId = passkeyIdSchema.safeParse(id);
  if (!passkeyId.success) return { ok: false, error: "That passkey no longer exists." };
  const name = nameSchema.safeParse(typeof rawName === "string" ? rawName : "");
  if (!name.success) return { ok: false, error: name.error.issues[0].message };
  const [row] = await getDb()
    .update(passkeys)
    .set({ name: name.data })
    .where(and(eq(passkeys.id, passkeyId.data), eq(passkeys.editorId, editorId)))
    .returning({ name: passkeys.name });
  return row ? { ok: true, name: row.name } : { ok: false, error: "That passkey no longer exists." };
}

export type RemovePasskeyResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "step_up_required" | "no_session" };

/** Remove one of the editor's passkeys. Needs a recent verification. Emails a notice. */
export async function removePasskey(input: {
  editorId: string;
  sessionId: string;
  id: unknown;
  userAgent?: string | null;
}): Promise<RemovePasskeyResult> {
  const { editorId, sessionId } = input;
  const passkeyId = passkeyIdSchema.safeParse(input.id);
  if (!passkeyId.success) return { ok: false, error: "not_found" };
  const result = await getDb().transaction(async (tx) => {
    const [editor] = await tx
      .select({ email: editors.email, penName: editors.penName })
      .from(editors)
      .where(eq(editors.id, editorId))
      .for("no key update");
    if (!editor) return { ok: false as const, error: "no_session" as const };
    const gate = await passkeyGate(editorId, sessionId, "remove", tx);
    if (gate === "no_session" || gate === "step_up_required") return { ok: false as const, error: gate };
    const [removed] = await tx
      .delete(passkeys)
      .where(and(eq(passkeys.id, passkeyId.data), eq(passkeys.editorId, editorId)))
      .returning({ name: passkeys.name });
    if (!removed) return { ok: false as const, error: "not_found" as const };
    return { ok: true as const, editor, name: removed.name };
  });
  if (!result.ok) return { ok: false, error: result.error };
  const details = {
    penName: result.editor.penName,
    passkeyName: result.name,
    device: describeUserAgent(input.userAgent),
    at: new Date(),
  };
  after(async () => {
    try {
      await sendPasskeyRemovedEmail(result.editor.email, details);
    } catch (err) {
      console.error("[passkeys] failed to send passkey-removed notice", err);
    }
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The add-a-passkey offer after a recovery-code sign-in

/**
 * Offer to add a passkey on this computer? Only in a session started with a
 * recovery code, not on a public device, while the recovery exception lasts
 * (afterwards adding would need an email check the editor can't do here),
 * not after "Not now", and not once a passkey was added since signing in.
 */
export async function shouldOfferPasskey(editorId: string, sessionId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.editorId, editorId),
        eq(sessions.method, "recovery"),
        eq(sessions.publicDevice, false),
        isNull(sessions.passkeyOfferDismissedAt),
        gt(sessions.expiresAt, sql`now()`),
        gt(sessions.createdAt, sql`now() - make_interval(secs => ${RECOVERY_PASSKEY_WINDOW_SECONDS})`),
        sql`NOT EXISTS (SELECT 1 FROM ${passkeys} WHERE ${passkeys.editorId} = ${editorId} AND ${passkeys.createdAt} >= ${sessions.createdAt})`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** "Not now" on the offer: this session won't ask again. */
export async function dismissPasskeyOffer(editorId: string, sessionId: string): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ passkeyOfferDismissedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), eq(sessions.editorId, editorId)));
}

// ---------------------------------------------------------------------------
// Response shape checks (SimpleWebAuthn validates the rest and throws, which
// we turn into `invalid`); these keep junk from the client away from SQL.

const B64URL = /^[A-Za-z0-9_-]+$/;
const isB64 = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && B64URL.test(v);

function looksLikeCredential(r: unknown): r is { id: string; rawId: string; type: "public-key"; response: Record<string, unknown> } {
  if (!r || typeof r !== "object") return false;
  const c = r as Record<string, unknown>;
  return (
    isB64(c.id, 1366) &&
    c.rawId === c.id &&
    c.type === "public-key" &&
    !!c.response &&
    typeof c.response === "object" &&
    isB64((c.response as Record<string, unknown>).clientDataJSON, 4096)
  );
}

function looksLikeRegistration(r: unknown): r is RegistrationResponseJSON {
  return looksLikeCredential(r) && isB64(r.response.attestationObject, 65536);
}

function looksLikeAuthentication(r: unknown): r is AuthenticationResponseJSON {
  if (!looksLikeCredential(r)) return false;
  const res = r.response;
  return (
    isB64(res.authenticatorData, 4096) &&
    isB64(res.signature, 4096) &&
    (res.userHandle === undefined || isB64(res.userHandle, 128))
  );
}
