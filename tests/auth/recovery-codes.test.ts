import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, recoveryCodes, sessions, stepUpCodes as stepUpRows } from "@/db/schema";
import { resetEnvCache } from "@/env";
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_BITS,
  RECOVERY_CODES_PER_SET,
  formatRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/recovery-code-format";
import {
  RECOVERY_LIMITS,
  dismissRecoveryPrompt,
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  verifyRecoveryCode,
} from "@/server/auth/recovery-codes";
import { PUBLIC_SESSION_TTL_SECONDS, createSession, listSessions, validateSession } from "@/server/auth/sessions";
import {
  STEP_UP_MAX_ATTEMPTS,
  STEP_UP_WINDOW_SECONDS,
  isSessionFresh,
  requestStepUpCode,
  verifyStepUpCode,
} from "@/server/auth/step-up";
import { generateRecoveryCode, hmac } from "@/server/crypto";
import { lastStepUpCodeFor, outbox, recoveryNotices, stepUpCodes } from "../support/outbox";

const db = getDb();
const EMAIL = "keeper@example.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/133.0";

/** An onboarded editor with a fresh (email) session. */
async function editorWithSession(email = EMAIL, options: Parameters<typeof createSession>[2] = {}) {
  const [editor] = await db
    .insert(editors)
    .values({ email, penName: `Poet ${email}`, slug: email.split("@")[0] })
    .returning();
  const { token } = await createSession(editor.id, { userAgent: UA }, options);
  const session = await validateSession(token);
  return { editor, sessionId: session!.sessionId, token };
}

/** Editor + a set of codes, made from a fresh session. */
async function editorWithCodes(email = EMAIL) {
  const ctx = await editorWithSession(email);
  const res = await generateRecoveryCodes({ editorId: ctx.editor.id, sessionId: ctx.sessionId, userAgent: UA });
  if (!res.ok) throw new Error("expected codes");
  return { ...ctx, codes: res.codes };
}

/** Pretend the session's email proof is older than the step-up window. */
async function age(sessionId: string, seconds = STEP_UP_WINDOW_SECONDS + 1) {
  await db
    .update(sessions)
    .set({ emailVerifiedAt: sql`now() - make_interval(secs => ${seconds})` })
    .where(eq(sessions.id, sessionId));
}

const clearLimits = () => db.execute(sql`DELETE FROM rate_limits`);
const limitKeys = async () =>
  ((await db.execute(sql`SELECT key FROM rate_limits ORDER BY key`)) as unknown as { rows: { key: string }[] }).rows.map(
    (r) => r.key,
  );
/** A canonical code that isn't in `codes`. */
const wrongCode = (codes: string[]) => {
  let c = "ZZZZZZZZZZZZ";
  while (codes.includes(c)) c = generateRecoveryCode();
  return c;
};

