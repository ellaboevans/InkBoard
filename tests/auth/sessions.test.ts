import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, sessions } from "@/db/schema";
import { resetEnvCache } from "@/env";
import {
  createSession,
  listSessions,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
  revokeSessionToken,
  validateSession,
  validateSessionToken,
} from "@/server/auth/sessions";

const db = getDb();

async function makeEditor(email = "poet@example.com") {
  const [e] = await db.insert(editors).values({ email }).returning();
  return e;
}

describe("sessions", () => {
  it("creates a session that resolves to its editor", async () => {
    const editor = await makeEditor();
    const { token, expiresAt } = await createSession(editor.id, {
      userAgent: "vitest",
      ip: "127.0.0.1",
    });
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);

    expect(await validateSessionToken(token)).toEqual({
      id: editor.id,
      email: editor.email,
      penName: null,
      slug: null,
      bio: null,
      avatar: null,
    });
  });

  it("stores only a hash of the token", async () => {
    const editor = await makeEditor();
    const { token } = await createSession(editor.id);
    const [row] = await db.select().from(sessions);
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unknown, empty and oversized tokens", async () => {
    expect(await validateSessionToken("nope")).toBeNull();
    expect(await validateSessionToken("")).toBeNull();
    expect(await validateSessionToken("x".repeat(500))).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const editor = await makeEditor();
    const { token } = await createSession(editor.id);
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("revokes a single session or all of an editor's sessions", async () => {
    const editor = await makeEditor();
    const a = await createSession(editor.id);
    const b = await createSession(editor.id);
    const c = await createSession(editor.id);

    await revokeSessionToken(a.token);
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(b.token)).not.toBeNull();

    await revokeAllSessions(editor.id);
    expect(await validateSessionToken(b.token)).toBeNull();
    expect(await validateSessionToken(c.token)).toBeNull();
  });

  it("is removed when the editor is deleted", async () => {
    const editor = await makeEditor();
    const { token } = await createSession(editor.id);
    await db.delete(editors);
    expect(await validateSessionToken(token)).toBeNull();
  });
});

describe("allowlist changes", () => {
  afterEach(() => {
    process.env.EDITOR_ALLOWLIST = "";
    resetEnvCache();
  });

  it("invalidates sessions of editors removed from the allowlist", async () => {
    const editor = await makeEditor("gone@example.com");
    const { token } = await createSession(editor.id);
    expect(await validateSessionToken(token)).not.toBeNull();

    process.env.EDITOR_ALLOWLIST = "@poets.org";
    resetEnvCache();
    expect(await validateSessionToken(token)).toBeNull();
  });
});

describe("managing devices", () => {
  async function signIn(editorId: string, userAgent = "vitest") {
    const { token } = await createSession(editorId, { userAgent, ip: "127.0.0.1" });
    const s = await validateSession(token);
    return { token, id: s!.sessionId };
  }

  it("lists live sessions with the current one first, and no token hashes", async () => {
    const editor = await makeEditor();
    const phone = await signIn(editor.id, "phone");
    const laptop = await signIn(editor.id, "laptop");
    const expired = await signIn(editor.id, "old");
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(sql`${sessions.id} = ${expired.id}`);
    const other = await makeEditor("other@example.com");
    await signIn(other.id);

    const list = await listSessions(editor.id, phone.id);
    expect(list.map((s) => [s.id, s.current])).toEqual([
      [phone.id, true],
      [laptop.id, false],
    ]);
    expect(Object.keys(list[0]).sort()).toEqual(
      ["createdAt", "current", "expiresAt", "id", "ip", "method", "publicDevice", "userAgent"],
    );
    expect(JSON.stringify(list)).not.toContain(phone.token);
  });

  it("revokes one device, scoped to its editor", async () => {
    const editor = await makeEditor();
    const other = await makeEditor("other@example.com");
    const mine = await signIn(editor.id);
    const theirs = await signIn(other.id);

    // Another editor's session id, and malformed ids, behave like missing ones.
    expect(await revokeSession(editor.id, theirs.id)).toBe(false);
    expect(await revokeSession(editor.id, "not-a-uuid")).toBe(false);
    expect(await revokeSession(editor.id, undefined)).toBe(false);
    expect(await validateSessionToken(theirs.token)).not.toBeNull();

    expect(await revokeSession(editor.id, mine.id)).toBe(true);
    expect(await validateSessionToken(mine.token)).toBeNull();
    expect(await revokeSession(editor.id, mine.id)).toBe(false);
  });

  it("signs out every other device but keeps the current one", async () => {
    const editor = await makeEditor();
    const other = await makeEditor("other@example.com");
    const current = await signIn(editor.id);
    const a = await signIn(editor.id);
    const b = await signIn(editor.id);
    const theirs = await signIn(other.id);

    expect(await revokeOtherSessions(editor.id, current.id)).toBe(2);
    expect(await validateSessionToken(current.token)).not.toBeNull();
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(b.token)).toBeNull();
    expect(await validateSessionToken(theirs.token)).not.toBeNull();
  });
});
