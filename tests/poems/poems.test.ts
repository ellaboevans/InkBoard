import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { verifyPassword } from "@/server/passwords";
import {
  BODY_MAX,
  createPoem,
  deletePoem,
  getEditorPoem,
  listEditorPoems,
  updatePoem,
  type PoemInput,
} from "@/server/poems";

const db = getDb();
let ada: string;
let eve: string;

beforeEach(async () => {
  const rows = await db
    .insert(editors)
    .values([
      { email: "ada@example.com", penName: "Ada", slug: "ada" },
      { email: "eve@example.com", penName: "Eve", slug: "eve" },
    ])
    .returning();
  [ada, eve] = rows.map((r) => r.id);
});

const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Ode to Autumn",
  body: "Season of mists\n  and mellow fruitfulness",
  visibility: "public",
  status: "draft",
  ...over,
});

async function create(editorId = ada, over: Partial<PoemInput> = {}) {
  const res = await createPoem(editorId, input(over));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.poem;
}

const row = async (id: string) =>
  (await db.select().from(poems).where(eq(poems.id, id)))[0];

describe("createPoem", () => {
  it("creates a public draft with a slug and preserved indentation", async () => {
    const poem = await create();
    expect(poem).toMatchObject({ slug: "ode-to-autumn", status: "draft" });
    const r = await row(poem.id);
    expect(r.body).toBe("Season of mists\n  and mellow fruitfulness");
    expect(r.publishedAt).toBeNull();
    expect(r.passwordHash).toBeNull();
  });

  it("normalises line endings and trims only outer blank space", async () => {
    const poem = await create(ada, { body: "\n\n   first\r\nsecond  \r\n\n" });
    expect((await row(poem.id)).body).toBe("   first\nsecond");
  });

  it("sets publishedAt when created as published", async () => {
    const poem = await create(ada, { status: "published" });
    expect((await row(poem.id)).publishedAt).toBeInstanceOf(Date);
  });

  it("requires a password for private poems and stores only its hash", async () => {
    expect(await createPoem(ada, input({ visibility: "private" }))).toEqual({
      ok: false,
      errors: { password: expect.stringContaining("need a password") },
    });

    const poem = await create(ada, { visibility: "private", password: "secret-key" });
    const r = await row(poem.id);
    expect(r.passwordHash).not.toContain("secret-key");
    expect(await verifyPassword("secret-key", r.passwordHash)).toBe(true);
  });

  it("validates fields and reports one message per field", async () => {
    const res = await createPoem(ada, {
      title: "   ",
      body: " \n ",
      visibility: "secret",
      status: "draft",
      password: "abc",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.errors).sort()).toEqual(["body", "password", "title", "visibility"]);
  });

  it("enforces length limits", async () => {
    const res = await createPoem(ada, input({ title: "x".repeat(151), body: "y".repeat(BODY_MAX + 1) }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual(["body", "title"]);
  });

  it("keeps slugs unique per editor but not across editors", async () => {
    expect((await create(ada)).slug).toBe("ode-to-autumn");
    expect((await create(ada)).slug).toBe("ode-to-autumn-2");
    expect((await create(eve)).slug).toBe("ode-to-autumn");
  });

  it("survives concurrent creates with the same title", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createPoem(ada, input())));
    expect(results.every((r) => r.ok)).toBe(true);
    const slugs = results.map((r) => (r.ok ? r.poem.slug : ""));
    expect(new Set(slugs).size).toBe(5);
  });
});