describe("recovery code format", () => {
  it("has at least 50 bits per code, in Crockford base32 without I, L, O, U", () => {
    expect(RECOVERY_CODE_BITS).toBeGreaterThanOrEqual(50);
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(32);
    expect(RECOVERY_CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("generates codes from the alphabet only, with every symbol used", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      for (const ch of code) seen.add(ch);
    }
    expect(seen.size).toBe(32);
  });

  it("displays codes as three groups of four", () => {
    expect(formatRecoveryCode("ABCD0123WXYZ")).toBe("ABCD-0123-WXYZ");
  });

  it.each([
    ["abcd-0123-wxyz", "ABCD0123WXYZ"],
    ["ABCD 0123 WXYZ", "ABCD0123WXYZ"],
    ["  abcd0123wxyz\n", "ABCD0123WXYZ"],
    ["ABCD–0123—WXYZ", "ABCD0123WXYZ"], // en and em dashes
    ["ABCD_0123_WXYZ", "ABCD0123WXYZ"],
    ["oOiI-lL00-1111", "001111001111"], // Crockford look-alikes
    ["ＡＢＣＤ０１２３ＷＸＹＺ", "ABCD0123WXYZ"], // full-width (NFKC)
  ])("normalises %p", (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });

  it.each(["", "ABCD-0123-WXY", "ABCD-0123-WXYZA", "ABCD-0123-WXYU", "ABCD-0123-WXY!", "A".repeat(41), 123, null, undefined])(
    "rejects %p",
    (input) => {
      expect(normalizeRecoveryCode(input)).toBeNull();
    },
  );
});

describe("generateRecoveryCodes", () => {
  it("makes 10 distinct codes and stores only a keyed hash of each, bound to the editor", async () => {
    const { editor, codes } = await editorWithCodes();
    expect(codes).toHaveLength(RECOVERY_CODES_PER_SET);
    expect(new Set(codes).size).toBe(RECOVERY_CODES_PER_SET);
    const rows = await db.select().from(recoveryCodes).where(eq(recoveryCodes.editorId, editor.id));
    expect(rows).toHaveLength(RECOVERY_CODES_PER_SET);
    const hashes = rows.map((r) => r.codeHash);
    for (const code of codes) {
      expect(hashes.some((h) => h.includes(code))).toBe(false);
      expect(hashes).toContain(hmac("recovery-code", `${editor.id}:${code}`));
      // Not a bare hash of the code, and not another purpose's HMAC.
      expect(hashes).not.toContain(hmac("recovery-code", code));
      expect(hashes).not.toContain(hmac("email-otp", `${editor.id}:${code}`));
    }
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.every((r) => r.usedAt === null)).toBe(true);
  });

  it("replaces the old set: old codes stop working, new ones work", async () => {
    const { editor, sessionId, codes: first } = await editorWithCodes();
    const res = await generateRecoveryCodes({ editorId: editor.id, sessionId, userAgent: UA });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.codes.some((c) => first.includes(c))).toBe(false);
    expect(await db.select().from(recoveryCodes).where(eq(recoveryCodes.editorId, editor.id))).toHaveLength(10);

    expect(await verifyRecoveryCode({ email: EMAIL, code: first[0] })).toEqual({ ok: false, error: "invalid" });
    expect((await verifyRecoveryCode({ email: EMAIL, code: res.codes[0] })).ok).toBe(true);
  });

  it("serialises concurrent new sets: exactly one set survives", async () => {
    const { editor, sessionId } = await editorWithSession();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => generateRecoveryCodes({ editorId: editor.id, sessionId, userAgent: UA })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await db.select().from(recoveryCodes).where(eq(recoveryCodes.editorId, editor.id));
    expect(rows).toHaveLength(10);
    // The surviving set is one of the returned ones, whole.
    const last = results.find(
      (r) => r.ok && r.codes.every((c) => rows.some((row) => row.codeHash === hmac("recovery-code", `${editor.id}:${c}`))),
    );
    expect(last).toBeDefined();
  });

  it("emails a notice (never the codes): set up first, then replaced", async () => {
    const { editor, sessionId, codes } = await editorWithCodes();
    await generateRecoveryCodes({ editorId: editor.id, sessionId, userAgent: UA });
    expect(recoveryNotices).toEqual([
      expect.objectContaining({ to: EMAIL, kind: "changed", firstSet: true, device: "Firefox on Windows" }),
      expect.objectContaining({ to: EMAIL, kind: "changed", firstSet: false, device: "Firefox on Windows" }),
    ]);
    expect(JSON.stringify(recoveryNotices)).not.toContain(codes[0]);
  });
});

