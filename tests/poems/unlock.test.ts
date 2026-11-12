import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { setSharedPassword, switchToPerPoemPasswords } from "@/server/password-settings";
import { createPoem, updatePoem, type PoemInput } from "@/server/poems";
import {
  attemptUnlock,
  decodeGrants,
  encodeGrants,
  readUnlockedBody,
  type Grant,
} from "@/server/unlock";

const db = getDb();
let ed: string;

beforeEach(async () => {
  const [e] = await db
    .insert(editors)
    .values({ email: "u@example.com", penName: "Una", slug: "una" })
    .returning();
  ed = e.id;
});

const poemInput = (title: string, over: Partial<PoemInput> = {}): PoemInput => ({
  title,
  body: `${title} secret body`,
  visibility: "private",
  status: "published",
  ...over,
});

async function create(title: string, over: Partial<PoemInput> = {}) {
  const res = await createPoem(ed, poemInput(title, over));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.poem;
}

async function unlock(slug: string, password: string, grants: Grant[] = [], ip = "10.0.0.1") {
  return attemptUnlock({ authorSlug: "una", poemSlug: slug, password, ip, grants });
}

async function unlockOk(slug: string, password: string, grants: Grant[] = []) {
  const res = await unlock(slug, password, grants);
  if (!res.ok) throw new Error(`unlock failed: ${res.error}`);
  return res.grants;
}

describe("per-poem passwords", () => {
  it("the right password unlocks that poem only", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const b = await create("Beta", { password: "beta-pass" });

    expect(await unlock(a.slug, "beta-pass")).toEqual({ ok: false, error: "wrong_password" });
    const grants = await unlockOk(a.slug, "alpha-pass");
    expect(await readUnlockedBody("una", a.slug, grants)).toBe("Alpha secret body");
    expect(await readUnlockedBody("una", b.slug, grants)).toBeNull();
  });

  it("changing the poem's password revokes existing unlocks", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const grants = await unlockOk(a.slug, "alpha-pass");
    await updatePoem(ed, (await getId(a.slug))!, poemInput("Alpha", { password: "new-alpha-pass" }));
    expect(await readUnlockedBody("una", a.slug, grants)).toBeNull();
    expect(await unlock(a.slug, "alpha-pass")).toMatchObject({ ok: false });
    expect(await readUnlockedBody("una", a.slug, await unlockOk(a.slug, "new-alpha-pass"))).toContain("secret");
  });
});

describe("one shared password", () => {
  it("unlocks every private poem by that author at once", async () => {
    await setSharedPassword(ed, "one-for-all");
    const a = await create("Alpha");
    const b = await create("Beta");
    const grants = await unlockOk(a.slug, "one-for-all");
    expect(await readUnlockedBody("una", a.slug, grants)).toBe("Alpha secret body");
    expect(await readUnlockedBody("una", b.slug, grants)).toBe("Beta secret body");
    // Poems added later are covered too.
    const c = await create("Gamma");
    expect(await readUnlockedBody("una", c.slug, grants)).toBe("Gamma secret body");
  });

  it("does not unlock other authors' poems", async () => {
    await setSharedPassword(ed, "one-for-all");
    const a = await create("Alpha");
    const grants = await unlockOk(a.slug, "one-for-all");
    const [other] = await db
      .insert(editors)
      .values({ email: "o@example.com", penName: "Otto", slug: "otto" })
      .returning();
    const res = await createPoem(other.id, poemInput("Theirs", { password: "one-for-all" }));
    expect(res.ok).toBe(true);
    expect(await readUnlockedBody("otto", "theirs", grants)).toBeNull();
  });

  it("changing the shared password revokes unlocks", async () => {
    await setSharedPassword(ed, "one-for-all");
    const a = await create("Alpha");
    const grants = await unlockOk(a.slug, "one-for-all");
    await setSharedPassword(ed, "brand-new-one");
    expect(await readUnlockedBody("una", a.slug, grants)).toBeNull();
    expect(await unlock(a.slug, "one-for-all")).toMatchObject({ error: "wrong_password" });
  });

  it("old poem-level passwords stop working in shared mode", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    await setSharedPassword(ed, "one-for-all");
    expect(await unlock(a.slug, "alpha-pass")).toMatchObject({ error: "wrong_password" });
  });
});

describe("switching modes revokes unlocks", () => {
  it("shared -> per poem: shared unlocks stop; the shared password now works per poem", async () => {
    await setSharedPassword(ed, "one-for-all");
    const a = await create("Alpha");
    const grants = await unlockOk(a.slug, "one-for-all");
    await switchToPerPoemPasswords(ed);
    expect(await readUnlockedBody("una", a.slug, grants)).toBeNull();
    expect(await readUnlockedBody("una", a.slug, await unlockOk(a.slug, "one-for-all"))).toContain("secret");
  });

  it("per poem -> shared: per-poem unlocks stop", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const grants = await unlockOk(a.slug, "alpha-pass");
    await setSharedPassword(ed, "one-for-all");
    expect(await readUnlockedBody("una", a.slug, grants)).toBeNull();
  });
});

