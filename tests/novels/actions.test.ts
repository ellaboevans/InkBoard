import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { BOARD_TAG } from "@/server/cache-tags";
import { createChapter, createNovel, publishChapter } from "@/server/novels";

/*
 * The writer's novel actions (Phase 23b): readers now see novels, cached
 * under BOARD_TAG, so every change that reaches them refreshes it. Creating
 * (an empty novel, an empty draft) doesn't, and neither does a failed or
 * foreign write.
 */

const cache = vi.hoisted(() => ({ updateTag: vi.fn(), refresh: vi.fn() }));
vi.mock("next/cache", () => cache);
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("next/navigation", () => nav);
const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/server/auth/dal", () => ({
  requireOnboardedEditor: async () => {
    if (!who.id) throw new Error("NEXT_REDIRECT /sign-in");
    return { id: who.id, penName: "x", slug: "x" };
  },
}));

const actions = await import("@/app/admin/(dashboard)/novels/actions");
const db = getDb();

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function writer() {
  const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
  const [bo] = await db.insert(editors).values({ email: "b@x.com", penName: "Bo", slug: "bo" }).returning();
  const novel = await createNovel(ada.id, { title: "Book" });
  if (!novel.ok) throw new Error("setup");
  const one = await createChapter(ada.id, novel.novel.id, { title: "One", body: "Text one.", status: "published" });
  const two = await createChapter(ada.id, novel.novel.id, { title: "Two", body: "Text two." });
  if (!one.ok || !two.ok) throw new Error("setup");
  who.id = ada.id;
  return { ada, bo, novelId: novel.novel.id, one: one.chapter.id, two: two.chapter.id };
}

/** Runs an action that may end in redirect(); returns whether BOARD_TAG was refreshed. */
async function tagged(run: () => Promise<unknown>) {
  cache.updateTag.mockClear();
  await run().catch((e: Error) => {
    if (!e.message.startsWith("NEXT_REDIRECT")) throw e;
  });
  const calls = cache.updateTag.mock.calls.map((c) => c[0]);
  expect(calls.every((t) => t === BOARD_TAG)).toBe(true);
  return calls.length > 0;
}

beforeEach(() => {
  cache.updateTag.mockClear();
  who.id = "";
});

describe("novel actions refresh what readers see (BOARD_TAG)", () => {
  it("publish, unpublish and edits of a chapter", async () => {
    const { two, one } = await writer();
    expect(await tagged(() => actions.saveChapterAction(two, {}, form({ title: "Two", body: "Text two.", status: "published" })))).toBe(true);
    expect(await tagged(() => actions.saveChapterAction(two, {}, form({ title: "Two", body: "Text two.", status: "draft" })))).toBe(true);
    expect(await tagged(() => actions.saveChapterAction(one, {}, form({ title: "One", body: "Edited." })))).toBe(true);
  });

  it("novel details, moves, reorders and deletes", async () => {
    const { novelId, one, two } = await writer();
    expect(await tagged(() => actions.updateNovelAction(novelId, {}, form({ title: "Book", blurb: "New blurb", status: "complete" })))).toBe(true);
    expect(await tagged(() => actions.moveChapterAction(novelId, two, "up"))).toBe(true);
    expect(await tagged(() => actions.reorderChaptersAction(novelId, [one, two]))).toBe(true);
    expect(await tagged(() => actions.deleteChapterAction(novelId, two))).toBe(true);
    expect(await tagged(() => actions.deleteNovelAction(novelId))).toBe(true);
  });

  it("not for creating (nothing readers can see yet)", async () => {
    const { novelId } = await writer();
    expect(await tagged(() => actions.createNovelAction({}, form({ title: "Another" })))).toBe(false);
    expect(await tagged(() => actions.createChapterAction(novelId))).toBe(false);
  });

  it("not for refused, stale or foreign writes", async () => {
    const { bo, novelId, one, two } = await writer();
    // Publishing an empty chapter is refused.
    expect(await tagged(() => actions.saveChapterAction(two, {}, form({ title: "Two", body: "", status: "published" })))).toBe(false);
    // A stale order.
    expect(await tagged(() => actions.reorderChaptersAction(novelId, [one]))).toBe(false);
    // Someone else's novel and chapters look missing, and refresh nothing.
    who.id = bo.id;
    expect(await tagged(() => actions.updateNovelAction(novelId, {}, form({ title: "Mine now" })))).toBe(false);
    expect(await tagged(() => actions.saveChapterAction(one, {}, form({ title: "x", body: "y", status: "draft" })))).toBe(false);
    expect(await tagged(() => actions.moveChapterAction(novelId, one, "down"))).toBe(false);
    expect(await tagged(() => actions.deleteChapterAction(novelId, one))).toBe(false);
    expect(await tagged(() => actions.deleteNovelAction(novelId))).toBe(false);
    // Ada's chapter is still published.
    expect((await publishChapter(bo.id, one)).ok).toBe(false);
  });
});