describe("the step-up rule", () => {
  it("lets a session that signed in by email in the last 10 minutes make codes", async () => {
    const { editor, sessionId } = await editorWithSession();
    expect(await isSessionFresh(editor.id, sessionId)).toBe(true);
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId })).ok).toBe(true);
  });

  it("refuses an older session, and leaves the existing codes alone", async () => {
    const { editor, sessionId, codes } = await editorWithCodes();
    await age(sessionId);
    expect(await isSessionFresh(editor.id, sessionId)).toBe(false);
    expect(await generateRecoveryCodes({ editorId: editor.id, sessionId })).toEqual({
      ok: false,
      error: "step_up_required",
    });
    expect((await verifyRecoveryCode({ email: EMAIL, code: codes[0] })).ok).toBe(true);
    // Only the first set's notice went out.
    expect(recoveryNotices.filter((n) => n.kind === "changed")).toHaveLength(1);
  });

  it("refuses sessions from before this feature (no email proof recorded)", async () => {
    const { editor, sessionId } = await editorWithSession();
    await db.update(sessions).set({ emailVerifiedAt: null }).where(eq(sessions.id, sessionId));
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId })).ok).toBe(false);
  });

  it("doesn't count a recovery-code sign-in as recent: it never touched the inbox", async () => {
    const { editor } = await editorWithCodes();
    const { token } = await createSession(editor.id, {}, { method: "recovery" });
    const recovery = (await validateSession(token))!;
    expect(await isSessionFresh(editor.id, recovery.sessionId)).toBe(false);
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId: recovery.sessionId })).ok).toBe(false);
  });

  it("refuses another editor's session id, and an expired session", async () => {
    const { editor } = await editorWithSession();
    const other = await editorWithSession("other@example.com");
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId: other.sessionId })).ok).toBe(false);
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(sessions.id, other.sessionId));
    expect((await generateRecoveryCodes({ editorId: other.editor.id, sessionId: other.sessionId })).ok).toBe(false);
  });

  it("an emailed confirmation code makes an old session fresh again", async () => {
    const { editor, sessionId } = await editorWithSession();
    await age(sessionId);
    expect(await requestStepUpCode({ editorId: editor.id, sessionId })).toMatchObject({ ok: true, email: EMAIL });
    const code = lastStepUpCodeFor(EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    // Stored only as a keyed hash, bound to the session.
    const [row] = await db.select().from(stepUpRows);
    expect(row.codeHash).toBe(hmac("step-up", `${sessionId}:${code}`));
    // It's a confirmation email, not a sign-in email: no sign-in code or link went out.
    expect(outbox).toHaveLength(0);

    expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code })).toEqual({ ok: true });
    expect(await isSessionFresh(editor.id, sessionId)).toBe(true);
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId })).ok).toBe(true);
    // Single use.
    expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code })).toMatchObject({ ok: false });
  });

  it("works after a recovery-code sign-in too (that's how such a session can make codes)", async () => {
    const { editor } = await editorWithCodes();
    const { token } = await createSession(editor.id, {}, { method: "recovery" });
    const { sessionId } = (await validateSession(token))!;
    await requestStepUpCode({ editorId: editor.id, sessionId });
    expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code: lastStepUpCodeFor(EMAIL) })).toEqual({ ok: true });
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId })).ok).toBe(true);
  });

  it("binds the code to the session that asked: another session (or editor) can't use it", async () => {
    const { editor, sessionId } = await editorWithSession();
    const { token } = await createSession(editor.id);
    const second = (await validateSession(token))!.sessionId;
    await age(sessionId);
    await age(second);
    await requestStepUpCode({ editorId: editor.id, sessionId });
    const code = lastStepUpCodeFor(EMAIL);
    expect(await verifyStepUpCode({ editorId: editor.id, sessionId: second, code })).toMatchObject({ ok: false });
    const other = await editorWithSession("other@example.com");
    expect(await verifyStepUpCode({ editorId: other.editor.id, sessionId, code })).toMatchObject({ ok: false });
    expect(await isSessionFresh(editor.id, second)).toBe(false);
    expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code })).toEqual({ ok: true });
  });

  it("counts attempts before comparing, and locks the code after too many", async () => {
    const { editor, sessionId } = await editorWithSession();
    await age(sessionId);
    await requestStepUpCode({ editorId: editor.id, sessionId });
    const code = lastStepUpCodeFor(EMAIL);
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(
      Array.from({ length: 12 }, () => verifyStepUpCode({ editorId: editor.id, sessionId, code: wrong })),
    );
    const [row] = await db.select().from(stepUpRows);
    expect(row.attempts).toBe(STEP_UP_MAX_ATTEMPTS);
    expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code })).toEqual({
      ok: false,
      error: "too_many_attempts",
    });
    expect(await isSessionFresh(editor.id, sessionId)).toBe(false);
  });

  it("only the newest code works, and resends wait out a cooldown", async () => {
    const { editor, sessionId } = await editorWithSession();
    await requestStepUpCode({ editorId: editor.id, sessionId });
    const first = lastStepUpCodeFor(EMAIL);
    expect(await requestStepUpCode({ editorId: editor.id, sessionId })).toMatchObject({ ok: false, error: "rate_limited" });
    await db.execute(sql`DELETE FROM rate_limits WHERE key LIKE 'stepup:cooldown:%'`);
    await requestStepUpCode({ editorId: editor.id, sessionId });
    const second = lastStepUpCodeFor(EMAIL);
    expect(stepUpCodes).toHaveLength(2);
    if (first !== second) {
      expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code: first })).toMatchObject({ ok: false });
    }
    expect(await verifyStepUpCode({ editorId: editor.id, sessionId, code: second })).toEqual({ ok: true });
  });

  it("won't send a code for another editor's session", async () => {
    const { sessionId } = await editorWithSession();
    const other = await editorWithSession("other@example.com");
    expect(await requestStepUpCode({ editorId: other.editor.id, sessionId })).toEqual({ ok: false, error: "no_session" });
    expect(stepUpCodes).toHaveLength(0);
  });
});