describe("limits and edge cases", () => {
  it("rate limits wrong guesses, counting a shared author's poems together", async () => {
    await setSharedPassword(ed, "one-for-all");
    const slugs = [(await create("A1")).slug, (await create("A2")).slug];
    for (let i = 0; i < 10; i++) await unlock(slugs[i % 2], "wrong-guess");
    expect(await unlock(slugs[0], "one-for-all")).toMatchObject({ ok: false, error: "rate_limited" });
    expect(await unlock(slugs[1], "one-for-all")).toMatchObject({ ok: false, error: "rate_limited" });
    // Another reader (IP) is unaffected.
    expect((await attemptUnlock({ authorSlug: "una", poemSlug: slugs[0], password: "one-for-all", ip: "10.9.9.9", grants: [] })).ok).toBe(true);
  });

  it("public, draft and unknown poems can't be 'unlocked'", async () => {
    await create("Open", { visibility: "public" });
    await create("Draft", { status: "draft", password: "draft-pass" });
    expect(await unlock("open", "x")).toEqual({ ok: false, error: "not_found" });
    expect(await unlock("draft", "draft-pass")).toEqual({ ok: false, error: "not_found" });
    expect(await unlock("nope", "x")).toEqual({ ok: false, error: "not_found" });
  });

  it("expired grants don't unlock", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const grants = (await unlockOk(a.slug, "alpha-pass")).map((g) => ({ ...g, e: Date.now() - 1 }));
    expect(await readUnlockedBody("una", a.slug, grants)).toBeNull();
  });

  it("a forged grant for the current scope fails the cookie signature", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const real = encodeGrants(await unlockOk(a.slug, "alpha-pass"));
    expect(decodeGrants(real)).toHaveLength(1);
    const forged = Buffer.from(JSON.stringify([{ s: "a:x:1", e: 9e15 }])).toString("base64url");
    expect(decodeGrants(`${forged}.${real.split(".")[1]}`)).toEqual([]);
    expect(decodeGrants("garbage")).toEqual([]);
    expect(decodeGrants(undefined)).toEqual([]);
  });
});

async function getId(slug: string) {
  const { rows } = (await db.execute(sql`SELECT id FROM poems WHERE slug = ${slug}`)) as unknown as {
    rows: { id: string }[];
  };
  return rows[0]?.id;
}


describe("guessing from many IPs", () => {
  it("rotating IPv6 addresses inside one /64 shares a limit", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    for (let i = 0; i < 10; i++) {
      await attemptUnlock({ authorSlug: "una", poemSlug: a.slug, password: "nope", ip: `2001:db8:1:2::${i + 1}`, grants: [] });
    }
    expect(
      await attemptUnlock({ authorSlug: "una", poemSlug: a.slug, password: "alpha-pass", ip: "2001:db8:1:2::99", grants: [] }),
    ).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("caps guesses per poem across all clients", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    await getDb().execute(sql`
      INSERT INTO rate_limits (key, window_start, count)
      SELECT 'unlock:p:' || id || ':all', now(), 300 FROM poems WHERE slug = ${a.slug}
    `);
    expect(
      await attemptUnlock({ authorSlug: "una", poemSlug: a.slug, password: "alpha-pass", ip: "198.51.100.200", grants: [] }),
    ).toMatchObject({ ok: false, error: "rate_limited" });
  });
});

describe("unpublishing", () => {
  it("revokes per-poem unlocks, so a republished poem asks again", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const grants = await unlockOk(a.slug, "alpha-pass");
    const id = (await getId(a.slug))!;
    await updatePoem(ed, id, poemInput("Alpha", { status: "draft" }));
    await updatePoem(ed, id, poemInput("Alpha", { status: "published", body: "revised secret" }));
    expect(await readUnlockedBody("una", a.slug, grants)).toBeNull();
    expect(await readUnlockedBody("una", a.slug, await unlockOk(a.slug, "alpha-pass"))).toBe("revised secret");
  });

  it("ordinary edits of a published poem keep unlocks", async () => {
    const a = await create("Alpha", { password: "alpha-pass" });
    const grants = await unlockOk(a.slug, "alpha-pass");
    await updatePoem(ed, (await getId(a.slug))!, poemInput("Alpha", { body: "typo fixed" }));
    expect(await readUnlockedBody("una", a.slug, grants)).toBe("typo fixed");
  });
});
