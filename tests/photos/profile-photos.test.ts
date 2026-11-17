import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { OgCard } from "@/components/brand/og-card";
import { ShareImage } from "@/components/brand/share-image";
import { authorPicture, pictureSources } from "@/lib/author-picture";
import { PHOTO_CACHE_SECONDS, PHOTO_MAX_BYTES, PHOTO_UPLOAD_LIMIT, PHOTO_WEBP_SIZES } from "@/lib/photo-limits";
import { loadChecklistFacts } from "@/server/welcome-checklist";
import { pictureDataUri } from "@/server/author-picture";
import { loadAuthorPage, loadBoardSections, loadReaderPoem, loadSharePoem } from "@/server/board";
import { createPoem } from "@/server/poems";
import { servePhoto } from "@/server/photo-route";
import {
  isCurrentPhoto,
  jpegObject,
  photoObjects,
  PHOTO_ORPHAN_GRACE_HOURS,
  readPhotoJpeg,
  removePhoto,
  savePhoto,
  sweepOrphanPhotos,
  takeDownPhoto,
  webpObject,
} from "@/server/profile-photos";
import { renderShareImage, shareImageEtag } from "@/server/share-image";
import { photoStorage, type ObjectStorage } from "@/server/storage";
import { fileOf, halves, phoneJpeg, png } from "../support/photos";

const db = getDb();
const WHOLE = "0,0,1";
const STORE = process.env.PHOTO_STORAGE_DIR!;

async function editor(email: string, penName: string, slug: string) {
  const [e] = await db.insert(editors).values({ email, penName, slug }).returning();
  return e;
}

async function storedFiles(): Promise<string[]> {
  return (await photoStorage().list("photos/")).map((o) => o.key).sort();
}

const keyOf = async (id: string) => (await db.select({ k: editors.photoKey }).from(editors).where(eq(editors.id, id)))[0]?.k ?? null;

async function saved(id: string, bytes?: Uint8Array) {
  const res = await savePhoto(id, { file: fileOf(bytes ?? (await phoneJpeg())), crop: WHOLE });
  if (!res.ok) throw new Error(res.problem);
  return res.photoKey;
}

