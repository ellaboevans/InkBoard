import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, passkeys, sessions, webauthnChallenges } from "@/db/schema";
import { resetEnvCache } from "@/env";
import {
  PASSKEY_LIMITS,
  RECOVERY_PASSKEY_WINDOW_SECONDS,
  dismissPasskeyOffer,
  finishPasskeyRegistration,
  finishPasskeySignIn,
  finishPasskeyStepUp,
  listPasskeys,
  passkeyGate,
  removePasskey,
  renamePasskey,
  shouldOfferPasskey,
  startPasskeyRegistration,
  startPasskeySignIn,
  startPasskeyStepUp,
  takeChallenge,
} from "@/server/auth/passkeys";
import { generateRecoveryCodes } from "@/server/auth/recovery-codes";
import { createSession, listSessions, validateSession, type SessionOptions } from "@/server/auth/sessions";
import { STEP_UP_WINDOW_SECONDS, isSessionFresh } from "@/server/auth/step-up";
import type { RelyingParty } from "@/server/auth/webauthn-config";
import { FakeAuthenticator } from "../support/fake-authenticator";
import { passkeyNotices } from "../support/outbox";

const db = getDb();
const RP: RelyingParty = { id: "inkboard.test", name: "InkBoard", origin: "https://inkboard.test" };
const EMAIL = "keyholder@example.com";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function makeEditor(email = EMAIL) {
  const [editor] = await db
    .insert(editors)
    .values({ email, penName: `Poet ${email.split("@")[0]}`, slug: email.split("@")[0] })
    .returning();
  return editor;
}

async function sessionFor(editorId: string, options: SessionOptions = {}) {
  const { token } = await createSession(editorId, { userAgent: MAC }, options);
  return (await validateSession(token))!.sessionId;
}

/** An editor with a fresh email session. */
async function signedIn(email = EMAIL, options: SessionOptions = {}) {
  const editor = await makeEditor(email);
  return { editor, sessionId: await sessionFor(editor.id, options) };
}

const age = (sessionId: string, column: "email_verified_at" | "created_at", seconds: number) =>
  db.execute(
    sql`UPDATE sessions SET ${sql.raw(column)} = now() - make_interval(secs => ${seconds}) WHERE id = ${sessionId}`,
  );

/** Register a software passkey for this editor through the real start/finish pair. */
async function addPasskey(editorId: string, sessionId: string, auth = new FakeAuthenticator()) {
  const start = await startPasskeyRegistration({ editorId, sessionId, rp: RP });
  if (!start.ok) throw new Error(`start failed: ${start.error}`);
  const res = await finishPasskeyRegistration({
    editorId,
    sessionId,
    token: start.token,
    response: auth.register(start.options, { origin: RP.origin }),
    rp: RP,
    userAgent: MAC,
  });
  if (!res.ok) throw new Error(`finish failed: ${res.error}`);
  return { auth, passkey: res.passkey };
}

/** One usernameless sign-in attempt with this authenticator. */
async function signIn(auth: FakeAuthenticator, tweak: Parameters<FakeAuthenticator["assert"]>[1] = { origin: RP.origin }, ip = "203.0.113.9") {
  const start = await startPasskeySignIn({ rp: RP, ip });
  if (!start.ok) throw new Error("start failed");
  return finishPasskeySignIn({ token: start.token, response: auth.assert(start.options, tweak), rp: RP, ip });
}