describe("verifyRecoveryCode", () => {
  it("signs in with a code, uses it up, and reports how many are left", async () => {
    const { editor, codes } = await editorWithCodes();
    const res = await verifyRecoveryCode({ email: EMAIL, code: codes[3], ip: "203.0.113.4", userAgent: UA });
    expect(res).toMatchObject({ ok: true, remaining: 9 });
    if (!res.ok) return;
    expect(res.editor.id).toBe(editor.id);
    expect(res.editor.lastSignInAt).toBeInstanceOf(Date);
    expect(await getRecoveryCodeStatus(editor.id)).toMatchObject({ total: 10, unused: 9 });
  });

  it("accepts the code however it's typed", async () => {
    const { codes } = await editorWithCodes();
    const messy = ` ${formatRecoveryCode(codes[0]).toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace("-", " ")} `;
    expect((await verifyRecoveryCode({ email: " Keeper@Example.COM ", code: messy })).ok).toBe(true);
  });

  it("is single use", async () => {
    const { codes } = await editorWithCodes();
    expect((await verifyRecoveryCode({ email: EMAIL, code: codes[0] })).ok).toBe(true);
    expect(await verifyRecoveryCode({ email: EMAIL, code: codes[0] })).toEqual({ ok: false, error: "invalid" });
  });

  it("lets only one of several concurrent attempts with the same code in", async () => {
    const { editor, codes } = await editorWithCodes();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => verifyRecoveryCode({ email: EMAIL, code: codes[5] })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual(Array(5).fill({ ok: false, error: "invalid" }));
    expect((await getRecoveryCodeStatus(editor.id)).unused).toBe(9);
    expect(recoveryNotices.filter((n) => n.kind === "used")).toHaveLength(1);
  });

  it("different codes used at once each work once", async () => {
    const { editor, codes } = await editorWithCodes();
    const results = await Promise.all(codes.slice(0, 4).map((code) => verifyRecoveryCode({ email: EMAIL, code })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await getRecoveryCodeStatus(editor.id)).unused).toBe(6);
  });

  it("refuses a code that belongs to another editor", async () => {
    const { codes } = await editorWithCodes();
    await editorWithCodes("other@example.com");
    expect(await verifyRecoveryCode({ email: "other@example.com", code: codes[0] })).toEqual({ ok: false, error: "invalid" });
  });

  it("emails a notice with the device, time and codes left, counting down to none", async () => {
    const { codes } = await editorWithCodes();
    recoveryNotices.length = 0;
    for (const code of codes) await verifyRecoveryCode({ email: EMAIL, code, userAgent: UA });
    expect(recoveryNotices.map((n) => (n.kind === "used" ? n.remaining : null))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(recoveryNotices[0]).toMatchObject({ to: EMAIL, kind: "used", device: "Firefox on Windows", penName: `Poet ${EMAIL}` });
    expect(recoveryNotices[0].at).toBeInstanceOf(Date);
  });

  it("sends nothing for a failed attempt", async () => {
    const { codes } = await editorWithCodes();
    recoveryNotices.length = 0;
    await verifyRecoveryCode({ email: EMAIL, code: wrongCode(codes) });
    expect(recoveryNotices).toHaveLength(0);
  });
});

describe("no enumeration", () => {
  afterEach(() => {
    process.env.EDITOR_ALLOWLIST = "";
    resetEnvCache();
  });

  it("answers an unknown email, an editor without codes, a not-allowed editor and a wrong code the same way, through the same limits", async () => {
    const { codes } = await editorWithCodes("coded@poets.org");
    await editorWithSession("nocodes@poets.org");
    await editorWithCodes("blocked@example.com");
    process.env.EDITOR_ALLOWLIST = "@poets.org";
    resetEnvCache();

    const guess = wrongCode(codes);
    const cases = {
      unknown: "nobody@poets.org",
      noCodes: "nocodes@poets.org",
      notAllowed: "blocked@example.com",
      wrongCode: "coded@poets.org",
    };
    const keysFor: Record<string, string[]> = {};
    for (const [name, email] of Object.entries(cases)) {
      await clearLimits();
      expect(await verifyRecoveryCode({ email, code: guess, ip: "198.51.100.20" }), name).toEqual({
        ok: false,
        error: "invalid",
      });
      // The same five counters, with only the hashed email differing.
      keysFor[name] = (await limitKeys()).map((k) => k.replace(/[0-9a-f]{64}/, "<email>"));
    }
    for (const keys of Object.values(keysFor)) expect(keys).toEqual(keysFor.unknown);
    expect(keysFor.unknown).toHaveLength(5);

    // A not-allowed editor's real code doesn't work either, and looks the same.
    const blocked = await db.select().from(editors).where(eq(editors.email, "blocked@example.com"));
    expect(blocked).toHaveLength(1);
    expect(recoveryNotices.filter((n) => n.kind === "used")).toHaveLength(0);
  });

  it("rate limits unknown emails exactly like real ones", async () => {
    const { codes } = await editorWithCodes();
    const guess = wrongCode(codes);
    const run = async (email: string) => {
      await clearLimits();
      const out: string[] = [];
      for (let i = 0; i <= RECOVERY_LIMITS.perEmailClientHour; i++) {
        const r = await verifyRecoveryCode({ email, code: guess, ip: "198.51.100.30" });
        out.push(r.ok ? "ok" : r.error);
      }
      return out;
    };
    const real = await run(EMAIL);
    expect(await run("ghost@example.com")).toEqual(real);
    expect(real.at(-1)).toBe("rate_limited");
  });
});

describe("rate limits", () => {
  it("count a guess before comparing it: an over-limit client is refused even with a right code", async () => {
    const { codes } = await editorWithCodes();
    const ip = "198.51.100.66";
    for (let i = 0; i < RECOVERY_LIMITS.perEmailClientHour; i++) {
      expect(await verifyRecoveryCode({ email: EMAIL, code: wrongCode(codes), ip })).toEqual({ ok: false, error: "invalid" });
    }
    expect(await verifyRecoveryCode({ email: EMAIL, code: codes[0], ip })).toMatchObject({ ok: false, error: "rate_limited" });
    // ...and that right code wasn't used up.
    expect(await verifyRecoveryCode({ email: EMAIL, code: codes[0], ip: "203.0.113.5" })).toMatchObject({ ok: true });
  });

  it("one client over its budget can't lock the editor out", async () => {
    const { codes } = await editorWithCodes();
    const attacker = "198.51.100.66";
    for (let i = 0; i < 60; i++) await verifyRecoveryCode({ email: EMAIL, code: wrongCode(codes), ip: attacker });
    // Blocked guesses never reached the shared per-email tier.
    const [{ count }] = (
      (await db.execute(sql`SELECT count FROM rate_limits WHERE key LIKE 'recovery:verify:email:h:%'`)) as unknown as {
        rows: { count: number }[];
      }
    ).rows;
    expect(count).toBe(RECOVERY_LIMITS.perEmailClientHour);
    expect(await verifyRecoveryCode({ email: EMAIL, code: codes[1], ip: "203.0.113.5" })).toMatchObject({ ok: true });
  });

  it("caps guesses per email across rotating clients", async () => {
    const { codes } = await editorWithCodes();
    let n = 0;
    let blocked = false;
    while (!blocked && n < 100) {
      const r = await verifyRecoveryCode({ email: EMAIL, code: wrongCode(codes), ip: `198.51.${100 + (n >> 8)}.${n & 255}` });
      n++;
      blocked = !r.ok && r.error === "rate_limited";
    }
    expect(n).toBe(RECOVERY_LIMITS.perEmailHour + 1);
    // While the backstop holds, even a right code from a fresh client is refused.
    expect(await verifyRecoveryCode({ email: EMAIL, code: codes[0], ip: "203.0.113.77" })).toMatchObject({
      error: "rate_limited",
    });
  });

  it("limits attempts per client across emails", async () => {
    for (let i = 0; i < RECOVERY_LIMITS.perIp; i++) {
      await verifyRecoveryCode({ email: `x${i}@example.com`, code: "AAAA-BBBB-CCCC", ip: "198.51.100.7" });
    }
    expect(await verifyRecoveryCode({ email: EMAIL, code: "AAAA-BBBB-CCCC", ip: "198.51.100.7" })).toMatchObject({
      error: "rate_limited",
    });
  });

  it("keeps its counters apart from email sign-in codes", async () => {
    await verifyRecoveryCode({ email: EMAIL, code: "AAAA-BBBB-CCCC", ip: "198.51.100.8" });
    expect((await limitKeys()).every((k) => k.startsWith("recovery:verify:"))).toBe(true);
  });
});

describe("recovery code status", () => {
  it("reports none, then the count left and when the set was made", async () => {
    const { editor } = await editorWithSession();
    expect(await getRecoveryCodeStatus(editor.id)).toEqual({
      total: 0,
      unused: 0,
      createdAt: null,
      promptDismissed: false,
    });
    const res = await generateRecoveryCodes({ editorId: editor.id, sessionId: (await editorSession(editor.id))! });
    if (!res.ok) throw new Error("expected codes");
    for (const code of res.codes.slice(0, 8)) await verifyRecoveryCode({ email: EMAIL, code });
    const status = await getRecoveryCodeStatus(editor.id);
    expect(status).toMatchObject({ total: 10, unused: 2 });
    expect(status.createdAt).toBeInstanceOf(Date);
  });

  it("is per editor", async () => {
    await editorWithCodes();
    const other = await editorWithSession("other@example.com");
    expect(await getRecoveryCodeStatus(other.editor.id)).toMatchObject({ total: 0, unused: 0 });
  });

  it("remembers 'Not now' on the server, once", async () => {
    const { editor } = await editorWithSession();
    await dismissRecoveryPrompt(editor.id);
    const [first] = await db.select().from(editors).where(eq(editors.id, editor.id));
    await dismissRecoveryPrompt(editor.id);
    const [second] = await db.select().from(editors).where(eq(editors.id, editor.id));
    expect(second.recoveryPromptDismissedAt).toEqual(first.recoveryPromptDismissedAt);
    expect((await getRecoveryCodeStatus(editor.id)).promptDismissed).toBe(true);
  });

  async function editorSession(editorId: string) {
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.editorId, editorId));
    return row?.id;
  }
});

