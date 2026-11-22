import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { BOARD_TAG } from "@/server/cache-tags";
import { createSession } from "@/server/auth/sessions";
import { loadAuthorPage, loadBoardSections, loadSerialsPage } from "@/server/board";
import { featuredEmail } from "@/server/email-templates";
import { loadEditorExport } from "@/server/export";
import { FEATURED_MAX, featureWork, loadFeaturedForOwner, unfeatureWork } from "@/server/featured";
import { listNovels } from "@/server/novels";
import { listEditorPoems } from "@/server/poems";
import { applyTakedown, findTakedownTarget, parseTakedownLink, type TakedownLink } from "@/server/takedown";
import { featuredFromSections } from "@/lib/featured";
import { withRelease } from "../support/chapters";
import { featuredNotices } from "../support/outbox";

/* Featured (docs/PLAN.md, Phase 33). */

const cache = vi.hoisted(() => ({ updateTag: vi.fn(), refresh: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/cache", () => cache);
const who = vi.hoisted(() => ({ token: "" }));
vi.mock("@/server/auth/dal", async () => {
  const { notFound } = await import("next/navigation");
  const { resolveOwner } = await import("@/server/auth/owner");
  const { validateSession } = await import("@/server/auth/sessions");
  return {
    requireOwner: async () => {
      const owner = await resolveOwner(await validateSession(who.token));
      if (!owner) notFound();
      return owner;
    },
  };
});
vi.spyOn(console, "info").mockImplementation(() => {});
const { ownerFeatureAction, ownerUnfeatureAction } = await import("@/app/admin/(dashboard)/owner/actions");

const db = getDb();
const OWNER = "owner@example.org";
let ownerId: string;
let ama: string;
let novelId: string;

afterEach(() => {
  delete process.env.OWNER_EMAIL;
  resetEnvCache();
});

beforeEach(async () => {
  process.env.OWNER_EMAIL = OWNER;
  resetEnvCache();
  cache.updateTag.mockClear();
  const [o, a] = await db
    .insert(editors)
    .values([
      { email: OWNER, penName: "Owner", slug: "owner" },
      { email: "ama@example.com", penName: "Ama", slug: "ama" },
    ])
    .returning();
  ownerId = o.id;
  ama = a.id;
  const now = new Date();
  await db.insert(poems).values([
    { editorId: ama, title: "Dusk", slug: "dusk", body: "x", status: "published", publishedAt: now },
    { editorId: ama, title: "Draft", slug: "draft", body: "x", status: "draft" },
    ...Array.from({ length: 6 }, (_, i) => ({ editorId: ama, title: `P${i}`, slug: `p${i}`, body: "x", status: "published" as const, publishedAt: now })),
  ]);
  const [n, later] = await db
    .insert(novels)
    .values([
      { editorId: ama, title: "The Ferry", slug: "ferry" },
      { editorId: ama, title: "Soon", slug: "soon" },
    ])
    .returning();
  novelId = n.id;
  await db.insert(chapters).values(withRelease({ novelId, title: "Landing", slug: "landing", body: "It began.", position: 1, status: "published", publishedAt: now }));
  // A novel whose only chapter is scheduled: not released, not shown.
  await db.insert(chapters).values({ novelId: later.id, title: "One", slug: "one", body: "x", position: 1, status: "published", publishedAt: sql`now() + interval '1 day'`, releaseAt: sql`now() + interval '1 day'` });
});

const signIn = async (editorId: string) => {
  who.token = (await createSession(editorId)).token;
};
const boardFeatured = async () => featuredFromSections(await loadBoardSections()).map((f) => f.title);
const link = (raw: string) => parseTakedownLink(raw) as TakedownLink;

describe("featuring (the owner's page)", () => {
  it("only the owner; no step-up; refreshes the board; emails the writer on the first feature only", async () => {
    await signIn(ama);
    await expect(ownerFeatureAction("/p/ama/dusk")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(ownerUnfeatureAction("poem", ownerId)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await signIn(ownerId);
    // A stale session is fine: featuring takes nothing from anyone.
    await db.execute(sql`UPDATE sessions SET email_verified_at = now() - interval '1 day'`);
    expect(await ownerFeatureAction("/p/ama/dusk")).toMatchObject({ ok: true, title: "Featured" });
    expect(cache.updateTag).toHaveBeenCalledWith(BOARD_TAG);
    await vi.waitFor(() => expect(featuredNotices).toHaveLength(1));
    expect(featuredNotices[0]).toEqual({ to: "ama@example.com", penName: "Ama", kind: "poem", title: "Dusk", path: "/p/ama/dusk" });
    const [item] = await loadFeaturedForOwner();
    expect(await ownerUnfeatureAction("poem", item.id)).toMatchObject({ ok: true });
    expect(await ownerFeatureAction("/p/ama/dusk")).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(featuredNotices).toHaveLength(1);
  });

  it("refuses what readers can't see, authors, a duplicate and a seventh, each with its reason", async () => {
    expect(await featureWork("/p/ama/draft")).toEqual({ ok: false, error: "not_shown" });
    expect(await featureWork("/a/ama/n/soon")).toEqual({ ok: false, error: "not_shown" });
    expect(await featureWork("/a/ama")).toEqual({ ok: false, error: "author" });
    expect(await featureWork("/about")).toEqual({ ok: false, error: "bad_link" });
    expect(await featureWork("/p/ama/nope")).toEqual({ ok: false, error: "not_found" });
    await db.update(poems).set({ visibility: "private", passwordHash: "scrypt$x" }).where(eq(poems.slug, "p5"));
    expect(await featureWork("/p/ama/p5")).toEqual({ ok: false, error: "not_shown" });
    await db.update(poems).set({ hiddenAt: new Date() }).where(eq(poems.slug, "p4"));
    expect(await featureWork("/p/ama/p4")).toEqual({ ok: false, error: "not_shown" });
    // A chapter link features its novel.
    expect(await featureWork("/a/ama/n/ferry/landing")).toMatchObject({ ok: true, kind: "novel", title: "The Ferry" });
    expect(await featureWork("/a/ama/n/ferry")).toEqual({ ok: false, error: "already" });
    for (const s of ["dusk", "p0", "p1", "p2", "p3"]) expect(await featureWork(`/p/ama/${s}`), s).toMatchObject({ ok: true });
    expect(FEATURED_MAX).toBe(6);
    await db.update(poems).set({ hiddenAt: null }).where(eq(poems.slug, "p4"));
    expect(await featureWork("/p/ama/p4")).toEqual({ ok: false, error: "full" });
  });

  it("the cap holds when two tabs feature at once", async () => {
    for (const s of ["p0", "p1", "p2", "p3", "p4"]) await featureWork(`/p/ama/${s}`);
    const results = await Promise.all([featureWork("/p/ama/dusk"), featureWork("/p/ama/p5")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error)).toEqual(["full"]);
  });

  it("removing something not featured changes nothing", async () => {
    expect(await unfeatureWork("poem", "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await unfeatureWork("author", ama)).toBe(false);
  });
});

describe("what readers see", () => {
  it("the board's panel, the cards' mark, the author page and /novels, newest featured first", async () => {
    await featureWork("/p/ama/dusk");
    await featureWork("/a/ama/n/ferry");
    expect(await boardFeatured()).toEqual(["The Ferry", "Dusk"]);
    const section = (await loadBoardSections()).find((s) => s.slug === "ama")!;
    expect(section.poems.find((p) => p.slug === "dusk")!.featuredAt).toEqual(expect.any(String));
    expect(section.poems.find((p) => p.slug === "p0")!.featuredAt).toBeNull();
    expect(section.novels[0].featuredAt).toEqual(expect.any(String));
    expect((await loadAuthorPage("ama"))!.poems.find((p) => p.slug === "dusk")!.featuredAt).not.toBeNull();
    const serials = await loadSerialsPage();
    expect(serials.ongoing.find((n) => n.slug === "ferry")!.featuredAt).not.toBeNull();
  });

  it("drops out while hidden, private, unpublished or its author hidden; back on restore; the owner's list says so", async () => {
    await featureWork("/p/ama/dusk");
    await featureWork("/a/ama/n/ferry");
    const hide = async (raw: string, action: "hide" | "restore") => applyTakedown((await findTakedownTarget(link(raw)))!, action);

    await hide("/p/ama/dusk", "hide");
    expect(await boardFeatured()).toEqual(["The Ferry"]);
    expect((await loadFeaturedForOwner()).map((f) => [f.title, f.shown])).toEqual([
      ["The Ferry", true],
      ["Dusk", false],
    ]);
    await hide("/p/ama/dusk", "restore");
    expect(await boardFeatured()).toEqual(["The Ferry", "Dusk"]);

    await db.update(novels).set({ visibility: "private", passwordHash: "scrypt$x" }).where(eq(novels.id, novelId));
    expect(await boardFeatured()).toEqual(["Dusk"]);
    expect((await loadSerialsPage()).ongoing.find((n) => n.slug === "ferry")!.featuredAt).toBeNull();
    await db.update(novels).set({ visibility: "public", passwordHash: null }).where(eq(novels.id, novelId));

    await db.update(poems).set({ status: "draft" }).where(eq(poems.slug, "dusk"));
    expect(await boardFeatured()).toEqual(["The Ferry"]);
    await db.update(poems).set({ status: "published" }).where(eq(poems.slug, "dusk"));

    await hide("/a/ama", "hide");
    expect(await boardFeatured()).toEqual([]);
    expect((await loadFeaturedForOwner()).every((f) => !f.shown)).toBe(true);
    await hide("/a/ama", "restore");
    expect(await boardFeatured()).toEqual(["The Ferry", "Dusk"]);
    // The featured mark never left the rows.
    expect((await db.select({ f: poems.featuredAt }).from(poems).where(eq(poems.slug, "dusk")))[0].f).not.toBeNull();
  });
});

describe("the writer", () => {
  it("their rows say featured while shown; the download carries featuredAt", async () => {
    await featureWork("/p/ama/dusk");
    await featureWork("/a/ama/n/ferry");
    expect((await listEditorPoems(ama)).filter((p) => p.featured).map((p) => p.slug)).toEqual(["dusk"]);
    expect((await listNovels(ama)).find((n) => n.slug === "ferry")!.featured).toBe(true);
    await db.update(poems).set({ hiddenAt: new Date() }).where(eq(poems.slug, "dusk"));
    expect((await listEditorPoems(ama)).some((p) => p.featured)).toBe(false);
    const data = await loadEditorExport(ama, { site: "https://inkboard.example" });
    expect(data?.version).toBe(10);
    expect(data?.poems.find((p) => p.slug === "dusk")?.featuredAt).toEqual(expect.any(String));
    expect(data?.poems.find((p) => p.slug === "p0")?.featuredAt).toBeNull();
    expect(data?.novels.find((n) => n.slug === "ferry")?.featuredAt).toEqual(expect.any(String));
  });

  it("the email: what, the link, and the notice rules", () => {
    const m = featuredEmail({ penName: "Ama", kind: "poem", title: "Dusk", link: "https://inkboard.example/p/ama/dusk", appUrl: "https://inkboard.example" });
    expect(m.subject).toBe("Your poem is featured on InkBoard");
    expect(m.text).toContain("your poem “Dusk”");
    expect(m.text).toContain("https://inkboard.example/p/ama/dusk");
    expect(m.html).toContain('href="https://inkboard.example/p/ama/dusk"');
    expect(m.text).not.toMatch(/\d{4,8}|\bcode\b/i);
    expect(featuredEmail({ penName: "Ama", kind: "novel", title: "Book 2026", link: "https://x.example/a/ama/n/b", appUrl: "https://x.example" }).text).toContain("one of your novels");
  });
});