describe("updatePoem", () => {
  it("updates fields and sets publishedAt only on first publish", async () => {
    const poem = await create();
    await updatePoem(ada, poem.id, input({ status: "published" }));
    const first = (await row(poem.id)).publishedAt;
    expect(first).toBeInstanceOf(Date);

    await updatePoem(ada, poem.id, input({ status: "draft" }));
    await updatePoem(ada, poem.id, input({ status: "published", title: "Ode, revised" }));
    const r = await row(poem.id);
    expect(r.publishedAt).toEqual(first);
    expect(r.title).toBe("Ode, revised");
  });

  it("re-slugs drafts on rename but keeps published URLs stable", async () => {
    const draft = await create();
    const renamed = await updatePoem(ada, draft.id, input({ title: "To Winter" }));
    expect(renamed).toMatchObject({ ok: true, poem: { slug: "to-winter" } });

    const live = await create(ada, { title: "Spring", status: "published" });
    const res = await updatePoem(ada, live.id, input({ title: "Summer", status: "published" }));
    expect(res).toMatchObject({ ok: true, poem: { slug: "spring" } });
  });

  it("does not clash with its own slug when re-saved", async () => {
    const poem = await create();
    await updatePoem(ada, poem.id, input({ title: "Something else" }));
    const back = await updatePoem(ada, poem.id, input({ title: "Ode to Autumn" }));
    expect(back).toMatchObject({ ok: true, poem: { slug: "ode-to-autumn" } });
  });

  describe("passwords and visibility", () => {
    it("keeps the existing password when the field is left empty", async () => {
      const poem = await create(ada, { visibility: "private", password: "first-pass" });
      const before = await row(poem.id);
      await updatePoem(ada, poem.id, input({ visibility: "private", password: "", title: "New" }));
      const after = await row(poem.id);
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.passwordVersion).toBe(before.passwordVersion);
    });

    it("changing the password bumps password_version (revokes unlocks)", async () => {
      const poem = await create(ada, { visibility: "private", password: "first-pass" });
      const v0 = (await row(poem.id)).passwordVersion;
      await updatePoem(ada, poem.id, input({ visibility: "private", password: "second-pass" }));
      const r = await row(poem.id);
      expect(r.passwordVersion).toBe(v0 + 1);
      expect(await verifyPassword("second-pass", r.passwordHash)).toBe(true);
      expect(await verifyPassword("first-pass", r.passwordHash)).toBe(false);
    });

    it("making a poem public drops its password", async () => {
      const poem = await create(ada, { visibility: "private", password: "first-pass" });
      const v0 = (await row(poem.id)).passwordVersion;
      await updatePoem(ada, poem.id, input({ visibility: "public" }));
      const r = await row(poem.id);
      expect(r.passwordHash).toBeNull();
      expect(r.passwordVersion).toBe(v0 + 1);
    });

    it("making a public poem private requires a new password", async () => {
      const poem = await create();
      expect(await updatePoem(ada, poem.id, input({ visibility: "private" }))).toMatchObject({
        ok: false,
        errors: { password: expect.any(String) },
      });
      expect((await row(poem.id)).visibility).toBe("public");

      await updatePoem(ada, poem.id, input({ visibility: "private", password: "now-locked" }));
      expect((await row(poem.id)).visibility).toBe("private");
    });

    it("ignores a password sent for a public poem", async () => {
      const poem = await create();
      await updatePoem(ada, poem.id, input({ visibility: "public", password: "irrelevant" }));
      expect((await row(poem.id)).passwordHash).toBeNull();
    });
  });
});

describe("authorization (N5)", () => {
  it("an editor cannot read, update or delete another editor's poem", async () => {
    const poem = await create(ada, { visibility: "private", password: "ada-only" });
    const before = await row(poem.id);

    expect(await getEditorPoem(eve, poem.id)).toBeNull();
    expect(await updatePoem(eve, poem.id, input({ title: "Pwned", visibility: "public" }))).toEqual({
      ok: false,
      notFound: true,
    });
    expect(await deletePoem(eve, poem.id)).toBe(false);
    expect(await listEditorPoems(eve)).toEqual([]);

    expect(await row(poem.id)).toEqual(before);
  });

  it("treats malformed ids as not found instead of erroring", async () => {
    expect(await getEditorPoem(ada, "not-a-uuid")).toBeNull();
    expect(await updatePoem(ada, "1; DROP TABLE poems", input())).toEqual({ ok: false, notFound: true });
    expect(await deletePoem(ada, "")).toBe(false);
  });
});

describe("reads never expose password hashes", () => {
  it("getEditorPoem / listEditorPoems return hasPassword only", async () => {
    const poem = await create(ada, { visibility: "private", password: "hidden-pass" });
    const one = await getEditorPoem(ada, poem.id);
    const [listed] = await listEditorPoems(ada);

    for (const p of [one, listed]) {
      expect(p).not.toHaveProperty("passwordHash");
      expect(p).not.toHaveProperty("passwordVersion");
      expect(p).toMatchObject({ hasPassword: true });
      expect(JSON.stringify(p)).not.toContain("scrypt$");
    }
    expect(listed).not.toHaveProperty("body");
    expect(one?.body).toContain("Season of mists");
  });

  it("lists only the editor's poems, most recently updated first", async () => {
    const a = await create(ada, { title: "First" });
    const b = await create(ada, { title: "Second" });
    await create(eve, { title: "Not mine" });
    await db.update(poems).set({ updatedAt: sql`now() - interval '1 day'` }).where(eq(poems.id, b.id));

    expect((await listEditorPoems(ada)).map((p) => p.id)).toEqual([a.id, b.id]);
  });
});

describe("deletePoem", () => {
  it("deletes the editor's own poem", async () => {
    const poem = await create();
    expect(await deletePoem(ada, poem.id)).toBe(true);
    expect(await row(poem.id)).toBeUndefined();
    expect(await deletePoem(ada, poem.id)).toBe(false);
  });
});
