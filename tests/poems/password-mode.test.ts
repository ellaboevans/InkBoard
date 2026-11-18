import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import {
  getPasswordSettings,
  setSharedPassword,
  switchToPerPoemPasswords,
} from "@/server/password-settings";
import { verifyPassword } from "@/server/passwords";
import { createPoem, updatePoem, type PoemInput } from "@/server/poems";

const db = getDb();
let ed: string;

beforeEach(async () => {
  const [e] = await db
    .insert(editors)
    .values({ email: "mode@example.com", penName: "Mode", slug: "mode" })
    .returning();
  ed = e.id;
});

const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Poem",
  body: "words",
  visibility: "private",
  status: "published",
  ...over,
});

async function create(over: Partial<PoemInput> = {}) {
  const res = await createPoem(ed, input(over));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.poem.id;
}

const poem = async (id: string) => (await db.select().from(poems).where(eq(poems.id, id)))[0];
const editor = async () => (await db.select().from(editors).where(eq(editors.id, ed)))[0];

describe("defaults", () => {
  it("new editors use a password per poem", async () => {
    expect(await getPasswordSettings(ed)).toEqual({ mode: "per_poem", privatePoemCount: 0, privateNovelCount: 0 });
  });
});

describe("switching to one shared password", () => {
  it("validates the password", async () => {
    expect(await setSharedPassword(ed, "")).toMatchObject({ ok: false });
    expect(await setSharedPassword(ed, "abc")).toMatchObject({ ok: false });
    expect(await setSharedPassword(ed, undefined)).toMatchObject({ ok: false });
    expect((await editor()).passwordMode).toBe("per_poem");
  });

  it("applies to every private poem and clears poem-level passwords", async () => {
    const a = await create({ password: "poem-a-pass" });
    const b = await create({ password: "poem-b-pass", title: "B" });
    const pub = await create({ visibility: "public", title: "Open" });

    expect(await setSharedPassword(ed, "one-for-all")).toEqual({ ok: true });
    const e = await editor();
    expect(e.passwordMode).toBe("shared");
    expect(await verifyPassword("one-for-all", e.sharedPasswordHash)).toBe(true);
    for (const id of [a, b, pub]) expect((await poem(id)).passwordHash).toBeNull();
    expect(await getPasswordSettings(ed)).toEqual({ mode: "shared", privatePoemCount: 2, privateNovelCount: 0 });
  });

  it("new and edited private poems need no password of their own", async () => {
    await setSharedPassword(ed, "one-for-all");
    const id = await create(); // no password given
    expect((await poem(id)).passwordHash).toBeNull();

    // A password typed into the poem form is ignored in shared mode.
    await updatePoem(ed, id, input({ password: "ignored-pass" }));
    expect((await poem(id)).passwordHash).toBeNull();

    // Public -> private also works without one.
    const open = await create({ visibility: "public", title: "Open" });
    expect((await updatePoem(ed, open, input({ title: "Open" }))).ok).toBe(true);
    expect((await poem(open)).visibility).toBe("private");
  });

  it("changing the shared password bumps its version (revokes unlocks)", async () => {
    await setSharedPassword(ed, "first-shared");
    const v1 = (await editor()).sharedPasswordVersion;
    await setSharedPassword(ed, "second-shared");
    const e = await editor();
    expect(e.sharedPasswordVersion).toBe(v1 + 1);
    expect(await verifyPassword("first-shared", e.sharedPasswordHash)).toBe(false);
    expect(await verifyPassword("second-shared", e.sharedPasswordHash)).toBe(true);
  });
});

describe("switching back to a password per poem", () => {
  it("gives every private poem the shared password and bumps versions", async () => {
    const before = await create({ password: "own-pass-1" });
    await setSharedPassword(ed, "shared-pass");
    const during = await create({ title: "Written while shared" });
    const vShared = (await editor()).sharedPasswordVersion;
    const v0 = (await poem(during)).passwordVersion;

    expect(await switchToPerPoemPasswords(ed)).toEqual({ ok: true });
    const e = await editor();
    expect(e.passwordMode).toBe("per_poem");
    expect(e.sharedPasswordHash).toBeNull();
    expect(e.sharedPasswordVersion).toBe(vShared + 1);
    for (const id of [before, during]) {
      const p = await poem(id);
      expect(await verifyPassword("shared-pass", p.passwordHash)).toBe(true);
    }
    expect((await poem(during)).passwordVersion).toBe(v0 + 1);

    // Back to the normal per-poem rules.
    expect(await createPoem(ed, input({ title: "No pass" }))).toMatchObject({
      ok: false,
      errors: { password: expect.any(String) },
    });
    await updatePoem(ed, during, input({ title: "Written while shared", password: "now-its-own" }));
    expect(await verifyPassword("now-its-own", (await poem(during)).passwordHash)).toBe(true);
    expect(await verifyPassword("shared-pass", (await poem(before)).passwordHash)).toBe(true);
  });

  it("is a no-op when already per poem", async () => {
    const id = await create({ password: "keep-me-pass" });
    const p = await poem(id);
    expect(await switchToPerPoemPasswords(ed)).toEqual({ ok: true });
    expect(await poem(id)).toEqual(p);
  });
});

describe("database invariant: a private poem is always readable with some password", () => {
  it("rejects a private poem without a password in per-poem mode", async () => {
    await expect(
      db.insert(poems).values({ editorId: ed, title: "x", slug: "x", body: "x", visibility: "private" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("rejects switching to per-poem while private poems lack a password", async () => {
    await setSharedPassword(ed, "shared-pass");
    await create();
    await expect(
      db.update(editors).set({ passwordMode: "per_poem", sharedPasswordHash: null }).where(eq(editors.id, ed)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("rejects shared mode without a shared password", async () => {
    await expect(
      db.update(editors).set({ passwordMode: "shared" }).where(eq(editors.id, ed)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("holds when mode switches race with poem saves", async () => {
    await setSharedPassword(ed, "shared-pass");
    const id = await create();
    for (let round = 0; round < 25; round++) {
      const results = await Promise.allSettled([
        round % 2 ? setSharedPassword(ed, `shared-${round}-x`) : switchToPerPoemPasswords(ed),
        updatePoem(ed, id, input()),
        createPoem(ed, input({ title: `R${round}` })),
      ]);
      // No unhandled DB errors reach the editor...
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      // ...and the invariant holds afterwards.
      const { rows } = (await db.execute(sql`
        SELECT count(*)::int AS n FROM poems p JOIN editors e ON e.id = p.editor_id
        WHERE p.visibility = 'private'
          AND NOT (p.password_hash IS NOT NULL OR (e.password_mode = 'shared' AND e.shared_password_hash IS NOT NULL))
      `)) as unknown as { rows: { n: number }[] };
      expect(rows[0].n).toBe(0);
    }
  });
});
