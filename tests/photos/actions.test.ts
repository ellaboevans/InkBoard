import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { BOARD_TAG } from "@/server/cache-tags";
import { photoStorage } from "@/server/storage";
import { fileOf, png } from "../support/photos";

/*
 * The Server Actions and the owner's takedown route (Phase 22): who they act
 * for, and that every change readers could see refreshes BOARD_TAG (board,
 * author page, poem pages, feeds, link cards, share images).
 */

const cache = vi.hoisted(() => ({ updateTag: vi.fn(), refresh: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.spyOn(console, "info").mockImplementation(() => {});
const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/server/auth/dal", () => ({
  requireOnboardedEditor: async () => {
    if (!who.id) throw new Error("NEXT_REDIRECT /sign-in");
    return { id: who.id, penName: "x", slug: "x" };
  },
}));

const { removePhotoAction, savePhotoAction } = await import("@/app/admin/(dashboard)/profile/photo-actions");
const { handlePhotoTakedown } = await import("@/server/photo-takedown-route");
const takedown = (req: Request) => handlePhotoTakedown(req, cache.revalidateTag);

const db = getDb();
const form = async (bytes?: Uint8Array, crop = "0,0,1") => {
  const f = new FormData();
  f.set("photo", fileOf(bytes ?? (await png())));
  f.set("crop", crop);
  return f;
};

beforeEach(() => {
  cache.updateTag.mockClear();
  cache.refresh.mockClear();
  cache.revalidateTag.mockClear();
});

describe("photo actions (Phase 22)", () => {
  it("save: re-authorised, saved for the DAL editor only, BOARD_TAG refreshed", async () => {
    const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
    const [bo] = await db.insert(editors).values({ email: "b@x.com", penName: "Bo", slug: "bo" }).returning();
    who.id = ada.id;
    expect(await savePhotoAction(await form())).toEqual({ ok: true });
    expect(cache.updateTag).toHaveBeenCalledWith(BOARD_TAG);
    expect(cache.refresh).toHaveBeenCalled();
    const rows = await db.select({ id: editors.id, k: editors.photoKey }).from(editors);
    expect(rows.find((r) => r.id === ada.id)!.k).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(rows.find((r) => r.id === bo.id)!.k).toBeNull();
  });

  it("a refused photo changes nothing and refreshes nothing, with a message for the toast", async () => {
    const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
    who.id = ada.id;
    const res = await savePhotoAction(await form(new TextEncoder().encode("hello")));
    expect(res).toEqual({ ok: false, error: "That file isn't a photo we can use. Choose a JPEG, PNG or WebP photo." });
    expect(cache.updateTag).not.toHaveBeenCalled();
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic\0\0\0\0mif1heic"), 0, 0, 0, 0]);
    expect(await savePhotoAction(await form(heic))).toMatchObject({ ok: false, error: expect.stringMatching(/HEIC/) });
  });

  it("remove: files deleted, BOARD_TAG refreshed; nothing to remove refreshes no cache", async () => {
    const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
    who.id = ada.id;
    await savePhotoAction(await form());
    cache.updateTag.mockClear();
    expect(await removePhotoAction()).toEqual({ ok: true });
    expect(cache.updateTag).toHaveBeenCalledWith(BOARD_TAG);
    expect(await photoStorage().list("photos/")).toEqual([]);
    cache.updateTag.mockClear();
    await removePhotoAction();
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it("signed out: nothing runs", async () => {
    who.id = "";
    await expect(savePhotoAction(await form())).rejects.toThrow(/sign-in/);
    await expect(removePhotoAction()).rejects.toThrow(/sign-in/);
  });
});

describe("the owner's takedown route (Phase 22)", () => {
  const SECRET = "owner-secret-owner-secret-owner-secret-1";
  const call = (body: unknown, auth = `Bearer ${SECRET}`) =>
    takedown(new Request("http://localhost/api/owner/photo-takedown", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) }));

  it("needs CRON_SECRET, takes the photo down by slug and refreshes every cached page at once", async () => {
    const { resetEnvCache } = await import("@/env");
    vi.stubEnv("CRON_SECRET", SECRET);
    resetEnvCache();
    try {
      const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
      who.id = ada.id;
      await savePhotoAction(await form());
      expect((await call({ author: "ada" }, "Bearer wrong")).status).toBe(401);
      expect((await call({ author: "ada" }, "")).status).toBe(401);
      expect(cache.revalidateTag).not.toHaveBeenCalled();
      expect((await call({ author: "../x" })).status).toBe(400);
      expect((await call({ author: "nobody" })).status).toBe(404);
      const res = await call({ author: "ada" });
      expect(await res.json()).toEqual({ ok: true, removed: true });
      expect(cache.revalidateTag).toHaveBeenCalledWith(BOARD_TAG, { expire: 0 });
      expect(await photoStorage().list("photos/")).toEqual([]);
      expect(await (await call({ author: "ada" })).json()).toEqual({ ok: true, removed: false });
    } finally {
      vi.unstubAllEnvs();
      resetEnvCache();
    }
  });
});

