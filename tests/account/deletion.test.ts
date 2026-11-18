import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  editors,
  emailOtps,
  passkeys,
  poems,
  rateLimits,
  retiredShortCodes,
  retiredSlugs,
  sessions,
  shortLinks,
  signInDevices,
  pushDeliveries,
  pushFollows,
  pushSubscriptions,
  signInLocations,
  stepUpCodes,
  webauthnChallenges,
} from "@/db/schema";
import { confirmsPenName, deleteAccount } from "@/server/account-deletion";
import { requestOtp, verifyOtp } from "@/server/auth/otp";
import { setPenName } from "@/server/auth/profile";
import { generateRecoveryCodes } from "@/server/auth/recovery-codes";
import { createSession, validateSession, type SessionOptions } from "@/server/auth/sessions";
import { STEP_UP_WINDOW_SECONDS } from "@/server/auth/step-up";
import { loadAuthorPage, loadBoardSections, loadCollectionPage, loadReaderPoem } from "@/server/board";
import { createCollection, setPoemCollection } from "@/server/collections";
import { sha256 } from "@/server/crypto";
import { loadAuthorFeed, loadSiteFeed } from "@/server/feeds";
import { createPoem, updatePoem } from "@/server/poems";
import { createChapter, createNovel, saveChapter } from "@/server/novels";
import { countShareVisit, ensureShortCode } from "@/server/short-links";
import { rateLimit } from "@/server/rate-limit";
import { searchBoard } from "@/server/search";
import { sendWelcomeOnce } from "@/server/welcome";
import { deletionNotices, lastCodeFor, welcomes } from "../support/outbox";

const db = getDb();
const UA = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/133.0";
type Rows<T> = { rows: T[] };

async function signedUp(email: string, penName: string, sessionOptions: SessionOptions = {}) {
  await db.execute(sql`DELETE FROM rate_limits WHERE key LIKE 'otp:cooldown:%'`);
  await requestOtp({ email });
  const res = await verifyOtp({ email, code: lastCodeFor(email) });
  if (!res.ok) throw new Error("sign-up failed");
  const slug = await setPenName(res.editor.id, penName);
  if (!slug.ok) throw new Error(slug.error);
  const { token } = await createSession(res.editor.id, { userAgent: UA, ip: "203.0.113.5" }, sessionOptions);
  const sessionId = (await validateSession(token))!.sessionId;
  return { id: res.editor.id, email, slug: slug.slug, sessionId };
}

async function poem(editorId: string, title: string, over: Record<string, unknown> = {}) {
  const res = await createPoem(editorId, { title, body: `${title}, a line`, visibility: "public", status: "published", ...over });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return { id: res.poem.id, slug: res.poem.slug };
}

/** An editor with a row in every table that can hold something of theirs. */
async function populated(email: string, penName: string) {
  const ed = await signedUp(email, penName);
  const one = await poem(ed.id, `${penName} Ode`);
  await updatePoem(ed.id, one.id, { title: `${penName} Ode`, body: "a second version", visibility: "public", status: "published" });
  await poem(ed.id, `${penName} Secret`, { visibility: "private", password: "poem-pass-123" });
  const col = await createCollection(ed.id, { title: `${penName} Cycle` });
  if (!col.ok) throw new Error();
  await setPoemCollection(ed.id, one.id, col.collection.id);
  await db.update(editors).set({ pinnedPoemId: one.id }).where(eq(editors.id, ed.id));
  await generateRecoveryCodes({ editorId: ed.id, sessionId: ed.sessionId });
  await db.insert(passkeys).values({ editorId: ed.id, credentialId: `cred-${ed.id}`, publicKey: "pk", deviceType: "singleDevice", name: "Laptop" });
  await db.insert(stepUpCodes).values({ sessionId: ed.sessionId, codeHash: "h", expiresAt: sql`now() + interval '5 minutes'` });
  await db.insert(webauthnChallenges).values([
    { tokenHash: `reg-${ed.id}`, purpose: "registration", challenge: "c", editorId: ed.id, sessionId: ed.sessionId, expiresAt: sql`now() + interval '5 minutes'` },
  ]);
  await db.insert(signInLocations).values({ editorId: ed.id, ipKey: `net-${ed.id}` });
  await db.insert(signInDevices).values({ editorId: ed.id, deviceKey: `dev-${ed.id}` });
  // A notification slot a reader's device used for one of their poems (Phase 18).
  const [device] = await db
    .insert(pushSubscriptions)
    .values({ endpoint: `https://fcm.googleapis.com/fcm/send/${ed.id}`, p256dh: "k", auth: "a" })
    .returning({ id: pushSubscriptions.id });
  await db.insert(pushDeliveries).values({ subscriptionId: device.id, editorId: ed.id, poemId: one.id });
  // A reader's device following them (Phase 18 round 2).
  await db.insert(pushFollows).values({ subscriptionId: device.id, editorId: ed.id });
  // Not linked by foreign keys: a pending sign-in code and rate-limit counters naming them.
  await requestOtp({ email: ed.email });
  await rateLimit(`signin-alert:${ed.id}`, 5, 86400);
  await rateLimit(`export:${ed.id}`, 10, 3600);
  await rateLimit(`stepup:cooldown:${ed.sessionId}`, 1, 60);
  // A short link with a visit counted (Phase 21 round 3): its row, and the counter naming the poem.
  await ensureShortCode(one.id);
  await countShareVisit(one.id, "198.51.100.7");
  // A novel with a published chapter that has two saved versions (Phase 23).
  const book = await createNovel(ed.id, { title: `${penName} Saga`, blurb: "A long story." });
  if (!book.ok) throw new Error(JSON.stringify(book));
  const ch = await createChapter(ed.id, book.novel.id, { title: "One", body: "It began.", status: "published" });
  if (!ch.ok) throw new Error(JSON.stringify(ch));
  await saveChapter(ed.id, ch.chapter.id, { title: "One", body: "It began, again." });
  return { ...ed, poemId: one.id, poemSlug: one.slug, collectionSlug: col.collection.slug };
}