describe("saving a photo (Phase 22)", () => {
  it("stores our processed copies under a new random key, and points the editor at it", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const key = await saved(ada.id);
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await keyOf(ada.id)).toBe(key);
    expect(await storedFiles()).toEqual(photoObjects(key).sort());
    // Never the email, id or slug in a stored name.
    for (const f of await storedFiles()) {
      for (const s of ["ada", ada.id, "verse"]) expect(f.toLowerCase()).not.toContain(s);
    }
    // And the files are real, on disk.
    expect((await readdir(path.join(STORE, "photos", key))).sort()).toEqual(["192.webp", "384.webp", "512.jpg", "96.webp"]);
  });

  it("a new photo gets a new key, and the old one's files are deleted", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const first = await saved(ada.id);
    const second = await saved(ada.id, await png(500, 500));
    expect(second).not.toBe(first);
    expect(await storedFiles()).toEqual(photoObjects(second).sort());
    expect(await isCurrentPhoto(first)).toBe(false);
    expect(await isCurrentPhoto(second)).toBe(true);
  });

  it("accepts a PNG named photo.jpg (the bytes decide), refuses a text file named photo.jpg", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    expect(await savePhoto(ada.id, { file: fileOf(await png(), "photo.jpg", "image/jpeg"), crop: WHOLE })).toMatchObject({ ok: true });
    const text = fileOf(new TextEncoder().encode("not a photo at all"), "photo.jpg", "image/jpeg");
    expect(await savePhoto(ada.id, { file: text, crop: WHOLE })).toEqual({ ok: false, problem: "type", type: "unknown" });
  });

  it("refuses a missing file, a bad crop and a too-large file before anything is stored, keeping the old photo", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const key = await saved(ada.id);
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(await phoneJpeg());
    expect(await savePhoto(ada.id, { file: null, crop: WHOLE })).toEqual({ ok: false, problem: "no_file" });
    expect(await savePhoto(ada.id, { file: "photo.jpg", crop: WHOLE })).toEqual({ ok: false, problem: "no_file" });
    expect(await savePhoto(ada.id, { file: fileOf(big), crop: WHOLE })).toEqual({ ok: false, problem: "too_large" });
    expect(await savePhoto(ada.id, { file: fileOf(await phoneJpeg()), crop: "0,0,2" })).toEqual({ ok: false, problem: "crop" });
    expect(await savePhoto(ada.id, { file: fileOf(await phoneJpeg({ width: 400, height: 300 })), crop: "0.5,0,1" })).toEqual({ ok: false, problem: "crop" });
    expect(await keyOf(ada.id)).toBe(key);
    expect(await storedFiles()).toEqual(photoObjects(key).sort());
  });

  it("if storage fails, nothing changes: the old photo stays and no new file is left behind", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const key = await saved(ada.id);
    const real = photoStorage();
    let puts = 0;
    const flaky: ObjectStorage = {
      ...real,
      kind: "local",
      put: async (k, b, t) => {
        // The third file fails, after two were written.
        if (++puts === 3) throw new Error("disk full");
        return real.put(k, b, t);
      },
      get: real.get,
      delete: real.delete,
      list: real.list,
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await savePhoto(ada.id, { file: fileOf(await png()), crop: WHOLE }, flaky)).toEqual({ ok: false, problem: "storage" });
    spy.mockRestore();
    expect(await keyOf(ada.id)).toBe(key);
    expect(await storedFiles()).toEqual(photoObjects(key).sort());
  });

  it("production without R2: a clear 'storage' answer for the writer and a log line naming the variables", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const saved = { NODE_ENV: process.env.NODE_ENV, PHOTO_STORAGE_DIR: process.env.PHOTO_STORAGE_DIR };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PHOTO_STORAGE_DIR", "");
      expect(await savePhoto(ada.id, { file: fileOf(await png()), crop: WHOLE })).toEqual({ ok: false, problem: "storage" });
      expect(spy.mock.calls.flat().join(" ")).toMatch(/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET/);
    } finally {
      vi.unstubAllEnvs();
      spy.mockRestore();
    }
    expect(process.env.PHOTO_STORAGE_DIR).toBe(saved.PHOTO_STORAGE_DIR);
    expect(await keyOf(ada.id)).toBeNull();
  });

  it("is rate-limited per editor (rate_limits), and one editor's uploads don't count against another's", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const bo = await editor("bo@example.com", "Bo", "bo");
    await db.execute(sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${`photo:upload:${ada.id}`}, now(), ${PHOTO_UPLOAD_LIMIT})`);
    expect(await savePhoto(ada.id, { file: fileOf(await png()), crop: WHOLE })).toMatchObject({ ok: false, problem: "rate_limited" });
    expect(await keyOf(ada.id)).toBeNull();
    expect(await savePhoto(bo.id, { file: fileOf(await png()), crop: WHOLE })).toMatchObject({ ok: true });
  });
});

describe("whose photo (Phase 22)", () => {
  it("one editor can't replace or remove another's photo: every call is scoped by the DAL editor id", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const bo = await editor("bo@example.com", "Bo", "bo");
    const adaKey = await saved(ada.id);
    // Bo's save changes only Bo; Bo's removal removes only Bo's.
    const boKey = await saved(bo.id);
    expect(await keyOf(ada.id)).toBe(adaKey);
    expect(await removePhoto(bo.id)).toBe(true);
    expect(await keyOf(ada.id)).toBe(adaKey);
    expect(await storedFiles()).toEqual(photoObjects(adaKey).sort());
    expect(await removePhoto(bo.id)).toBe(false);
    expect(boKey).not.toBe(adaKey);
    // Malformed and unknown ids are nothing.
    expect(await removePhoto("not-a-uuid")).toBe(false);
    expect(await removePhoto("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await savePhoto("not-a-uuid", { file: fileOf(await png()), crop: WHOLE })).toEqual({ ok: false, problem: "no_file" });
    expect(await savePhoto("00000000-0000-0000-0000-000000000000", { file: fileOf(await png()), crop: WHOLE })).toEqual({ ok: false, problem: "no_file" });
    expect(await storedFiles()).toEqual(photoObjects(adaKey).sort());
  });
});

describe("removing a photo (Phase 22)", () => {
  it("deletes its files, not just the link, and the avatar is back everywhere", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    await createPoem(ada.id, { title: "River", body: "a line", visibility: "public", status: "published" });
    const key = await saved(ada.id);
    expect((await loadBoardSections())[0].picture.photoKey).toBe(key);
    expect(await removePhoto(ada.id)).toBe(true);
    expect(await storedFiles()).toEqual([]);
    expect(await keyOf(ada.id)).toBeNull();
    const avatar = authorPicture({ id: ada.id, avatar: null, photoKey: null });
    expect((await loadBoardSections())[0].picture).toEqual(avatar);
    expect((await loadAuthorPage("ada-verse"))!.picture).toEqual(avatar);
    expect((await loadReaderPoem("ada-verse", "river"))!.picture).toEqual(avatar);
    expect((await loadSharePoem("ada-verse", "river"))!.picture).toEqual(avatar);
  });

  it("the owner's takedown: by author slug, files deleted, the avatar shows", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const bo = await editor("bo@example.com", "Bo", "bo");
    await saved(ada.id);
    const boKey = await saved(bo.id);
    expect(await takeDownPhoto("ada-verse")).toEqual({ removed: true });
    expect(await keyOf(ada.id)).toBeNull();
    expect(await keyOf(bo.id)).toBe(boKey);
    expect(await storedFiles()).toEqual(photoObjects(boKey).sort());
    expect(await takeDownPhoto("ada-verse")).toEqual({ removed: false });
    expect(await takeDownPhoto("nobody")).toBeNull();
  });

  it("a removal racing a new upload never deletes the new photo", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const first = await saved(ada.id);
    const [, second] = await Promise.all([removePhoto(ada.id), saved(ada.id)]);
    const now = await keyOf(ada.id);
    // Whichever order they ran in, what's stored is exactly what the row points at.
    expect(await storedFiles()).toEqual(now ? photoObjects(now).sort() : []);
    expect(now === null || now === second).toBe(true);
    expect(await isCurrentPhoto(first)).toBe(false);
  });
});

describe("orphaned files (the daily cleanup, Phase 22)", () => {
  it("deletes files no editor points at once they're old enough, and leaves live photos and uploads in progress alone", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const live = await saved(ada.id);
    const s = photoStorage();
    // A crash between storing and saving: files nobody points at.
    await s.put(webpObject("OrphanOrphanOrphanOrph", 96), new Uint8Array([1]), "image/webp");
    await s.put(jpegObject("OrphanOrphanOrphanOrph"), new Uint8Array([1]), "image/jpeg");
    // Something that isn't ours: never touched.
    await s.put("photos/notakey/96.webp", new Uint8Array([1]), "image/webp");
    // Just written: an upload in progress is safe.
    expect(await sweepOrphanPhotos(s)).toBe(0);
    const later = new Date(Date.now() + (PHOTO_ORPHAN_GRACE_HOURS + 1) * 3600_000);
    expect(await sweepOrphanPhotos(s, later)).toBe(1);
    expect(await storedFiles()).toEqual([...photoObjects(live), "photos/notakey/96.webp"].sort());
  });
});

describe("serving (Phase 22)", () => {
  it("serves the current photo's WebP with an hour's cache, and 404s anything else", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const key = await saved(ada.id);
    const res = await servePhoto(key, "192.webp");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${PHOTO_CACHE_SECONDS}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer()).slice(8, 12)).toEqual(new TextEncoder().encode("WEBP"));
    for (const [k, f] of [[key, "512.jpg"], [key, "100.webp"], [key, "192.png"], ["../../etc", "96.webp"], ["AAAAAAAAAAAAAAAAAAAAAA", "96.webp"]]) {
      const r = await servePhoto(k, f);
      expect(r.status, `${k}/${f}`).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("stops at once when the photo is removed, even if its files were still there", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    const key = await saved(ada.id);
    // Unlink without deleting the files (as if the delete had failed).
    await db.update(editors).set({ photoKey: null }).where(eq(editors.id, ada.id));
    expect((await servePhoto(key, "96.webp")).status).toBe(404);
  });

  it("the component's sources: every WebP size in srcset, the avatar as the fallback, avatar alone without a photo", async () => {
    const withPhoto = pictureSources({ avatarId: "a07", photoKey: "AbCdEfGhIjKlMnOpQrStUv" }, 32);
    expect(withPhoto).toEqual({
      kind: "photo",
      src: "/photos/AbCdEfGhIjKlMnOpQrStUv/96.webp",
      srcSet: PHOTO_WEBP_SIZES.map((s) => `/photos/AbCdEfGhIjKlMnOpQrStUv/${s}.webp ${s}w`).join(", "),
      fallback: "/avatars/a07",
    });
    expect(pictureSources({ avatarId: "a07", photoKey: "AbCdEfGhIjKlMnOpQrStUv" }, 112).src).toBe("/photos/AbCdEfGhIjKlMnOpQrStUv/384.webp");
    expect(pictureSources({ avatarId: "a07", photoKey: null }, 32)).toEqual({ kind: "avatar", src: "/avatars/a07" });
  });
});

/** Every <img> src in a Satori tree (function components expanded). */
function imageSources(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) imageSources(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<{ src?: string; children?: ReactNode }>;
  if (typeof el.type === "function") return imageSources((el.type as (p: unknown) => ReactNode)(el.props), out);
  if (el.type === "img" && el.props.src) out.push(el.props.src);
  for (const k of [el.props.children].flat(Infinity as 1) as ReactNode[]) imageSources(k, out);
  return out;
}

describe("the share image and link cards draw the photo (Phase 22)", () => {
  let adaId: string;
  beforeEach(async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    adaId = ada.id;
    await createPoem(ada.id, { title: "River", body: "the river\nruns", visibility: "public", status: "published" });
  });

  it("reads the JPEG copy from storage as a data URI (no fetch), and falls back to the avatar", async () => {
    const before = await pictureDataUri((await loadSharePoem("ada-verse", "river"))!.picture);
    expect(before).toMatch(/^data:image\/svg\+xml;base64,/);
    const key = await saved(adaId, await (await halves(600, 600)).png().toBuffer());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const uri = await pictureDataUri((await loadSharePoem("ada-verse", "river"))!.picture);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(uri).toBe(`data:image/jpeg;base64,${Buffer.from((await readPhotoJpeg(key))!).toString("base64")}`);
    // Files gone (a failed read): the avatar, never a broken picture.
    await photoStorage().delete(jpegObject(key));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await pictureDataUri({ avatarId: "a01", photoKey: key })).toMatch(/^data:image\/svg\+xml/);
    spy.mockRestore();
  });

  it("the photo is in the share image's tree, and in the link card's", async () => {
    await saved(adaId, await png(600, 600));
    const poem = (await loadSharePoem("ada-verse", "river"))!;
    const uri = (await pictureDataUri(poem.picture))!;
    const { shareImageLayout } = await import("@/server/share-image");
    const layout = await shareImageLayout({ ...poem, shortCode: "bcdfgh" });
    for (const design of ["page", "ink", "board"] as const) {
      expect(imageSources(ShareImage({ layout, avatar: uri, design })), design).toContain(uri);
    }
    expect(imageSources(OgCard({ title: "River", kicker: "by Ada Verse", picture: uri }))).toContain(uri);
    expect(imageSources(OgCard({ title: "River" }))).not.toContain(uri);
  });

  it("renders it: the byline's circle is the photo's colour, and the ETag changes with the photo", async () => {
    const noPhoto = (await loadSharePoem("ada-verse", "river"))!;
    const etagBefore = shareImageEtag({ ...noPhoto, shortCode: "bcdfgh" }, { format: "story" });
    // A photo that is red all over.
    const red = await (await import("sharp")).default({ create: { width: 300, height: 300, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png().toBuffer();
    await saved(adaId, red);
    const poem = (await loadSharePoem("ada-verse", "river"))!;
    const etagAfter = shareImageEtag({ ...poem, shortCode: "bcdfgh" }, { format: "story" });
    expect(etagAfter).not.toBe(etagBefore);
    // The bright red of the photo appears only where the photo is drawn: a
    // 96 px circle is about 7,200 pixels; without the photo there are none.
    const redPixels = async (bytes: Uint8Array) => {
      const { data, info } = await (await import("sharp")).default(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) n++;
      return n;
    };
    for (const design of ["page", "ink", "board"] as const) {
      const withPhoto = await renderShareImage({ ...poem, shortCode: "bcdfgh" }, { format: "story", design });
      const without = await renderShareImage({ ...noPhoto, shortCode: "bcdfgh" }, { format: "story", design });
      expect(await redPixels(withPhoto.png), design).toBeGreaterThan(6000);
      expect(await redPixels(withPhoto.png), design).toBeLessThan(8000);
      expect(await redPixels(without.png), design).toBe(0);
    }
    // Removing it changes the ETag again.
    await removePhoto(adaId);
    const gone = (await loadSharePoem("ada-verse", "river"))!;
    expect(shareImageEtag({ ...gone, shortCode: "bcdfgh" }, { format: "story" })).toBe(etagBefore);
  });
});

describe("the welcome checklist's avatar step (Phase 22)", () => {
  it("a photo counts as picking a face; removing it (with no avatar chosen) undoes that", async () => {
    const ada = await editor("ada@example.com", "Ada Verse", "ada-verse");
    expect((await loadChecklistFacts(ada.id))!.hasAvatar).toBe(false);
    await saved(ada.id);
    expect((await loadChecklistFacts(ada.id))!.hasAvatar).toBe(true);
    await removePhoto(ada.id);
    expect((await loadChecklistFacts(ada.id))!.hasAvatar).toBe(false);
  });
});