describe("registration", () => {
  it("asks for a discoverable credential with user verification preferred, for an opaque user handle", async () => {
    const { editor, sessionId } = await signedIn();
    const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.options.rp).toEqual({ id: "inkboard.test", name: "InkBoard" });
    expect(start.options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "preferred",
    });
    expect(start.options.attestation).toBe("none");
    expect(start.options.excludeCredentials).toEqual([]);
    const [row] = await db.select().from(editors).where(eq(editors.id, editor.id));
    expect(start.options.user.id).toBe(row.webauthnUserId);
    expect(start.options.user.id).not.toContain(editor.id);
    expect(start.options.user.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The challenge is stored server-side; the browser only gets a token for it.
    const [challenge] = await db.select().from(webauthnChallenges);
    expect(challenge).toMatchObject({ purpose: "registration", editorId: editor.id, sessionId, challenge: start.options.challenge });
    expect(challenge.tokenHash).not.toBe(start.token);
  });

  it("stores only public data, named after the device, and emails a notice", async () => {
    const { editor, sessionId } = await signedIn();
    const auth = new FakeAuthenticator({ synced: true });
    const { passkey } = await addPasskey(editor.id, sessionId, auth);
    expect(passkey).toMatchObject({ name: "Chrome on macOS", backedUp: true, deviceType: "multiDevice", lastUsedAt: null });
    const [row] = await db.select().from(passkeys);
    expect(row.credentialId).toBe(auth.id);
    expect(row.transports).toEqual(["internal"]);
    expect(row.counter).toBe(0);
    expect(Object.keys(row).sort()).toEqual(
      ["backedUp", "counter", "createdAt", "credentialId", "deviceType", "editorId", "id", "lastUsedAt", "name", "publicKey", "transports"],
    );
    expect(passkeyNotices).toEqual([
      expect.objectContaining({ to: EMAIL, kind: "added", passkeyName: "Chrome on macOS", device: "Chrome on macOS", afterRecovery: false }),
    ]);
  });

  it("keeps the same user handle and excludes the editor's existing passkeys", async () => {
    const { editor, sessionId } = await signedIn();
    const first = await addPasskey(editor.id, sessionId);
    const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    expect(start.options.user.id).toBe(first.auth.userHandle);
    expect(start.options.excludeCredentials).toEqual([{ id: first.auth.id, type: "public-key", transports: ["internal"] }]);
  });

  it("refuses a credential that's already registered, even to another editor", async () => {
    const a = await signedIn();
    const b = await signedIn("other@example.com");
    const { auth } = await addPasskey(a.editor.id, a.sessionId);
    const start = await startPasskeyRegistration({ editorId: b.editor.id, sessionId: b.sessionId, rp: RP });
    if (!start.ok) throw new Error();
    const res = await finishPasskeyRegistration({
      editorId: b.editor.id,
      sessionId: b.sessionId,
      token: start.token,
      response: auth.register(start.options, { origin: RP.origin }),
      rp: RP,
    });
    expect(res).toEqual({ ok: false, error: "invalid" });
    const owners = await db.select({ editorId: passkeys.editorId }).from(passkeys);
    expect(owners).toEqual([{ editorId: a.editor.id }]);
  });

  it.each([
    ["the wrong origin", { origin: "https://evil.test" }],
    ["the wrong RP ID", { origin: RP.origin, rpId: "evil.test" }],
    ["another challenge", { origin: RP.origin, challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
  ])("rejects a response for %s", async (_, tweak) => {
    const { editor, sessionId } = await signedIn();
    const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    const res = await finishPasskeyRegistration({
      editorId: editor.id,
      sessionId,
      token: start.token,
      response: new FakeAuthenticator().register(start.options, tweak),
      rp: RP,
    });
    expect(res).toEqual({ ok: false, error: "invalid" });
    expect(await db.select().from(passkeys)).toHaveLength(0);
    expect(passkeyNotices).toHaveLength(0);
  });

  it.each([null, "junk", {}, { id: "x", rawId: "y", type: "public-key", response: {} }, { id: "a b", rawId: "a b", type: "public-key", response: { clientDataJSON: "x", attestationObject: "y" } }])(
    "rejects malformed response %p",
    async (response) => {
      const { editor, sessionId } = await signedIn();
      const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
      if (!start.ok) throw new Error();
      expect(
        await finishPasskeyRegistration({ editorId: editor.id, sessionId, token: start.token, response, rp: RP }),
      ).toEqual({ ok: false, error: "invalid" });
    },
  );
});

describe("challenges", () => {
  it("work once: the same token can't finish twice", async () => {
    const { editor, sessionId } = await signedIn();
    const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    const response = new FakeAuthenticator().register(start.options, { origin: RP.origin });
    const finish = () => finishPasskeyRegistration({ editorId: editor.id, sessionId, token: start.token, response, rp: RP });
    expect((await finish()).ok).toBe(true);
    expect(await finish()).toEqual({ ok: false, error: "invalid" });
  });

  it("work once under concurrency too", async () => {
    await signedIn();
    const auth = await (async () => {
      const { editor, sessionId } = await signedIn("signer@example.com");
      return (await addPasskey(editor.id, sessionId, new FakeAuthenticator({ counting: false }))).auth;
    })();
    const start = await startPasskeySignIn({ rp: RP });
    if (!start.ok) throw new Error();
    const response = auth.assert(start.options, { origin: RP.origin });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => finishPasskeySignIn({ token: start.token, response, rp: RP })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("are used up by a failed attempt as well", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    const start = await startPasskeySignIn({ rp: RP });
    if (!start.ok) throw new Error();
    const bad = auth.assert(start.options, { origin: "https://evil.test" });
    expect(await finishPasskeySignIn({ token: start.token, response: bad, rp: RP })).toEqual({ ok: false, error: "invalid" });
    const good = auth.assert(start.options, { origin: RP.origin });
    expect(await finishPasskeySignIn({ token: start.token, response: good, rp: RP })).toEqual({ ok: false, error: "invalid" });
    expect(await db.select().from(webauthnChallenges)).toHaveLength(0);
  });

  it("expire after about five minutes", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    const start = await startPasskeySignIn({ rp: RP });
    if (!start.ok) throw new Error();
    expect(start.options.timeout).toBe(300_000);
    const [row] = await db
      .select({ ttl: sql<number>`extract(epoch from expires_at - created_at)` })
      .from(webauthnChallenges);
    expect(Math.round(Number(row.ttl))).toBe(300);
    await db.update(webauthnChallenges).set({ expiresAt: sql`now() - interval '1 second'` });
    expect(
      await finishPasskeySignIn({ token: start.token, response: auth.assert(start.options, { origin: RP.origin }), rp: RP }),
    ).toEqual({ ok: false, error: "invalid" });
  });

  it("belong to the browser that asked: another token (or none) can't use them", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    const mine = await startPasskeySignIn({ rp: RP });
    const theirs = await startPasskeySignIn({ rp: RP });
    if (!mine.ok || !theirs.ok) throw new Error();
    const response = auth.assert(mine.options, { origin: RP.origin });
    expect(await finishPasskeySignIn({ token: theirs.token, response, rp: RP })).toEqual({ ok: false, error: "invalid" });
    expect(await finishPasskeySignIn({ token: null, response, rp: RP })).toEqual({ ok: false, error: "invalid" });
    expect((await finishPasskeySignIn({ token: mine.token, response, rp: RP })).ok).toBe(true);
  });

  it("for registration belong to the editor and session that asked, and the purpose", async () => {
    const { editor, sessionId } = await signedIn();
    const otherSession = await sessionFor(editor.id);
    const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    expect(await takeChallenge({ token: start.token, purpose: "registration", editorId: editor.id, sessionId: otherSession })).toBeNull();
    const again = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!again.ok) throw new Error();
    expect(await takeChallenge({ token: again.token, purpose: "authentication" })).toBeNull();
    const third = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!third.ok) throw new Error();
    expect(await takeChallenge({ token: third.token, purpose: "registration", editorId: editor.id, sessionId })).toBe(
      third.options.challenge,
    );
  });
});

