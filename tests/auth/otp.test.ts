import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, emailOtps } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { OTP_MAX_ATTEMPTS, requestOtp, verifyOtp } from "@/server/auth/otp";
import { lastCodeFor, outbox } from "../support/outbox";

const db = getDb();
const EMAIL = "poet@example.com";

/** Let the next code request through the 60s resend cooldown. */
async function skipCooldown() {
  await db.execute(sql`DELETE FROM rate_limits WHERE key LIKE 'otp:cooldown:%'`);
}

async function signIn(email = EMAIL) {
  const req = await requestOtp({ email });
  expect(req.ok).toBe(true);
  return verifyOtp({ email, code: lastCodeFor(email) });
}

const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe("requestOtp", () => {
  it("emails a 6-digit code and stores only its hash", async () => {
    const res = await requestOtp({ email: EMAIL });
    expect(res).toMatchObject({ ok: true, email: EMAIL });
    const code = lastCodeFor(EMAIL);
    expect(code).toMatch(/^\d{6}$/);

    const rows = await db.select().from(emailOtps);
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toContain(code);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid emails", async () => {
    expect(await requestOtp({ email: "not-an-email" })).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(outbox).toHaveLength(0);
  });

  it("enforces a resend cooldown", async () => {
    await requestOtp({ email: EMAIL });
    const second = await requestOtp({ email: EMAIL });
    expect(second).toMatchObject({ ok: false, error: "rate_limited" });
    expect(outbox).toHaveLength(1);
  });

  it("limits requests per email over 15 minutes", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await requestOtp({ email: EMAIL })).ok).toBe(true);
      await skipCooldown();
    }
    expect(await requestOtp({ email: EMAIL })).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
  });

  it("puts requests without a known IP into a shared bucket", async () => {
    for (let i = 0; i < 20; i++) await requestOtp({ email: `n${i}@example.com`, ip: null });
    expect(await requestOtp({ email: "last@example.com" })).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
  });

  it("limits requests per IP across different emails", async () => {
    for (let i = 0; i < 20; i++) {
      await requestOtp({ email: `p${i}@example.com`, ip: "203.0.113.9" });
    }
    expect(
      await requestOtp({ email: "another@example.com", ip: "203.0.113.9" }),
    ).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("invalidates the previous code when a new one is issued", async () => {
    await requestOtp({ email: EMAIL });
    const first = lastCodeFor(EMAIL);
    await skipCooldown();
    await requestOtp({ email: EMAIL });
    const second = lastCodeFor(EMAIL);

    if (first !== second) {
      expect(await verifyOtp({ email: EMAIL, code: first })).toMatchObject({
        ok: false,
      });
    }
    expect(await verifyOtp({ email: EMAIL, code: second })).toMatchObject({
      ok: true,
    });
  });
});