/** Foreign keys in the schema: (table, column) → referenced table. */
async function foreignKeys() {
  const res = (await db.execute(sql`
    SELECT tc.table_name AS "table", kcu.column_name AS "column", ccu.table_name AS "ref"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `)) as unknown as Rows<{ table: string; column: string; ref: string }>;
  return res.rows;
}

/**
 * The ids of every row that belongs to this editor, in every table that
 * references editors directly or through another such table (sessions,
 * poems, collections…), found by walking the schema's foreign keys.
 */
async function ownedRows(editorId: string): Promise<Map<string, Set<string>>> {
  const fks = await foreignKeys();
  const owned = new Map<string, Set<string>>([["editors", new Set([editorId])]]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { table, column, ref } of fks) {
      if (table === "editors") continue; // editors.pinned_poem_id points back at poems
      const refIds = [...(owned.get(ref) ?? [])];
      if (refIds.length === 0) continue;
      const res = (await db.execute(
        sql`SELECT id::text FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)}::text IN (${sql.join(
          refIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )) as unknown as Rows<{ id: string }>;
      const set = owned.get(table) ?? new Set<string>();
      for (const { id } of res.rows) {
        if (!set.has(id)) {
          set.add(id);
          changed = true;
        }
      }
      owned.set(table, set);
    }
  }
  return owned;
}

async function stillThere(owned: Map<string, Set<string>>) {
  const left: Record<string, number> = {};
  for (const [table, ids] of owned) {
    if (ids.size === 0) continue;
    const res = (await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id::text IN (${sql.join([...ids].map((id) => sql`${id}`), sql`, `)})`,
    )) as unknown as Rows<{ n: number }>;
    left[table] = res.rows[0].n;
  }
  return left;
}

const remove = (ed: { id: string; sessionId: string }, confirmation: string) =>
  deleteAccount({ editorId: ed.id, sessionId: ed.sessionId, confirmation, userAgent: UA });