describe("signing in", () => {
  it("signs in usernamelessly with user verification required, and records the use", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth, passkey } = await addPasskey(editor.id, sessionId);
    const start = await startPasskeySignIn({ rp: RP });
    if (!start.ok) throw new Error();
    expect(start.options.allowCredentials).toBeUndefined();
    expect(start.options.userVerification).toBe("required");
    expect(start.options.rpId).toBe(RP.id);
    const res = await finishPasskeySignIn({ token: start.token, response: auth.assert(start.options, { origin: RP.origin }), rp: RP });
    expect(res.ok && res.editor.id).toBe(editor.id);
    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkey.id));
    expect(row.counter).toBe(1);
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });

  it.each([
    ["no user verification", { origin: RP.origin, uv: false }],
    ["the wrong origin", { origin: "https://evil.test" }],
    ["a look-alike origin on another port", { origin: "https://inkboard.test:8443" }],
    ["the wrong RP ID", { origin: RP.origin, rpId: "evil.test" }],
    ["another challenge", { origin: RP.origin, challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
    ["someone else's user handle", { origin: RP.origin, userHandle: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
  ])("rejects %s with the one generic answer", async (_, tweak) => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    expect(await signIn(auth, tweak)).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects an unknown credential and a removed passkey the same way", async () => {
    const { editor, sessionId } = await signedIn();
    const stranger = new FakeAuthenticator();
    stranger.userHandle = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(await signIn(stranger)).toEqual({ ok: false, error: "invalid" });

    const { auth, passkey } = await addPasskey(editor.id, sessionId);
    expect((await signIn(auth)).ok).toBe(true);
    expect(await removePasskey({ editorId: editor.id, sessionId, id: passkey.id })).toEqual({ ok: true });
    expect(await signIn(auth)).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a forged signature", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    const start = await startPasskeySignIn({ rp: RP });
    if (!start.ok) throw new Error();
    const response = auth.assert(start.options, { origin: RP.origin });
    // Another key signs the same data: the stored public key doesn't match.
    const impostor = new FakeAuthenticator();
    const forged = impostor.assert(start.options, { origin: RP.origin, counter: auth.counter });
    response.response.signature = forged.response.signature;
    expect(await finishPasskeySignIn({ token: start.token, response, rp: RP })).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses an editor removed from the allowlist", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    process.env.EDITOR_ALLOWLIST = "@elsewhere.org";
    resetEnvCache();
    try {
      expect(await signIn(auth)).toEqual({ ok: false, error: "invalid" });
    } finally {
      process.env.EDITOR_ALLOWLIST = "";
      resetEnvCache();
    }
  });

  it("rate limits verification per client IP bucket, before looking at anything", async () => {
    const before = await db.execute(sql`SELECT 1`);
    expect(before).toBeTruthy();
    for (let i = 0; i < PASSKEY_LIMITS.signInVerifiesPerIp; i++) {
      await finishPasskeySignIn({ token: "nope-nope-nope-nope-nope", response: null, rp: RP, ip: "198.51.100.7" });
    }
    expect(
      await finishPasskeySignIn({ token: "nope-nope-nope-nope-nope", response: null, rp: RP, ip: "198.51.100.7" }),
    ).toMatchObject({ ok: false, error: "rate_limited" });
    // Same /64, other address: same bucket.
    for (let i = 0; i <= PASSKEY_LIMITS.signInVerifiesPerIp; i++) {
      await finishPasskeySignIn({ token: null, response: null, rp: RP, ip: `2001:db8:1:2::${i.toString(16)}` });
    }
    expect(await finishPasskeySignIn({ token: null, response: null, rp: RP, ip: "2001:db8:1:2::ffff" })).toMatchObject({
      error: "rate_limited",
    });
    // Another client is unaffected.
    expect(await finishPasskeySignIn({ token: null, response: null, rp: RP, ip: "203.0.113.200" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("rate limits sign-in options per client IP bucket too", async () => {
    for (let i = 0; i < PASSKEY_LIMITS.signInStartsPerIp; i++) await startPasskeySignIn({ rp: RP, ip: "198.51.100.8" });
    expect(await startPasskeySignIn({ rp: RP, ip: "198.51.100.8" })).toMatchObject({ ok: false, error: "rate_limited" });
  });
});

describe("the signature counter", () => {
  it("must go up: a replayed or rewound counter is refused", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth, passkey } = await addPasskey(editor.id, sessionId);
    expect((await signIn(auth, { origin: RP.origin, counter: 5 })).ok).toBe(true);
    expect(await signIn(auth, { origin: RP.origin, counter: 5 })).toEqual({ ok: false, error: "invalid" });
    expect(await signIn(auth, { origin: RP.origin, counter: 3 })).toEqual({ ok: false, error: "invalid" });
    expect((await signIn(auth, { origin: RP.origin, counter: 9 })).ok).toBe(true);
    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkey.id));
    expect(row.counter).toBe(9);
  });

  it("refuses a counter of zero once the authenticator has counted", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    expect((await signIn(auth)).ok).toBe(true);
    expect(await signIn(auth, { origin: RP.origin, counter: 0 })).toEqual({ ok: false, error: "invalid" });
  });

  it("allows authenticators that never count (synced passkeys report 0)", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId, new FakeAuthenticator({ counting: false, synced: true }));
    expect((await signIn(auth)).ok).toBe(true);
    expect((await signIn(auth)).ok).toBe(true);
  });

  it("lets only one of two simultaneous assertions with the same counter through", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    const [a, b] = await Promise.all([startPasskeySignIn({ rp: RP }), startPasskeySignIn({ rp: RP })]);
    if (!a.ok || !b.ok) throw new Error();
    const ra = auth.assert(a.options, { origin: RP.origin, counter: 7 });
    const rb = auth.assert(b.options, { origin: RP.origin, counter: 7 });
    const results = await Promise.all([
      finishPasskeySignIn({ token: a.token, response: ra, rp: RP }),
      finishPasskeySignIn({ token: b.token, response: rb, rp: RP }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("scoping", () => {
  it("lists, renames and removes only the editor's own passkeys; foreign and malformed ids look missing", async () => {
    const a = await signedIn();
    const b = await signedIn("other@example.com");
    const { passkey: mine } = await addPasskey(a.editor.id, a.sessionId);
    const { passkey: theirs } = await addPasskey(b.editor.id, b.sessionId);

    expect((await listPasskeys(a.editor.id)).map((p) => p.id)).toEqual([mine.id]);
    expect(Object.keys((await listPasskeys(a.editor.id))[0]).sort()).toEqual(
      ["backedUp", "createdAt", "deviceType", "id", "lastUsedAt", "name"],
    );

    expect(await renamePasskey(a.editor.id, theirs.id, "Mine now")).toEqual({ ok: false, error: "That passkey no longer exists." });
    expect(await renamePasskey(a.editor.id, "not-a-uuid'; drop table passkeys; --", "x")).toMatchObject({ ok: false });
    expect(await removePasskey({ editorId: a.editor.id, sessionId: a.sessionId, id: theirs.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await removePasskey({ editorId: a.editor.id, sessionId: a.sessionId, id: 42 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await listPasskeys(b.editor.id)).map((p) => [p.id, p.name])).toEqual([[theirs.id, "Chrome on macOS"]]);
  });

  it("renames with a normalised name, within limits", async () => {
    const { editor, sessionId } = await signedIn();
    const { passkey } = await addPasskey(editor.id, sessionId);
    expect(await renamePasskey(editor.id, passkey.id, "  Work\u0000  laptop \n")).toEqual({ ok: true, name: "Work laptop" });
    expect(await renamePasskey(editor.id, passkey.id, "   ")).toEqual({ ok: false, error: "Give the passkey a name" });
    expect(await renamePasskey(editor.id, passkey.id, "x".repeat(61))).toMatchObject({ ok: false });
    expect(await renamePasskey(editor.id, passkey.id, "Ɔdɔ’s MacBook")).toEqual({ ok: true, name: "Ɔdɔ’s MacBook" });
  });

  it("a passkey confirmation only accepts the editor's own passkey", async () => {
    const a = await signedIn();
    const b = await signedIn("other@example.com");
    await addPasskey(a.editor.id, a.sessionId);
    const { auth: theirs } = await addPasskey(b.editor.id, b.sessionId);
    await age(a.sessionId, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
    const start = await startPasskeyStepUp({ editorId: a.editor.id, sessionId: a.sessionId, rp: RP });
    if (!start.ok) throw new Error();
    const res = await finishPasskeyStepUp({
      editorId: a.editor.id,
      sessionId: a.sessionId,
      token: start.token,
      response: theirs.assert(start.options, { origin: RP.origin }),
      rp: RP,
    });
    expect(res).toEqual({ ok: false, error: "invalid" });
    expect(await isSessionFresh(a.editor.id, a.sessionId)).toBe(false);
  });
});

describe("step-up rules", () => {
  it("adds and removes freely within ten minutes of an email sign-in", async () => {
    const { editor, sessionId } = await signedIn();
    expect(await passkeyGate(editor.id, sessionId, "add")).toBe("fresh");
    const { passkey } = await addPasskey(editor.id, sessionId);
    expect(await removePasskey({ editorId: editor.id, sessionId, id: passkey.id })).toEqual({ ok: true });
  });

  it("needs a step-up after that, for adding and for removing", async () => {
    const { editor, sessionId } = await signedIn();
    const { passkey } = await addPasskey(editor.id, sessionId);
    await age(sessionId, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
    expect(await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP })).toEqual({
      ok: false,
      error: "step_up_required",
    });
    expect(await removePasskey({ editorId: editor.id, sessionId, id: passkey.id })).toEqual({
      ok: false,
      error: "step_up_required",
    });
    expect(await listPasskeys(editor.id)).toHaveLength(1);
  });

  it("re-checks at the finish: a session that aged mid-ceremony can't complete", async () => {
    const { editor, sessionId } = await signedIn();
    const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    await age(sessionId, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
    const res = await finishPasskeyRegistration({
      editorId: editor.id,
      sessionId,
      token: start.token,
      response: new FakeAuthenticator().register(start.options, { origin: RP.origin }),
      rp: RP,
    });
    expect(res).toEqual({ ok: false, error: "step_up_required" });
    expect(await db.select().from(passkeys)).toHaveLength(0);
  });

  it("a passkey confirmation makes an old session fresh (for passkeys and recovery codes alike)", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    await age(sessionId, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
    expect(await generateRecoveryCodes({ editorId: editor.id, sessionId })).toEqual({ ok: false, error: "step_up_required" });

    const start = await startPasskeyStepUp({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    expect(start.options.allowCredentials).toEqual([{ id: auth.id, type: "public-key", transports: ["internal"] }]);
    expect(start.options.userVerification).toBe("required");
    const res = await finishPasskeyStepUp({
      editorId: editor.id,
      sessionId,
      token: start.token,
      response: auth.assert(start.options, { origin: RP.origin }),
      rp: RP,
    });
    expect(res).toEqual({ ok: true });
    expect(await passkeyGate(editor.id, sessionId, "add")).toBe("fresh");
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId })).ok).toBe(true);
  });

  it("a passkey confirmation needs user verification", async () => {
    const { editor, sessionId } = await signedIn();
    const { auth } = await addPasskey(editor.id, sessionId);
    await age(sessionId, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
    const start = await startPasskeyStepUp({ editorId: editor.id, sessionId, rp: RP });
    if (!start.ok) throw new Error();
    const res = await finishPasskeyStepUp({
      editorId: editor.id,
      sessionId,
      token: start.token,
      response: auth.assert(start.options, { origin: RP.origin, uv: false }),
      rp: RP,
    });
    expect(res).toEqual({ ok: false, error: "invalid" });
  });

  it("there's nothing to confirm with before the first passkey", async () => {
    const { editor, sessionId } = await signedIn();
    expect(await startPasskeyStepUp({ editorId: editor.id, sessionId, rp: RP })).toEqual({ ok: false, error: "no_passkeys" });
  });

  it("a passkey sign-in counts as a recent verification", async () => {
    const editor = await makeEditor();
    const sessionId = await sessionFor(editor.id, { method: "passkey" });
    expect(await isSessionFresh(editor.id, sessionId)).toBe(true);
    expect(await passkeyGate(editor.id, sessionId, "add")).toBe("fresh");
    expect((await generateRecoveryCodes({ editorId: editor.id, sessionId })).ok).toBe(true);
    await db.execute(sql`UPDATE sessions SET passkey_verified_at = now() - interval '11 minutes' WHERE id = ${sessionId}`);
    expect(await isSessionFresh(editor.id, sessionId)).toBe(false);
  });

  describe("the recovery-code exception", () => {
    it("lets a session started with a recovery code add a passkey within ten minutes, and says so in the email", async () => {
      const editor = await makeEditor();
      const sessionId = await sessionFor(editor.id, { method: "recovery" });
      expect(await isSessionFresh(editor.id, sessionId)).toBe(false);
      expect(await passkeyGate(editor.id, sessionId, "add")).toBe("recovery");
      await addPasskey(editor.id, sessionId);
      expect(passkeyNotices).toEqual([expect.objectContaining({ kind: "added", afterRecovery: true })]);
    });

    it("ends ten minutes after the sign-in", async () => {
      const editor = await makeEditor();
      const sessionId = await sessionFor(editor.id, { method: "recovery" });
      await age(sessionId, "created_at", RECOVERY_PASSKEY_WINDOW_SECONDS + 1);
      expect(await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP })).toEqual({
        ok: false,
        error: "step_up_required",
      });
    });

    it("covers adding only: not removing, not recovery codes", async () => {
      const editor = await makeEditor();
      const sessionId = await sessionFor(editor.id, { method: "recovery" });
      const { passkey } = await addPasskey(editor.id, sessionId);
      expect(await removePasskey({ editorId: editor.id, sessionId, id: passkey.id })).toEqual({
        ok: false,
        error: "step_up_required",
      });
      expect(await generateRecoveryCodes({ editorId: editor.id, sessionId })).toEqual({
        ok: false,
        error: "step_up_required",
      });
    });

    it("is for that session only, not another session of the same editor", async () => {
      const editor = await makeEditor();
      await sessionFor(editor.id, { method: "recovery" });
      const emailSession = await sessionFor(editor.id);
      await age(emailSession, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
      expect(await passkeyGate(editor.id, emailSession, "add")).toBe("step_up_required");
    });
  });

  describe("public devices", () => {
    it("can never add a passkey, even straight after signing in by email", async () => {
      const { editor, sessionId } = await signedIn(EMAIL, { publicDevice: true });
      expect(await isSessionFresh(editor.id, sessionId)).toBe(true);
      expect(await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP })).toEqual({
        ok: false,
        error: "public_device",
      });
    });

    it("can't, after a recovery-code sign-in either", async () => {
      const editor = await makeEditor();
      const sessionId = await sessionFor(editor.id, { method: "recovery", publicDevice: true });
      expect(await passkeyGate(editor.id, sessionId, "add")).toBe("public_device");
    });

    it("can't finish a registration started before (the gate is checked again)", async () => {
      const { editor, sessionId } = await signedIn();
      const start = await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
      if (!start.ok) throw new Error();
      await db.update(sessions).set({ publicDevice: true }).where(eq(sessions.id, sessionId));
      const res = await finishPasskeyRegistration({
        editorId: editor.id,
        sessionId,
        token: start.token,
        response: new FakeAuthenticator().register(start.options, { origin: RP.origin }),
        rp: RP,
      });
      expect(res).toEqual({ ok: false, error: "public_device" });
    });

    it("may still remove one, with a fresh verification", async () => {
      const { editor, sessionId } = await signedIn();
      const { passkey } = await addPasskey(editor.id, sessionId);
      const pub = await sessionFor(editor.id, { publicDevice: true });
      expect(await removePasskey({ editorId: editor.id, sessionId: pub, id: passkey.id })).toEqual({ ok: true });
    });
  });

  it("refuses a revoked session", async () => {
    const { editor, sessionId } = await signedIn();
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await passkeyGate(editor.id, sessionId, "add")).toBe("no_session");
    expect(await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP })).toEqual({ ok: false, error: "no_session" });
  });
});

describe("emails", () => {
  it("are sent for every passkey added and removed, with the device and the passkey name", async () => {
    const { editor, sessionId } = await signedIn();
    const { passkey } = await addPasskey(editor.id, sessionId);
    await renamePasskey(editor.id, passkey.id, "Study laptop");
    await removePasskey({ editorId: editor.id, sessionId, id: passkey.id, userAgent: MAC });
    expect(passkeyNotices.map((n) => [n.kind, n.passkeyName, n.device])).toEqual([
      ["added", "Chrome on macOS", "Chrome on macOS"],
      ["removed", "Study laptop", "Chrome on macOS"],
    ]);
  });

  it("aren't sent for refused changes", async () => {
    const { editor, sessionId } = await signedIn();
    const { passkey } = await addPasskey(editor.id, sessionId);
    passkeyNotices.length = 0;
    await age(sessionId, "email_verified_at", STEP_UP_WINDOW_SECONDS + 1);
    await removePasskey({ editorId: editor.id, sessionId, id: passkey.id });
    await startPasskeyRegistration({ editorId: editor.id, sessionId, rp: RP });
    expect(passkeyNotices).toHaveLength(0);
  });
});

describe("the add-a-passkey offer after a recovery-code sign-in", () => {
  it("shows once, in that session, until dismissed", async () => {
    const editor = await makeEditor();
    const sessionId = await sessionFor(editor.id, { method: "recovery" });
    expect(await shouldOfferPasskey(editor.id, sessionId)).toBe(true);
    await dismissPasskeyOffer(editor.id, sessionId);
    expect(await shouldOfferPasskey(editor.id, sessionId)).toBe(false);
  });

  it("goes once a passkey has been added", async () => {
    const editor = await makeEditor();
    const sessionId = await sessionFor(editor.id, { method: "recovery" });
    await addPasskey(editor.id, sessionId);
    expect(await shouldOfferPasskey(editor.id, sessionId)).toBe(false);
  });

  it("isn't shown on a public device, after an email or passkey sign-in, or once the exception ends", async () => {
    const editor = await makeEditor();
    const pub = await sessionFor(editor.id, { method: "recovery", publicDevice: true });
    const email = await sessionFor(editor.id);
    const passkey = await sessionFor(editor.id, { method: "passkey" });
    const late = await sessionFor(editor.id, { method: "recovery" });
    await age(late, "created_at", RECOVERY_PASSKEY_WINDOW_SECONDS + 1);
    for (const id of [pub, email, passkey, late]) expect(await shouldOfferPasskey(editor.id, id)).toBe(false);
  });

  it("is per editor: another editor's session id does nothing", async () => {
    const editor = await makeEditor();
    const sessionId = await sessionFor(editor.id, { method: "recovery" });
    const other = await makeEditor("other@example.com");
    expect(await shouldOfferPasskey(other.id, sessionId)).toBe(false);
    await dismissPasskeyOffer(other.id, sessionId);
    expect(await shouldOfferPasskey(editor.id, sessionId)).toBe(true);
  });
});

describe("sessions", () => {
  it("record passkey sign-ins as such", async () => {
    const editor = await makeEditor();
    const sessionId = await sessionFor(editor.id, { method: "passkey", publicDevice: true });
    const [s] = await listSessions(editor.id, sessionId);
    expect(s).toMatchObject({ method: "passkey", publicDevice: true });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.passkeyVerifiedAt).toBeInstanceOf(Date);
  });
});

afterEach(() => {
  process.env.EDITOR_ALLOWLIST = "";
  resetEnvCache();
});
