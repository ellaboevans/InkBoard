import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems, reports, sessions } from "@/db/schema";
import { env, resetEnvCache } from "@/env";
import { BOARD_TAG, poemTag } from "@/server/cache-tags";
import { resolveOwner } from "@/server/auth/owner";
import { createSession, validateSession } from "@/server/auth/sessions";
import { reportEmail } from "@/server/email-templates";
import { loadHiddenNow, loadOpenReportGroups, loadReviewedReportGroups, markReportsReviewed } from "@/server/owner-reports";
import { handleTakedown } from "@/server/takedown-route";
import { withRelease } from "../support/chapters";
import { takedownNotices } from "../support/outbox";

/*
 * The owner's page (docs/PLAN.md, Phase 32 round 3): who the owner is, the
 * actions' owner and step-up checks, the same takedown path as the route,
 * "Mark as reviewed", the grouped loader and the report email's new line.
 */

// Next's cache functions can't run under Vitest; the DAL's requireOwner is the real
// resolveOwner over a session the test picks (cookies() can't run here either).
const cache = vi.hoisted(() => ({ updateTag: vi.fn(), refresh: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/cache", () => cache);
const who = vi.hoisted(() => ({ token: "" }));
vi.mock("@/server/auth/dal", async () => {
  const { notFound } = await import("next/navigation");
  const { resolveOwner: resolve } = await import("@/server/auth/owner");
  const { validateSession: validate } = await import("@/server/auth/sessions");
  return {
    requireOwner: async () => {
      const owner = await resolve(await validate(who.token));
      if (!owner) notFound();
      return owner;
    },
  };
});
vi.spyOn(console, "info").mockImplementation(() => {});

const { ownerMarkReviewedAction, ownerTakedownAction } = await import("@/app/admin/(dashboard)/owner/actions");

const db = getDb();
const OWNER = "the-owner@example.org";
const SECRET = "owner-secret-owner-secret-owner-secret-1";

function setOwnerEmail(value: string | undefined) {
  if (value === undefined) delete process.env.OWNER_EMAIL;
  else process.env.OWNER_EMAIL = value;
  resetEnvCache();
}
afterEach(() => setOwnerEmail(undefined));

let ownerId: string;
let ama: string;
let duskId: string;
let dawnId: string;
let novelId: string;
let chapterId: string;

beforeEach(async () => {
  setOwnerEmail(OWNER);
  process.env.CRON_SECRET = SECRET;
  resetEnvCache();
  cache.updateTag.mockClear();
  cache.refresh.mockClear();
  const [o, a] = await db
    .insert(editors)
    .values([
      { email: OWNER, penName: "Site Owner", slug: "site-owner" },
      { email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama" },
    ])
    .returning();
  ownerId = o.id;
  ama = a.id;
  const now = new Date();
  const [dusk, dawn] = await db
    .insert(poems)
    .values([
      { editorId: ama, title: "Dusk", slug: "dusk", body: "SECRET-POEM-TEXT", status: "published", publishedAt: now },
      { editorId: ama, title: "Dawn", slug: "dawn", body: "Dawn lines.", status: "published", publishedAt: now },
    ])
    .returning();
  duskId = dusk.id;
  dawnId = dawn.id;
  const [n] = await db.insert(novels).values({ editorId: ama, title: "The Ferry", slug: "ferry" }).returning();
  novelId = n.id;
  const [c] = await db
    .insert(chapters)
    .values(withRelease({ novelId, title: "Landing", slug: "landing", body: "SECRET-CHAPTER-TEXT", position: 1, status: "published", publishedAt: now }))
    .returning();
  chapterId = c.id;
});

/** A signed-in session for this editor, as the actions would see it. */
async function signIn(editorId: string, options: Parameters<typeof createSession>[2] = {}) {
  const { token } = await createSession(editorId, {}, options);
  who.token = token;
  return (await validateSession(token))!;
}
const makeStale = (sessionId: string) =>
  db.update(sessions).set({ emailVerifiedAt: sql`now() - interval '1 hour'` }).where(eq(sessions.id, sessionId));
const hiddenAt = async (id: string) => (await db.select({ h: poems.hiddenAt }).from(poems).where(eq(poems.id, id)))[0].h;
const expectNotFound = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ digest: expect.stringContaining("404") });

describe("who is the owner", () => {
  it("the onboarded editor whose email matches OWNER_EMAIL, compared after normalising", async () => {
    const session = await signIn(ownerId);
    for (const variant of [OWNER, "The-Owner@Example.ORG", `  ${OWNER.toUpperCase()}  `]) {
      setOwnerEmail(variant);
      expect(await resolveOwner(session), variant).toMatchObject({ editor: { id: ownerId }, sessionId: session.sessionId });
    }
  });

  it("nobody when OWNER_EMAIL is unset or empty; never another editor", async () => {
    const owner = await signIn(ownerId);
    const other = await signIn(ama);
    setOwnerEmail(undefined);
    expect(await resolveOwner(owner)).toBeNull();
    setOwnerEmail("   ");
    expect(await resolveOwner(owner)).toBeNull();
    setOwnerEmail(OWNER);
    expect(await resolveOwner(other)).toBeNull();
    expect(await resolveOwner(null)).toBeNull();
  });

  it("not before onboarding, not on a public device, not on an ended session", async () => {
    const pub = await signIn(ownerId, { publicDevice: true });
    expect(await resolveOwner(pub)).toBeNull();
    const live = await signIn(ownerId);
    await db.delete(sessions).where(eq(sessions.id, live.sessionId));
    expect(await resolveOwner(live)).toBeNull();
    const fresh = await signIn(ownerId);
    await db.update(editors).set({ penName: null, slug: null }).where(eq(editors.id, ownerId));
    expect(await resolveOwner(await validateSession(who.token))).toBeNull();
    expect(fresh.sessionId).toBeTruthy();
  });

  it("an OWNER_EMAIL that isn't an address is refused at startup", () => {
    setOwnerEmail("not an email");
    expect(() => env()).toThrow(/OWNER_EMAIL/);
  });

  it("the address comes only from the environment: OWNER_EMAIL is read in env.ts and owner.ts alone", () => {
    const users = execFileSync("git", ["grep", "-l", "--untracked", "OWNER_EMAIL", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(users).toEqual(["src/env.ts", "src/server/auth/owner.ts"]);
  });
});

describe("the owner's actions", () => {
  it("refuse anyone who isn't the owner with the same not-found, changing nothing", async () => {
    await db.insert(reports).values({ poemId: duskId, reason: "spam" });
    await signIn(ama);
    await expectNotFound(ownerTakedownAction("/p/ama/dusk", "hide"));
    await expectNotFound(ownerMarkReviewedAction("poem", duskId));
    await signIn(ownerId, { publicDevice: true });
    await expectNotFound(ownerTakedownAction("/p/ama/dusk", "hide"));
    setOwnerEmail(undefined);
    await signIn(ownerId);
    await expectNotFound(ownerTakedownAction("/p/ama/dusk", "hide"));
    expect(await hiddenAt(duskId)).toBeNull();
    expect((await db.select().from(reports))[0].reviewedAt).toBeNull();
    expect(takedownNotices).toEqual([]);
  });

  it("need a recent verification: a stale session changes nothing and is asked to step up", async () => {
    await db.insert(reports).values({ poemId: duskId, reason: "spam" });
    const s = await signIn(ownerId);
    await makeStale(s.sessionId);
    expect(await ownerTakedownAction("/p/ama/dusk", "hide")).toEqual({ ok: false, reason: "step_up" });
    expect(await ownerMarkReviewedAction("poem", duskId)).toEqual({ ok: false, reason: "step_up" });
    expect(await hiddenAt(duskId)).toBeNull();
    expect((await db.select().from(reports))[0].reviewedAt).toBeNull();
    expect(takedownNotices).toEqual([]);
    expect(cache.updateTag).not.toHaveBeenCalled();
    // A recovery-code sign-in proved nothing either.
    await signIn(ownerId, { method: "recovery" });
    expect(await ownerTakedownAction("/p/ama/dusk", "hide")).toEqual({ ok: false, reason: "step_up" });
  });

  it("a fresh owner session hides and restores, refreshing the caches and emailing the writer", async () => {
    await signIn(ownerId);
    expect(await ownerTakedownAction("/p/ama/dusk", "hide")).toMatchObject({ ok: true, title: "Hidden from readers" });
    expect(await hiddenAt(duskId)).not.toBeNull();
    expect(cache.updateTag).toHaveBeenCalledWith(BOARD_TAG);
    expect(cache.updateTag).toHaveBeenCalledWith(poemTag(duskId));
    expect(cache.refresh).toHaveBeenCalled();
    expect(await ownerTakedownAction("/p/ama/dusk", "hide")).toMatchObject({ ok: true, title: "Already hidden" });
    expect(await ownerTakedownAction("/p/ama/dusk", "restore")).toMatchObject({ ok: true, title: "Restored" });
    expect(await hiddenAt(duskId)).toBeNull();
    expect(takedownNotices.map((n) => [n.to, n.change, n.kind, n.title])).toEqual([
      ["ama@example.com", "hidden", "poem", "Dusk"],
      ["ama@example.com", "restored", "poem", "Dusk"],
    ]);
  });

  it("hiding from the page and from the route give the same result and the same writer email", async () => {
    await signIn(ownerId);
    await ownerTakedownAction("/p/ama/dusk", "hide");
    const route = await handleTakedown(
      new Request("http://localhost/api/owner/takedown", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ link: "/p/ama/dawn", action: "hide" }),
      }),
      vi.fn(),
      async (to, change, d) => {
        takedownNotices.push({ to, change, ...d });
      },
    );
    expect(await route.json()).toMatchObject({ changed: true, kind: "poem", path: "/p/ama/dawn" });
    expect(await hiddenAt(dawnId)).not.toBeNull();
    const [fromPage, fromRoute] = takedownNotices;
    expect({ ...fromPage, title: null, at: null }).toEqual({ ...fromRoute, title: null, at: null });
    // The route then sees the page's hide as "already hidden", and vice versa.
    const again = await handleTakedown(
      new Request("http://localhost/api/owner/takedown", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ link: "/p/ama/dusk", action: "hide" }),
      }),
      vi.fn(),
      vi.fn(),
    );
    expect(await again.json()).toMatchObject({ changed: false });
    expect(await ownerTakedownAction("/p/ama/dawn", "hide")).toMatchObject({ title: "Already hidden" });
  });

  it("a chapter's group hides the whole novel", async () => {
    await signIn(ownerId);
    expect(await ownerTakedownAction("/a/ama/n/ferry/landing", "hide")).toMatchObject({ ok: true, description: expect.stringContaining("“The Ferry” and its chapters") });
    expect((await db.select({ h: novels.hiddenAt }).from(novels).where(eq(novels.id, novelId)))[0].h).not.toBeNull();
  });

  it("mark as reviewed closes only that page's open reports", async () => {
    await db.insert(reports).values([
      { poemId: duskId, reason: "spam" },
      { poemId: duskId, reason: "copied" },
      { poemId: dawnId, reason: "spam" },
      { chapterId, reason: "other", details: "Hm" },
    ]);
    await signIn(ownerId);
    expect(await ownerMarkReviewedAction("poem", duskId)).toMatchObject({ ok: true, description: "Its 2 reports are closed." });
    const rows = await db.select({ poemId: reports.poemId, chapterId: reports.chapterId, reviewedAt: reports.reviewedAt }).from(reports);
    expect(rows.filter((r) => r.reviewedAt).map((r) => r.poemId)).toEqual([duskId, duskId]);
    expect(rows.filter((r) => !r.reviewedAt)).toHaveLength(2);
    expect(await ownerMarkReviewedAction("poem", duskId)).toMatchObject({ ok: true, description: "Nothing was open." });
    expect(await ownerMarkReviewedAction("collection", duskId)).toMatchObject({ ok: false, reason: "error" });
    expect(await ownerMarkReviewedAction("poem", "not-a-uuid")).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("the grouped loader", () => {
  it("groups open reports by page, newest report's page first, never with poem or chapter text", async () => {
    const t = (minutesAgo: number) => sql`now() - make_interval(mins => ${minutesAgo})`;
    await db.insert(reports).values([
      { poemId: duskId, reason: "spam", createdAt: t(30) },
      { chapterId, reason: "other", details: "<b>not html</b>", createdAt: t(20) },
      { poemId: duskId, reason: "copied", createdAt: t(10) },
      { editorId: ama, reason: "harassment", createdAt: t(40) },
      { poemId: dawnId, reason: "spam", createdAt: t(5), reviewedAt: t(1) },
    ]);
    const groups = await loadOpenReportGroups();
    expect(groups.map((g) => [g.kind, g.title, g.path, g.reports.length])).toEqual([
      ["poem", "Dusk", "/p/ama/dusk", 2],
      ["chapter", "The Ferry, Landing", "/a/ama/n/ferry/landing", 1],
      ["author", "Ama Sɛwaa", "/a/ama", 1],
    ]);
    expect(groups[0].reports.map((r) => r.reasonLabel)).toEqual(["Copied from someone else", "Spam or advertising"]);
    expect(groups[1]).toMatchObject({ novelTitle: "The Ferry", hidden: false, reports: [{ details: "<b>not html</b>" }] });
    const json = JSON.stringify(groups);
    expect(json).not.toContain("SECRET-POEM-TEXT");
    expect(json).not.toContain("SECRET-CHAPTER-TEXT");
    expect((await loadReviewedReportGroups()).map((g) => g.title)).toEqual(["Dawn"]);
  });

  it("says what's hidden now (the page, its novel or its author), and lists everything hidden", async () => {
    await db.insert(reports).values([
      { chapterId, reason: "spam", createdAt: sql`now() - interval '2 minutes'` },
      { poemId: duskId, reason: "spam", createdAt: sql`now() - interval '1 minute'` },
    ]);
    await db.update(novels).set({ hiddenAt: sql`now() - interval '1 minute'` }).where(eq(novels.id, novelId));
    expect((await loadOpenReportGroups()).map((g) => [g.kind, g.hidden])).toEqual([
      ["poem", false],
      ["chapter", true],
    ]);
    await db.update(editors).set({ hiddenAt: sql`now()` }).where(eq(editors.id, ama));
    expect((await loadOpenReportGroups()).every((g) => g.hidden)).toBe(true);
    expect((await loadHiddenNow()).map((h) => [h.kind, h.title, h.path])).toEqual([
      ["author", "Ama Sɛwaa", "/a/ama"],
      ["novel", "The Ferry", "/a/ama/n/ferry"],
    ]);
  });

  it("reviewed reports leave the Reviewed tab after 30 days", async () => {
    await db.insert(reports).values([
      { poemId: duskId, reason: "spam", reviewedAt: sql`now() - interval '31 days'` },
      { poemId: dawnId, reason: "spam", reviewedAt: sql`now() - interval '29 days'` },
    ]);
    expect((await loadReviewedReportGroups()).map((g) => g.title)).toEqual(["Dawn"]);
  });

  it("markReportsReviewed's guard runs inside the transaction: false changes nothing", async () => {
    await db.insert(reports).values({ poemId: duskId, reason: "spam" });
    expect(await markReportsReviewed({ kind: "poem", id: duskId }, { guard: async () => false })).toEqual({ ok: false, error: "step_up_required" });
    expect((await db.select().from(reports))[0].reviewedAt).toBeNull();
  });

  it("only the owner's page and its actions import the owner loaders", () => {
    const users = execFileSync("git", ["grep", "-l", "--untracked", "server/owner-reports", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(users).toEqual(["src/app/admin/(dashboard)/owner/actions.ts", "src/app/admin/(dashboard)/owner/page.tsx"]);
    // And both re-authorise through requireOwner.
    for (const f of users) expect(readFileSync(f, "utf8"), f).toContain("requireOwner()");
  });
});

describe("the report email", () => {
  it("links the owner's page above the hide command", () => {
    const m = reportEmail({
      kind: "poem",
      title: "Dusk",
      penName: "Ama",
      link: "https://inkboard.example/p/ama/dusk",
      reason: "Spam or advertising",
      details: null,
      at: new Date(),
      earlier: 0,
      path: "/p/ama/dusk",
      appUrl: "https://inkboard.example",
    });
    const lines = m.text.split("\n");
    const review = lines.indexOf("Review it on InkBoard: https://inkboard.example/admin/owner");
    expect(review).toBeGreaterThan(0);
    expect(review).toBeLessThan(lines.indexOf("pnpm content:hide /p/ama/dusk"));
    expect(m.html).toContain('href="https://inkboard.example/admin/owner"');
  });
});
