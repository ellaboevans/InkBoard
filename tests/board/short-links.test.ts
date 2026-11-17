import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors, poems, rateLimits, retiredShortCodes, shortLinks } from "@/db/schema";
import { SHORT_CODE_ALPHABET } from "@/lib/share-image/short-code";
import { handleShortLink } from "@/server/short-link-route";
import { countShareVisit, ensureShortCode, resolveShortCode, shareVisitsForEditor } from "@/server/short-links";

/*
 * Short links and their visit counts (docs/PLAN.md, Phase 21 round 3), against
 * the real database: codes made once per public poem, race-free, never
 * reused; /s/<code> only for published public poems, everything else the same
 * "missing"; visits counted once per network per day, and only for the writer.
 */

const db = getDb();
const CODE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{6}$`);
const PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

async function author(email: string, penName: string | null, slug: string) {
  const [e] = await db.insert(editors).values({ email, penName, slug }).returning();
  return e.id;
}
async function poem(editorId: string, over: Partial<typeof poems.$inferInsert>) {
  const [p] = await db
    .insert(poems)
    .values({ editorId, title: "Untitled", slug: "untitled", body: "line", status: "published", publishedAt: new Date(), ...over })
    .returning();
  return p;
}
const visits = async (poemId: string) => (await db.select().from(shortLinks).where(eq(shortLinks.poemId, poemId)))[0]?.visits;

describe("ensureShortCode", () => {
  it("makes one code for a published public poem, and returns the same one after", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "open" });
    const code = await ensureShortCode(p.id);
    expect(code).toMatch(CODE);
    expect(await ensureShortCode(p.id)).toBe(code);
    expect(await db.select().from(shortLinks)).toHaveLength(1);
  });

  it("never for a private poem, a draft or a poem that doesn't exist", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const locked = await poem(a, { slug: "locked", visibility: "private", passwordHash: "x" });
    const draft = await poem(a, { slug: "draft", status: "draft", publishedAt: null });
    expect(await ensureShortCode(locked.id)).toBeNull();
    expect(await ensureShortCode(draft.id)).toBeNull();
    expect(await ensureShortCode("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await db.select().from(shortLinks)).toEqual([]);
  });

  it("is race-free: twenty first pictures at once make one code", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "open" });
    const codes = await Promise.all(Array.from({ length: 20 }, () => ensureShortCode(p.id)));
    expect(new Set(codes).size).toBe(1);
    expect(await db.select().from(shortLinks)).toHaveLength(1);
  });

  it("gives forty poems forty different codes, even all at once", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const ps = await Promise.all(Array.from({ length: 40 }, (_, i) => poem(a, { slug: `p${i}` })));
    const codes = await Promise.all(ps.map((p) => ensureShortCode(p.id)));
    expect(new Set(codes).size).toBe(40);
  });

  it("redraws a code that's taken or retired, and the database refuses one outright", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "open" });
    const q = await poem(a, { slug: "other" });
    await db.insert(retiredShortCodes).values({ code: "bbbbbb" });
    await expect(db.insert(shortLinks).values({ poemId: p.id, code: "bbbbbb" })).rejects.toMatchObject({ cause: { code: "23505" } });
    await db.insert(shortLinks).values({ poemId: q.id, code: "cccccc" });
    await expect(db.insert(shortLinks).values({ poemId: p.id, code: "cccccc" })).rejects.toBeTruthy();
    expect(await ensureShortCode(p.id)).toMatch(CODE);
  });

  it("deleting the poem retires its code: the count goes, the code is never given to another poem", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "open" });
    const code = (await ensureShortCode(p.id))!;
    await db.delete(poems).where(eq(poems.id, p.id));
    expect(await db.select().from(shortLinks)).toEqual([]);
    expect((await db.select().from(retiredShortCodes)).map((r) => r.code)).toEqual([code]);
    const q = await poem(a, { slug: "next" });
    await expect(db.insert(shortLinks).values({ poemId: q.id, code })).rejects.toMatchObject({ cause: { code: "23505" } });
    expect(await resolveShortCode(code)).toBeNull();
  });

  it("deleting the account (by cascade) retires every code too", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const codes = [await ensureShortCode((await poem(a, { slug: "one" })).id), await ensureShortCode((await poem(a, { slug: "two" })).id)];
    await db.delete(editors).where(eq(editors.id, a));
    expect((await db.select().from(retiredShortCodes)).map((r) => r.code).sort()).toEqual([...codes].sort());
  });
});

describe("/s/<code>: where it goes", () => {
  async function setUp() {
    const a = await author("a@x.com", "Ann Sɛwaa", "ann");
    const open = await poem(a, { slug: "open" });
    const code = (await ensureShortCode(open.id))!;
    return { a, open, code };
  }

  it("a published public poem's code redirects to its page; capitals work", async () => {
    const { open, code } = await setUp();
    expect(await resolveShortCode(code)).toEqual({ poemId: open.id, authorSlug: "ann", poemSlug: "open" });
    expect(await resolveShortCode(code.toUpperCase())).toEqual({ poemId: open.id, authorSlug: "ann", poemSlug: "open" });
    expect(await handleShortLink({ method: "GET", headers: new Headers({ "user-agent": PHONE }) }, code, resolveShortCode)).toEqual({
      kind: "redirect",
      location: "/p/ann/open",
      poemId: open.id,
      count: true,
    });
  });

  it("private, unpublished, deleted, unknown and malformed are all the same 'missing'", async () => {
    const { open, code } = await setUp();
    const go = (c: string) => handleShortLink({ method: "GET", headers: new Headers() }, c, resolveShortCode);
    for (const c of ["bbbbbb", "zzzzzz", "", "k3x9q", "ab cd!", "../../p/ann/open", "k3x9q0"]) expect(await go(c), c).toEqual({ kind: "missing" });
    // Made private: its code stays on the row, but the link is missing like any other.
    await db.update(poems).set({ visibility: "private", passwordHash: "x" }).where(eq(poems.id, open.id));
    expect(await go(code)).toEqual({ kind: "missing" });
    // Public again: the same code works again (it's the poem's for good).
    await db.update(poems).set({ visibility: "public", passwordHash: null }).where(eq(poems.id, open.id));
    expect((await go(code)).kind).toBe("redirect");
    // Unpublished (back to a draft).
    await db.update(poems).set({ status: "draft" }).where(eq(poems.id, open.id));
    expect(await go(code)).toEqual({ kind: "missing" });
    await db.update(poems).set({ status: "published" }).where(eq(poems.id, open.id));
    // An author who hasn't a pen name any more can't be on the board either.
    await db.update(editors).set({ penName: null }).where(eq(editors.slug, "ann"));
    expect(await go(code)).toEqual({ kind: "missing" });
    await db.update(editors).set({ penName: "Ann" }).where(eq(editors.slug, "ann"));
    // Deleted.
    await db.delete(poems).where(eq(poems.id, open.id));
    expect(await go(code)).toEqual({ kind: "missing" });
  });

  it("a private poem's code can't be told from a code that never existed: same answer, same single query", async () => {
    const { a, code } = await setUp();
    const locked = await poem(a, { slug: "locked" });
    const lockedCode = (await ensureShortCode(locked.id))!;
    await db.update(poems).set({ visibility: "private", passwordHash: "x" }).where(eq(poems.id, locked.id));
    const req = { method: "GET", headers: new Headers() };
    // Count the SQL statements each answer takes (the pg pool every query goes through).
    const pg = await import("pg");
    const spy = vi.spyOn(pg.default.Pool.prototype, "query");
    const statements = async (c: string) => {
      spy.mockClear();
      const answer = await handleShortLink(req, c, resolveShortCode);
      return { answer, statements: spy.mock.calls.length };
    };
    const privateOne = await statements(lockedCode);
    const neverExisted = await statements("zzzzzz");
    spy.mockRestore();
    expect(privateOne).toEqual(neverExisted);
    expect(privateOne).toEqual({ answer: { kind: "missing" }, statements: 1 });
    expect((await handleShortLink(req, code, resolveShortCode)).kind).toBe("redirect");
  });

  it("what counts: a person's GET; not a HEAD, a prefetch or a link-preview crawler", async () => {
    const { code } = await setUp();
    const outcome = (method: string, headers: Record<string, string>) =>
      handleShortLink({ method, headers: new Headers(headers) }, code, resolveShortCode);
    expect(await outcome("GET", { "user-agent": PHONE })).toMatchObject({ kind: "redirect", count: true });
    expect(await outcome("HEAD", { "user-agent": PHONE })).toMatchObject({ kind: "redirect", count: false });
    expect(await outcome("GET", { "user-agent": PHONE, "sec-purpose": "prefetch" })).toMatchObject({ kind: "redirect", count: false });
    expect(await outcome("GET", { "user-agent": PHONE, purpose: "prefetch" })).toMatchObject({ kind: "redirect", count: false });
    for (const ua of ["WhatsApp/2.24.21.84 A", "facebookexternalhit/1.1", "Twitterbot/1.0", "Slackbot-LinkExpanding 1.0", "TelegramBot (like TwitterBot)", "Mozilla/5.0 (compatible; Discordbot/2.0)"]) {
      expect(await outcome("GET", { "user-agent": ua }), ua).toMatchObject({ kind: "redirect", count: false });
    }
  });
});

describe("countShareVisit", () => {
  it("one per network per poem per day, in rate_limits; another network or poem counts on its own", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "one" });
    const q = await poem(a, { slug: "two" });
    await ensureShortCode(p.id);
    await ensureShortCode(q.id);
    expect(await countShareVisit(p.id, "198.51.100.1")).toBe(true);
    expect(await countShareVisit(p.id, "198.51.100.1")).toBe(false);
    expect(await countShareVisit(p.id, "198.51.100.1")).toBe(false);
    expect(await countShareVisit(p.id, "203.0.113.9")).toBe(true);
    expect(await countShareVisit(q.id, "198.51.100.1")).toBe(true);
    expect(await visits(p.id)).toBe(2);
    expect(await visits(q.id)).toBe(1);
    // The only trace of the visitors: counters named after poem and network, cleared by the daily clean-up.
    const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key).sort();
    expect(keys).toEqual([`share:visit:${p.id}:198.51.100.1`, `share:visit:${p.id}:203.0.113.9`, `share:visit:${q.id}:198.51.100.1`].sort());
  });

  it("the day passes: the same network counts again", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "one" });
    await ensureShortCode(p.id);
    expect(await countShareVisit(p.id, "198.51.100.1")).toBe(true);
    await db.execute(sql`UPDATE rate_limits SET window_start = now() - interval '25 hours'`);
    expect(await countShareVisit(p.id, "198.51.100.1")).toBe(true);
    expect(await visits(p.id)).toBe(2);
  });

  it("is atomic: concurrent visits from different networks all count", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const p = await poem(a, { slug: "one" });
    await ensureShortCode(p.id);
    await Promise.all(Array.from({ length: 25 }, (_, i) => countShareVisit(p.id, `198.51.100.${i}`)));
    expect(await visits(p.id)).toBe(25);
  });
});

describe("shareVisitsForEditor", () => {
  it("only the editor's own poems, never anyone else's", async () => {
    const a = await author("a@x.com", "Ann", "ann");
    const b = await author("b@x.com", "Bea", "bea");
    const mine = await poem(a, { slug: "mine" });
    const theirs = await poem(b, { slug: "theirs" });
    const unshared = await poem(a, { slug: "unshared" });
    await ensureShortCode(mine.id);
    await ensureShortCode(theirs.id);
    await countShareVisit(mine.id, "198.51.100.1");
    await countShareVisit(theirs.id, "198.51.100.1");
    await countShareVisit(theirs.id, "198.51.100.2");
    expect([...(await shareVisitsForEditor(a))]).toEqual([[mine.id, 1]]);
    expect([...(await shareVisitsForEditor(b))]).toEqual([[theirs.id, 2]]);
    expect((await shareVisitsForEditor(a)).has(unshared.id)).toBe(false);
  });
});