describe("verifyOtp", () => {
  it("creates the editor on first sign-in", async () => {
    const res = await signIn();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.editor.email).toBe(EMAIL);
    expect(res.editor.penName).toBeNull();
    expect(res.editor.lastSignInAt).toBeInstanceOf(Date);
  });

  it("reuses the same editor on later sign-ins, with a fresh code", async () => {
    const first = await signIn();
    await skipCooldown();
    const second = await signIn();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.editor.id).toBe(first.editor.id);
    expect(await db.select().from(editors)).toHaveLength(1);
    expect(outbox).toHaveLength(2);
  });

  it("treats email case-insensitively", async () => {
    await requestOtp({ email: "Poet@Example.com" });
    const res = await verifyOtp({ email: "POET@example.COM", code: lastCodeFor(EMAIL) });
    expect(res.ok).toBe(true);
  });

  it("is single use", async () => {
    await requestOtp({ email: EMAIL });
    const code = lastCodeFor(EMAIL);
    expect((await verifyOtp({ email: EMAIL, code })).ok).toBe(true);
    expect(await verifyOtp({ email: EMAIL, code })).toMatchObject({
      ok: false,
      error: "invalid_code",
    });
  });

  it("rejects a code for a different email", async () => {
    await requestOtp({ email: EMAIL });
    await requestOtp({ email: "other@example.com" });
    const res = await verifyOtp({
      email: "other@example.com",
      code: lastCodeFor(EMAIL),
    });
    // Could only succeed if both codes happened to collide.
    if (lastCodeFor(EMAIL) !== lastCodeFor("other@example.com")) {
      expect(res.ok).toBe(false);
    }
  });

  it("rejects expired codes", async () => {
    await requestOtp({ email: EMAIL });
    await db.update(emailOtps).set({ expiresAt: sql`now() - interval '1 second'` });
    expect(
      await verifyOtp({ email: EMAIL, code: lastCodeFor(EMAIL) }),
    ).toMatchObject({ ok: false, error: "invalid_code" });
  });

  it("locks the code after too many wrong attempts", async () => {
    await requestOtp({ email: EMAIL });
    const code = lastCodeFor(EMAIL);

    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await verifyOtp({ email: EMAIL, code: wrong(code) })).toEqual({
        ok: false,
        error: "invalid_code",
        attemptsLeft: OTP_MAX_ATTEMPTS - i,
      });
    }
    expect(await verifyOtp({ email: EMAIL, code: wrong(code) })).toEqual({
      ok: false,
      error: "too_many_attempts",
    });
    // Even the right code is now useless.
    expect((await verifyOtp({ email: EMAIL, code })).ok).toBe(false);
  });

  it("never exceeds the attempt limit under concurrent guessing", async () => {
    await requestOtp({ email: EMAIL });
    const code = lastCodeFor(EMAIL);
    await Promise.all(
      Array.from({ length: 15 }, () => verifyOtp({ email: EMAIL, code: wrong(code) })),
    );
    const [row] = await db.select().from(emailOtps);
    expect(row.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(row.consumedAt).not.toBeNull();
  });

  it("lets only one concurrent request redeem a code", async () => {
    await requestOtp({ email: EMAIL });
    const code = lastCodeFor(EMAIL);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verifyOtp({ email: EMAIL, code })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it.each(["", "12345", "1234567", "abcdef", 123456, null])(
    "rejects malformed code %p",
    async (code) => {
      await requestOtp({ email: EMAIL });
      expect(await verifyOtp({ email: EMAIL, code })).toEqual({
        ok: false,
        error: "invalid_code",
      });
    },
  );

  it("caps guesses per email across codes and IPs", async () => {
    // Attacker loop: request a code, burn its 5 attempts, repeat, rotating IPs.
    let blocked: unknown;
    for (let round = 0; round < 3 && !blocked; round++) {
      await skipCooldown();
      await requestOtp({ email: EMAIL, ip: `192.0.2.${round}` });
      const code = lastCodeFor(EMAIL);
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        const res = await verifyOtp({ email: EMAIL, code: wrong(code), ip: `198.51.100.${round * 10 + i}` });
        if (!res.ok && res.error === "rate_limited") { blocked = res; break; }
      }
    }
    expect(blocked).toMatchObject({ ok: false, error: "rate_limited" });
    // ...and the right code is refused while the cap holds.
    await skipCooldown();
    await requestOtp({ email: EMAIL });
    expect(await verifyOtp({ email: EMAIL, code: lastCodeFor(EMAIL) })).toMatchObject({
      error: "rate_limited",
    });
  });

  it("rate limits verification attempts per IP", async () => {
    for (let i = 0; i < 30; i++) {
      await verifyOtp({ email: `x${i}@example.com`, code: "123456", ip: "198.51.100.7" });
    }
    expect(
      await verifyOtp({ email: EMAIL, code: "123456", ip: "198.51.100.7" }),
    ).toMatchObject({ ok: false, error: "rate_limited" });
  });
});

describe("allowlist", () => {
  afterEach(() => {
    process.env.EDITOR_ALLOWLIST = "";
    resetEnvCache();
  });

  it("silently refuses non-allowed emails with the same response", async () => {
    process.env.EDITOR_ALLOWLIST = "@poets.org";
    resetEnvCache();

    const allowed = await requestOtp({ email: "ada@poets.org" });
    const denied = await requestOtp({ email: "eve@example.com" });
    expect(allowed).toEqual({ ok: true, email: "ada@poets.org", resendIn: 60 });
    expect(denied).toEqual({ ok: true, email: "eve@example.com", resendIn: 60 });

    // ...but only the allowed one actually got a code.
    expect(outbox.map((m) => m.to)).toEqual(["ada@poets.org"]);

    // A wrong guess looks identical for both (attempts are counted on a decoy).
    expect(await verifyOtp({ email: "eve@example.com", code: "123456" })).toEqual({
      ok: false,
      error: "invalid_code",
      attemptsLeft: 4,
    });
    const adaWrong = wrong(lastCodeFor("ada@poets.org"));
    expect(await verifyOtp({ email: "ada@poets.org", code: adaWrong })).toEqual({
      ok: false,
      error: "invalid_code",
      attemptsLeft: 4,
    });

    // Cooldown behaves the same for both, too.
    expect(await requestOtp({ email: "ada@poets.org" })).toMatchObject({ error: "rate_limited" });
    expect(await requestOtp({ email: "eve@example.com" })).toMatchObject({ error: "rate_limited" });

    expect((await verifyOtp({ email: "ada@poets.org", code: lastCodeFor("ada@poets.org") })).ok).toBe(true);
    const rows = await db.select().from(editors).where(eq(editors.email, "eve@example.com"));
    expect(rows).toHaveLength(0);
  });
});