describe("public-device sessions", () => {
  it("last 12 hours instead of 30 days, and show up as public in the device list", async () => {
    const { editor, sessionId } = await editorWithSession(EMAIL, { publicDevice: true });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    const ttl = (row.expiresAt.getTime() - row.createdAt.getTime()) / 1000;
    expect(Math.abs(ttl - PUBLIC_SESSION_TTL_SECONDS)).toBeLessThan(5);
    expect(row.publicDevice).toBe(true);

    const { token } = await createSession(editor.id);
    const [mine] = await db.select().from(sessions).where(eq(sessions.id, (await validateSession(token))!.sessionId));
    expect((mine.expiresAt.getTime() - mine.createdAt.getTime()) / 1000).toBeGreaterThan(29 * 86400);

    const list = await listSessions(editor.id, sessionId);
    expect(list.map((s) => [s.publicDevice, s.method])).toEqual([
      [true, "email"],
      [false, "email"],
    ]);
  });

  it("record how the editor signed in", async () => {
    const { editor, sessionId } = await editorWithSession(EMAIL, { publicDevice: true, method: "recovery" });
    const [s] = await listSessions(editor.id, sessionId);
    expect(s).toMatchObject({ publicDevice: true, method: "recovery", current: true });
    expect(Object.keys(s)).not.toContain("tokenHash");
  });
});