describe("deleting an account", () => {
  it("removes every row of the editor in every table that references them, and nothing of anyone else's", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    const eve = await populated("eve@example.com", "Eve Other");

    const owned = await ownedRows(ada.id);
    const theirs = await ownedRows(eve.id);
    // The walk finds every table that can hold something of an editor's, and
    // the fixture has rows in each: a new such table fails here until the
    // fixture (and deletion) cover it.
    const tables = [...(await foreignKeys())].map((f) => f.table).filter((t) => t !== "editors");
    for (const t of new Set(tables)) {
      if (owned.has(t)) expect(owned.get(t)!.size, `fixture rows in ${t}`).toBeGreaterThan(0);
    }
    expect([...owned.keys()].sort()).toEqual(
      [
        "collections",
        "editors",
        "passkeys",
        "poem_revisions",
        "poems",
        "push_deliveries",
        "push_follows",
        "novels",
        "chapters",
        "chapter_revisions",
        "recovery_codes",
        "sessions",
        "short_links",
        "sign_in_devices",
        "sign_in_locations",
        "step_up_codes",
        "webauthn_challenges",
      ].sort(),
    );

    expect(await remove(ada, "Ada Verse")).toMatchObject({ ok: true });

    const left = await stillThere(owned);
    expect(Object.values(left).every((n) => n === 0), JSON.stringify(left)).toBe(true);
    const theirsLeft = await stillThere(theirs);
    for (const [table, ids] of theirs) expect(theirsLeft[table] ?? 0, table).toBe(ids.size);
  });

  it("also removes what isn't linked by a foreign key: sign-in codes and rate-limit counters", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    const eve = await populated("eve@example.com", "Eve Other");
    // The editor, a session, the email's hash, or one of their poems (share-visit counters, Phase 21 round 3).
    const named = (ed: typeof ada) => [ed.id, ed.sessionId, sha256(ed.email), ed.poemId];
    const countKeys = async (ed: typeof ada) => {
      const all = await db.select({ key: rateLimits.key }).from(rateLimits);
      return all.filter((r) => named(ed).some((n) => r.key.includes(n))).length;
    };
    expect(await countKeys(ada)).toBeGreaterThanOrEqual(5);
    const visitKey = `share:visit:${ada.poemId}:198.51.100.7`;
    expect((await db.select().from(rateLimits).where(eq(rateLimits.key, visitKey))).length).toBe(1);
    const [link] = await db.select().from(shortLinks).where(eq(shortLinks.poemId, ada.poemId));
    await remove(ada, "Ada Verse");
    expect(await db.select().from(rateLimits).where(eq(rateLimits.key, visitKey))).toEqual([]);
    // The short link and its count are gone; its code is retired, never given to another poem.
    expect(await db.select().from(shortLinks).where(eq(shortLinks.poemId, ada.poemId))).toEqual([]);
    expect((await db.select().from(retiredShortCodes)).map((r) => r.code)).toContain(link.code);
    expect(await db.select().from(emailOtps).where(eq(emailOtps.email, ada.email))).toEqual([]);
    expect(await countKeys(ada)).toBe(0);
    expect(await db.select().from(emailOtps).where(eq(emailOtps.email, eve.email))).toHaveLength(1);
    expect(await countKeys(eve)).toBeGreaterThanOrEqual(5);
  });

  it("needs a recent verification: email or passkey, not a recovery-code sign-in alone", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    await db
      .update(sessions)
      .set({ emailVerifiedAt: sql`now() - make_interval(secs => ${STEP_UP_WINDOW_SECONDS + 1})` })
      .where(eq(sessions.id, ada.sessionId));
    expect(await remove(ada, "Ada Verse")).toEqual({ ok: false, error: "step_up_required" });

    const { token } = await createSession(ada.id, {}, { method: "recovery" });
    const recovery = (await validateSession(token))!.sessionId;
    expect(await remove({ id: ada.id, sessionId: recovery }, "Ada Verse")).toEqual({ ok: false, error: "step_up_required" });
    expect(await db.select().from(editors).where(eq(editors.id, ada.id))).toHaveLength(1);
    expect(deletionNotices).toHaveLength(0);

    // A passkey confirmation counts.
    await db.update(sessions).set({ passkeyVerifiedAt: sql`now()` }).where(eq(sessions.id, recovery));
    expect(await remove({ id: ada.id, sessionId: recovery }, "Ada Verse")).toMatchObject({ ok: true });
  });

  it("needs the pen name typed back (case matters; spacing and Unicode form don't)", async () => {
    const ed = await signedUp("jose@example.com", "José  Àsante");
    expect(confirmsPenName("josé àsante", "José Àsante")).toBe(false);
    expect(confirmsPenName("  José   Àsante ", "José Àsante")).toBe(true);
    expect(confirmsPenName("José Àsante", "José Àsante")).toBe(true);
    expect(confirmsPenName(42, "José Àsante")).toBe(false);
    expect(await remove(ed, "jose asante")).toEqual({ ok: false, error: "wrong_confirmation" });
    expect(await remove(ed, "")).toEqual({ ok: false, error: "wrong_confirmation" });
    expect(await db.select().from(editors).where(eq(editors.id, ed.id))).toHaveLength(1);
    expect((await remove(ed, "José Àsante")).ok).toBe(true);
  });

  it("returns the poem ids (for the per-poem cache tags) and emails a notice", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    const ids = (await db.select({ id: poems.id }).from(poems).where(eq(poems.editorId, ada.id))).map((p) => p.id);
    const res = await remove(ada, "Ada Verse");
    expect(res.ok && [...res.poemIds].sort()).toEqual([...ids].sort());
    expect(deletionNotices).toEqual([
      { to: "ada@example.com", penName: "Ada Verse", device: "Firefox on Linux", at: expect.any(Date) },
    ]);
  });

  it("takes the author off every reader page at once: board, author page, poems, collections, feeds, search", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    await populated("eve@example.com", "Eve Other");
    expect((await loadBoardSections()).map((s) => s.slug)).toContain(ada.slug);
    expect(await loadAuthorPage(ada.slug)).not.toBeNull();
    expect(await loadReaderPoem(ada.slug, ada.poemSlug)).not.toBeNull();
    expect(await loadCollectionPage(ada.slug, ada.collectionSlug)).not.toBeNull();
    expect(await loadSiteFeed()).toContain("Ada Verse Ode");
    expect((await searchBoard("Ada")).authors).toHaveLength(1);

    await remove(ada, "Ada Verse");
    const sections = await loadBoardSections();
    expect(sections.map((s) => s.slug)).toEqual(["eve-other"]);
    expect(await loadAuthorPage(ada.slug)).toBeNull();
    expect(await loadReaderPoem(ada.slug, ada.poemSlug)).toBeNull();
    expect(await loadCollectionPage(ada.slug, ada.collectionSlug)).toBeNull();
    expect(await loadAuthorFeed(ada.slug)).toBeNull();
    const feed = await loadSiteFeed();
    expect(feed).not.toContain("Ada Verse");
    expect(feed).toContain("Eve Other Ode");
    expect(await searchBoard("Ada")).toEqual({ authors: [], novels: [], poems: [] });
    expect((await searchBoard("Ode")).poems.map((p) => p.penName)).toEqual(["Eve Other"]);
  });

  it("retires the slug: stored alone, never given to anyone again", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    await remove(ada, "Ada Verse");
    const retired = await db.select().from(retiredSlugs);
    expect(retired).toEqual([{ slug: "ada-verse", retiredAt: expect.any(Date) }]);

    // Someone else choosing the same pen name gets a different slug…
    const other = await signedUp("other@example.com", "Ada Verse");
    expect(other.slug).toBe("ada-verse-2");
    // …and the database refuses the retired one outright.
    await expect(db.update(editors).set({ slug: "ada-verse" }).where(eq(editors.id, other.id))).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });

  it("retires numbered slugs too, and onboarding skips past them", async () => {
    await db.insert(retiredSlugs).values([{ slug: "rumi" }, { slug: "rumi-2" }]);
    const ed = await signedUp("rumi@example.com", "Rumi");
    expect(ed.slug).toBe("rumi-3");
  });

  it("signing up again with the same email starts a fresh account: new id, new slug, a welcome again", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    await sendWelcomeOnce(ada.id);
    expect(welcomes).toHaveLength(1);
    await remove(ada, "Ada Verse");

    // No cooldown left over from the old account (its counters went with it).
    expect(await requestOtp({ email: "ada@example.com" })).toMatchObject({ ok: true });
    const again = await verifyOtp({ email: "ada@example.com", code: lastCodeFor("ada@example.com") });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.editor.id).not.toBe(ada.id);
    expect(again.editor).toMatchObject({ penName: null, slug: null, welcomedAt: null, bio: null });
    expect(await db.select().from(poems).where(eq(poems.editorId, again.editor.id))).toEqual([]);
    const slug = await setPenName(again.editor.id, "Ada Verse");
    expect(slug).toEqual({ ok: true, slug: "ada-verse-2" });
    expect(await sendWelcomeOnce(again.editor.id)).toBe(true);
    expect(welcomes).toHaveLength(2);
  });

  it("an unknown editor or a revoked session deletes nothing", async () => {
    const ada = await populated("ada@example.com", "Ada Verse");
    expect(await remove({ id: "00000000-0000-0000-0000-000000000000", sessionId: ada.sessionId }, "Ada Verse")).toEqual({
      ok: false,
      error: "no_session",
    });
    await db.delete(sessions).where(eq(sessions.id, ada.sessionId));
    expect(await remove(ada, "Ada Verse")).toEqual({ ok: false, error: "step_up_required" });
    expect(await db.select().from(editors).where(eq(editors.id, ada.id))).toHaveLength(1);
  });
});

describe("deleting an account with a profile photo (Phase 22)", () => {
  it("deletes the photo's files from storage, not just the row, and leaves other editors' photos", async () => {
    const { savePhoto, photoObjects } = await import("@/server/profile-photos");
    const { photoStorage } = await import("@/server/storage");
    const { fileOf, png } = await import("../support/photos");
    const ada = await signedUp("ada@example.com", "Ada Verse");
    const eve = await signedUp("eve@example.com", "Eve Other");
    const mine = await savePhoto(ada.id, { file: fileOf(await png()), crop: "0,0,1" });
    const theirs = await savePhoto(eve.id, { file: fileOf(await png()), crop: "0,0,1" });
    if (!mine.ok || !theirs.ok) throw new Error("save failed");
    const files = async () => (await photoStorage().list("photos/")).map((o) => o.key).sort();
    expect(await files()).toEqual([...photoObjects(mine.photoKey), ...photoObjects(theirs.photoKey)].sort());

    expect(await remove(ada, "Ada Verse")).toMatchObject({ ok: true });
    expect(await files()).toEqual(photoObjects(theirs.photoKey).sort());
  });
});