const { removeCoverAction, saveCoverAction } = await import("@/app/admin/(dashboard)/novels/cover-actions");
const { createNovel } = await import("@/server/novels");
const { novels } = await import("@/db/schema");

describe("cover actions (Phase 25)", () => {
  const coverForm = async (bytes?: Uint8Array) => {
    const f = new FormData();
    f.set("cover", fileOf(bytes ?? (await png())));
    f.set("crop", "0,0,1");
    return f;
  };

  it("save and remove: for the DAL editor's own novel only, BOARD_TAG refreshed; a foreign novel changes and refreshes nothing", async () => {
    const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
    const [bo] = await db.insert(editors).values({ email: "b@x.com", penName: "Bo", slug: "bo" }).returning();
    const book = await createNovel(ada.id, { title: "Ada's Book" });
    if (!book.ok) throw new Error();

    who.id = bo.id;
    expect(await saveCoverAction(book.novel.id, await coverForm())).toEqual({ ok: false, error: "This novel no longer exists or isn't yours." });
    expect(cache.updateTag).not.toHaveBeenCalled();

    who.id = ada.id;
    expect(await saveCoverAction(book.novel.id, await coverForm())).toEqual({ ok: true });
    expect(cache.updateTag).toHaveBeenCalledWith(BOARD_TAG);
    const [row] = await db.select({ k: novels.coverKey }).from(novels);
    expect(row.k).toMatch(/^[A-Za-z0-9_-]{22}$/);

    cache.updateTag.mockClear();
    who.id = bo.id;
    await removeCoverAction(book.novel.id);
    expect(cache.updateTag).not.toHaveBeenCalled();
    expect((await db.select({ k: novels.coverKey }).from(novels))[0].k).toBe(row.k);

    who.id = ada.id;
    expect(await removeCoverAction(book.novel.id)).toEqual({ ok: true });
    expect(cache.updateTag).toHaveBeenCalledWith(BOARD_TAG);
    expect((await db.select({ k: novels.coverKey }).from(novels))[0].k).toBeNull();
    expect(await photoStorage().list("covers/")).toEqual([]);
  });

  it("a refused picture: the cover's own wording for the toast, nothing refreshed", async () => {
    const [ada] = await db.insert(editors).values({ email: "a@x.com", penName: "Ada", slug: "ada" }).returning();
    const book = await createNovel(ada.id, { title: "Ada's Book" });
    if (!book.ok) throw new Error();
    who.id = ada.id;
    expect(await saveCoverAction(book.novel.id, await coverForm(new TextEncoder().encode("hello")))).toEqual({
      ok: false,
      error: "That file isn't a photo we can use. Choose a JPEG, PNG or WebP photo.",
    });
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it("signed out: refused before anything happens", async () => {
    who.id = "";
    await expect(saveCoverAction("00000000-0000-0000-0000-000000000000", await coverForm())).rejects.toThrow(/sign-in/);
  });
});
