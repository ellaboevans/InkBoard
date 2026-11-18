import { eq, sql } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { editors, novels } from "@/db/schema";
import { OgCard } from "@/components/brand/og-card";
import { coverSources } from "@/lib/novel-cover";
import { clampView, cropFromView, cropRectToPixels, initialView, panView } from "@/lib/photo-crop";
import { COVER_ASPECT, COVER_CACHE_SECONDS, COVER_JPEG_WIDTH, COVER_UPLOAD_LIMIT, COVER_WEBP_WIDTHS, coverHeight } from "@/lib/photo-limits";
import { deleteAccount } from "@/server/account-deletion";
import { createSession, validateSession } from "@/server/auth/sessions";
import { loadAuthorPage, loadBoardSections, loadNovelPage, loadReaderChapter } from "@/server/board";
import { loadEditorExport } from "@/server/export";
import { cleanupExpiredRows } from "@/server/maintenance";
import {
  COVER_ORPHAN_GRACE_HOURS,
  coverDataUri,
  coverJpegObject,
  coverObjects,
  coverWebpObject,
  isCurrentCover,
  readCoverJpeg,
  removeCover,
  saveCover,
  sweepOrphanCovers,
} from "@/server/novel-covers";
import { createChapter, createNovel, deleteNovel, getNovel } from "@/server/novels";
import { processCover } from "@/server/photos/process";
import { serveCover, servePhoto } from "@/server/photo-route";
import { photoObjects, savePhoto } from "@/server/profile-photos";
import { photoStorage, type ObjectStorage } from "@/server/storage";
import { fileOf, isBlueish, isRedish, metadataMarkers, phoneJpeg, pixel, png } from "../support/photos";

/*
 * Uploaded novel covers (docs/PLAN.md, Phase 25), through the profile
 * photos' pipeline with real SQL and the local storage driver: 2:3 copies
 * with no metadata, the same refusals, a new random key per upload with the
 * old files deleted, the editor → novel locks (a racing removal), serving
 * only the current cover, the orphan sweep, every way a cover is removed
 * deleting its files, the export, and the reader loaders and link cards.
 */

const db = getDb();
const WHOLE = "0,0,1";

async function editor(email: string, penName: string, slug: string) {
  const [e] = await db.insert(editors).values({ email, penName, slug }).returning();
  return e;
}

async function novel(editorId: string, title = "The Ferry at Yeji", published = true) {
  const n = await createNovel(editorId, { title, blurb: "A ferry." });
  if (!n.ok) throw new Error("novel");
  if (published) await createChapter(editorId, n.novel.id, { title: "Thursday", body: "The ferry came late.", status: "published" });
  return n.novel;
}

const coverFiles = async () => (await photoStorage().list("covers/")).map((o) => o.key).sort();
const keyOf = async (novelId: string) => (await db.select({ k: novels.coverKey }).from(novels).where(eq(novels.id, novelId)))[0]?.k ?? null;

async function saved(editorId: string, novelId: string, bytes?: Uint8Array, crop = WHOLE) {
  const res = await saveCover(editorId, novelId, { file: fileOf(bytes ?? (await phoneJpeg({ width: 900, height: 1200 }))), crop });
  if (!res.ok) throw new Error(res.problem);
  return res.coverKey;
}

let ama: { id: string };
let ferry: { id: string; slug: string };
beforeEach(async () => {
  ama = await editor("ama@example.com", "Ama Sɛwaa", "ama");
  ferry = await novel(ama.id);
});

describe("the 2:3 crop (shared crop maths)", () => {
  it("the widest 2:3 crop of a landscape picture is its full height, centred; of a tall one its full width", () => {
    expect(cropRectToPixels(cropFromView(initialView(), 3000, 2000, COVER_ASPECT), 3000, 2000, 1, COVER_ASPECT)).toEqual({ left: 833, top: 0, width: 1333, height: 2000 });
    expect(cropRectToPixels(cropFromView(initialView(), 1000, 3000, COVER_ASPECT), 1000, 3000, 1, COVER_ASPECT)).toEqual({ left: 0, top: 750, width: 1000, height: 1500 });
    // Exactly 2:3: the whole picture.
    expect(cropRectToPixels(cropFromView(initialView(), 800, 1200, COVER_ASPECT), 800, 1200, 1, COVER_ASPECT)).toEqual({ left: 0, top: 0, width: 800, height: 1200 });
  });

  it("zoom and pan keep the crop inside the picture; dragging down by the box's height moves a whole crop up", () => {
    const v = clampView({ zoom: 2, cx: 0, cy: 1 }, 3000, 2000, COVER_ASPECT);
    expect(cropRectToPixels(cropFromView(v, 3000, 2000, COVER_ASPECT), 3000, 2000, 1, COVER_ASPECT)).toEqual({ left: 0, top: 999, width: 667, height: 1001 });
    const start = clampView({ zoom: 2, cx: 0.5, cy: 0.75 }, 3000, 2000, COVER_ASPECT);
    const moved = panView(start, 0, 300, 200, 3000, 2000, COVER_ASPECT); // a 200 × 300 box
    expect(moved.cy).toBeCloseTo(0.25);
  });

  it("refuses a crop that leaves the picture or is too narrow", () => {
    expect(cropRectToPixels({ x: 0.6, y: 0, size: 1 }, 3000, 2000, 1, COVER_ASPECT)).toBeNull();
    expect(cropRectToPixels({ x: 0, y: 0, size: 0.02 }, 3000, 2000, 64, COVER_ASPECT)).toBeNull(); // 27 px
  });
});

describe("processing a cover (the photos' pipeline, Phase 25)", () => {
  it("writes 2:3 WebP copies at every width and a 2:3 JPEG for Satori, with no metadata at all", async () => {
    const input = await phoneJpeg({ width: 1200, height: 900 });
    const out = await processCover(input, { x: 0, y: 0, size: 1 });
    if (!out.ok) throw new Error(out.error);
    for (const w of COVER_WEBP_WIDTHS) {
      const m = await sharp(out.webp[w]).metadata();
      expect([m.format, m.width, m.height, m.space]).toEqual(["webp", w, coverHeight(w), "srgb"]);
    }
    const j = await sharp(out.jpeg).metadata();
    expect([j.format, j.width, j.height]).toEqual(["jpeg", COVER_JPEG_WIDTH, coverHeight(COVER_JPEG_WIDTH)]);
    expect(coverHeight(COVER_JPEG_WIDTH)).toBe(720);
    for (const file of [...COVER_WEBP_WIDTHS.map((w) => out.webp[w]), out.jpeg]) {
      const meta = await sharp(file).metadata();
      expect([meta.exif, meta.xmp, meta.icc, meta.iptc, meta.orientation]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      expect(metadataMarkers(file)).toEqual([]);
    }
  });

  it("crops the picture as seen: the left third of a red-left/blue-right landscape is red, the right third blue", async () => {
    const left = await processCover(await png(900, 400), { x: 0, y: 0, size: 1 });
    const right = await processCover(await png(900, 400), { x: 1 - 267 / 900, y: 0, size: 1 });
    if (!left.ok || !right.ok) throw new Error("failed");
    expect(isRedish(await pixel(left.jpeg, 240, 360))).toBe(true);
    expect(isBlueish(await pixel(right.jpeg, 240, 360))).toBe(true);
  });

  it("refuses what photos refuse, in the same order: too big, not an image, a bomb, a crop outside it", async () => {
    expect(await saveCover(ama.id, ferry.id, { file: fileOf(new Uint8Array(4 * 1024 * 1024 + 1)), crop: WHOLE })).toMatchObject({ ok: false, problem: "too_large" });
    expect(await saveCover(ama.id, ferry.id, { file: fileOf(new TextEncoder().encode("not a picture")), crop: WHOLE })).toMatchObject({ ok: false, problem: "type" });
    expect(await saveCover(ama.id, ferry.id, { file: fileOf(await png()), crop: "1,1,1" })).toMatchObject({ ok: false, problem: "crop" });
    expect(await saveCover(ama.id, ferry.id, { file: fileOf(await png()), crop: "nonsense" })).toMatchObject({ ok: false, problem: "crop" });
    expect(await saveCover(ama.id, ferry.id, { file: null, crop: WHOLE })).toMatchObject({ ok: false, problem: "no_file" });
    expect(await keyOf(ferry.id)).toBeNull();
    expect(await coverFiles()).toEqual([]);
  });
});

describe("saving a cover (Phase 25)", () => {
  it("stores the copies under a new random key (not the novel's id, slug or title), and a new upload deletes the old files", async () => {
    const first = await saved(ama.id, ferry.id);
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    for (const s of [ferry.id, ferry.slug, "ferry", "yeji"]) expect(first.toLowerCase()).not.toContain(s.toLowerCase());
    expect(await keyOf(ferry.id)).toBe(first);
    expect(await coverFiles()).toEqual(coverObjects(first).sort());
    expect(coverObjects(first)).toEqual([...COVER_WEBP_WIDTHS.map((w) => `covers/${first}/${w}.webp`), `covers/${first}/${COVER_JPEG_WIDTH}.jpg`]);

    const second = await saved(ama.id, ferry.id);
    expect(second).not.toBe(first);
    expect(await keyOf(ferry.id)).toBe(second);
    expect(await coverFiles()).toEqual(coverObjects(second).sort());
    expect((await getNovel(ama.id, ferry.id))!.coverKey).toBe(second);
  });

  it("another editor's novel, a malformed id or a deleted novel: nothing is processed or stored", async () => {
    const kofi = await editor("kofi@example.com", "Kofi", "kofi");
    expect(await saveCover(kofi.id, ferry.id, { file: fileOf(await png()), crop: WHOLE })).toEqual({ ok: false, problem: "not_found" });
    expect(await saveCover(ama.id, "not-a-uuid", { file: fileOf(await png()), crop: WHOLE })).toEqual({ ok: false, problem: "not_found" });
    expect(await removeCover(kofi.id, ferry.id)).toBe(false);
    expect(await keyOf(ferry.id)).toBeNull();
    expect(await coverFiles()).toEqual([]);
  });

  it("if storage fails, nothing changes: the old cover stays and no new file is left behind", async () => {
    const key = await saved(ama.id, ferry.id);
    const real = photoStorage();
    let puts = 0;
    const flaky: ObjectStorage = { ...real, put: async (k, b, t) => (++puts === 2 ? Promise.reject(new Error("disk full")) : real.put(k, b, t)) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveCover(ama.id, ferry.id, { file: fileOf(await png()), crop: WHOLE }, flaky)).toEqual({ ok: false, problem: "storage" });
    spy.mockRestore();
    expect(await keyOf(ferry.id)).toBe(key);
    expect(await coverFiles()).toEqual(coverObjects(key).sort());
  });

  it("is rate-limited per editor on its own key, apart from profile photos", async () => {
    await db.execute(sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${`cover:upload:${ama.id}`}, now(), ${COVER_UPLOAD_LIMIT})`);
    expect(await saveCover(ama.id, ferry.id, { file: fileOf(await png()), crop: WHOLE })).toMatchObject({ ok: false, problem: "rate_limited" });
    // A profile photo still goes through: different limit.
    expect(await savePhoto(ama.id, { file: fileOf(await png()), crop: WHOLE })).toMatchObject({ ok: true });
  });

  it("a removal racing a new upload never deletes the new cover", async () => {
    const first = await saved(ama.id, ferry.id);
    const [, second] = await Promise.all([removeCover(ama.id, ferry.id), saved(ama.id, ferry.id)]);
    const now = await keyOf(ferry.id);
    // Whichever order they ran in, what's stored is exactly what the row points at.
    expect(await coverFiles()).toEqual(now ? coverObjects(now).sort() : []);
    expect(now === null || now === second).toBe(true);
    expect(await isCurrentCover(first)).toBe(false);
  });

  it("two uploads at once: one wins, and the loser's files are deleted", async () => {
    const [a, b] = await Promise.all([saved(ama.id, ferry.id), saved(ama.id, ferry.id)]);
    const now = await keyOf(ferry.id);
    expect([a, b]).toContain(now);
    expect(await coverFiles()).toEqual(coverObjects(now!).sort());
  });
});

describe("serving (Phase 25)", () => {
  it("serves the current cover's WebP with an hour's cache, nosniff and a sandbox CSP; 404s anything else", async () => {
    const key = await saved(ama.id, ferry.id);
    const res = await serveCover(key, "256.webp");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${COVER_CACHE_SECONDS}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    const m = await sharp(new Uint8Array(await res.arrayBuffer())).metadata();
    expect([m.width, m.height]).toEqual([256, 384]);
    for (const [k, f] of [[key, "480.jpg"], [key, "96.webp"], [key, "256.png"], ["../../etc", "128.webp"], ["AAAAAAAAAAAAAAAAAAAAAA", "128.webp"]]) {
      const r = await serveCover(k, f);
      expect(r.status, `${k}/${f}`).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    // A cover isn't a photo, and a photo isn't a cover.
    expect((await servePhoto(key, "96.webp")).status).toBe(404);
    const photo = await savePhoto(ama.id, { file: fileOf(await png()), crop: WHOLE });
    if (!photo.ok) throw new Error();
    expect((await serveCover(photo.photoKey, "128.webp")).status).toBe(404);
  });

  it("stops at once when the cover is unlinked, even if its files were still there", async () => {
    const key = await saved(ama.id, ferry.id);
    await db.update(novels).set({ coverKey: null }).where(eq(novels.id, ferry.id));
    expect((await serveCover(key, "128.webp")).status).toBe(404);
  });

  it("a private novel's cover is public, like its title and blurb", async () => {
    const key = await saved(ama.id, ferry.id);
    await db.execute(sql`UPDATE editors SET password_mode = 'shared', shared_password_hash = 'scrypt$x' WHERE id = ${ama.id}`);
    await db.update(novels).set({ visibility: "private" }).where(eq(novels.id, ferry.id));
    expect((await serveCover(key, "512.webp")).status).toBe(200);
    expect((await loadNovelPage("ama", ferry.slug))!.coverKey).toBe(key);
  });
});

describe("removing a cover deletes its files, every way (Phase 25)", () => {
  it("Remove cover: the drawn cover is back and the files are gone", async () => {
    const key = await saved(ama.id, ferry.id);
    expect(await removeCover(ama.id, ferry.id)).toBe(true);
    expect(await keyOf(ferry.id)).toBeNull();
    expect(await coverFiles()).toEqual([]);
    expect(await isCurrentCover(key)).toBe(false);
    expect(await removeCover(ama.id, ferry.id)).toBe(false);
  });

  it("deleting the novel", async () => {
    const other = await novel(ama.id, "Another Book");
    const keep = await saved(ama.id, other.id);
    await saved(ama.id, ferry.id);
    expect(await deleteNovel(ama.id, ferry.id)).toBe(true);
    expect(await coverFiles()).toEqual(coverObjects(keep).sort());
  });

  it("deleting the account: every novel's cover and the photo", async () => {
    const other = await novel(ama.id, "Another Book");
    await saved(ama.id, ferry.id);
    await saved(ama.id, other.id);
    const photo = await savePhoto(ama.id, { file: fileOf(await png()), crop: WHOLE });
    if (!photo.ok) throw new Error();
    // Someone else's cover stays.
    const kofi = await editor("kofi@example.com", "Kofi", "kofi");
    const theirs = await novel(kofi.id, "Kofi's Book");
    const kept = await saved(kofi.id, theirs.id);
    // An email sign-in: fresh enough for the step-up check.
    const { token } = await createSession(ama.id);
    const sessionId = (await validateSession(token))!.sessionId;
    expect(await deleteAccount({ editorId: ama.id, sessionId, confirmation: "Ama Sɛwaa" })).toMatchObject({ ok: true });
    expect(await coverFiles()).toEqual(coverObjects(kept).sort());
    expect((await photoStorage().list("photos/")).map((o) => o.key)).not.toEqual(expect.arrayContaining(photoObjects(photo.photoKey)));
  });
});

describe("orphaned cover files (the daily cleanup, Phase 25)", () => {
  it("deletes files no novel points at once they're old enough; leaves live covers, uploads in progress and others alone", async () => {
    const live = await saved(ama.id, ferry.id);
    const s = photoStorage();
    await s.put(coverWebpObject("OrphanOrphanOrphanOrph", 128), new Uint8Array([1]), "image/webp");
    await s.put(coverJpegObject("OrphanOrphanOrphanOrph"), new Uint8Array([1]), "image/jpeg");
    await s.put("covers/notakey/128.webp", new Uint8Array([1]), "image/webp");
    expect(await sweepOrphanCovers(s)).toBe(0);
    const later = new Date(Date.now() + (COVER_ORPHAN_GRACE_HOURS + 1) * 3600_000);
    expect(await sweepOrphanCovers(s, later)).toBe(1);
    expect(await coverFiles()).toEqual([...coverObjects(live), "covers/notakey/128.webp"].sort());
  });

  it("is part of the daily cleanup", async () => {
    expect(await cleanupExpiredRows()).toMatchObject({ orphanCovers: 0, orphanPhotos: 0 });
  });
});

describe("readers and link cards (Phase 25)", () => {
  it("every reader loader carries the key: board, author page, novel page, chapter page", async () => {
    const key = await saved(ama.id, ferry.id);
    expect((await loadBoardSections())[0].novels[0].coverKey).toBe(key);
    expect((await loadAuthorPage("ama"))!.novels[0].coverKey).toBe(key);
    expect((await loadNovelPage("ama", ferry.slug))!.coverKey).toBe(key);
    expect((await loadReaderChapter("ama", ferry.slug, "thursday"))!.novel.coverKey).toBe(key);
  });

  it("the component's sources: every WebP width in srcset, the smallest at 2× as src", () => {
    expect(coverSources("AbCdEfGhIjKlMnOpQrStUv", 84)).toEqual({
      src: "/covers/AbCdEfGhIjKlMnOpQrStUv/256.webp",
      srcSet: "/covers/AbCdEfGhIjKlMnOpQrStUv/128.webp 128w, /covers/AbCdEfGhIjKlMnOpQrStUv/256.webp 256w, /covers/AbCdEfGhIjKlMnOpQrStUv/512.webp 512w",
    });
    expect(coverSources("AbCdEfGhIjKlMnOpQrStUv", 220).src).toBe("/covers/AbCdEfGhIjKlMnOpQrStUv/512.webp");
  });

  it("link cards read the JPEG from storage as a data URI (no fetch); unreadable or none means the drawn cover", async () => {
    const key = await saved(ama.id, ferry.id);
    const uri = await coverDataUri(key);
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(uri!.split(",")[1], "base64")).toEqual(Buffer.from((await readCoverJpeg(key))!));
    expect(await coverDataUri(null)).toBeNull();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await photoStorage().delete(coverJpegObject(key));
    expect(await coverDataUri(key)).toBeNull();
    spy.mockRestore();

    const images = (node: ReactNode): ReactElement<{ src?: string }>[] => {
      if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap(images) : [];
      const el = node as ReactElement<{ src?: string; children?: ReactNode }>;
      const own = el.type === "img" ? [el] : [];
      const rendered = typeof el.type === "function" ? images((el.type as (p: unknown) => ReactNode)(el.props)) : images(el.props.children);
      return [...own, ...rendered];
    };
    const drawn = images(OgCard({ title: "T", cover: { title: "T", penName: "P", hue: 40, image: null } }));
    expect(drawn.filter((i) => i.props.src?.startsWith("data:image/jpeg"))).toEqual([]);
    const uploaded = images(OgCard({ title: "T", cover: { title: "T", penName: "P", hue: 40, image: "data:image/jpeg;base64,AAAA" } }));
    expect(uploaded.map((i) => i.props.src)).toContain("data:image/jpeg;base64,AAAA");
  });
});

describe("the export (Phase 25)", () => {
  it("carries the cover's JPEG like the profile photo, never its storage key", async () => {
    const key = await saved(ama.id, ferry.id);
    await novel(ama.id, "No Cover Yet", false);
    const data = (await loadEditorExport(ama.id, { site: "https://inkboard.test" }))!;
    const withCover = data.novels.find((n) => n.title === "The Ferry at Yeji")!;
    expect(withCover.cover).toMatchObject({ type: "image/jpeg", width: 480, height: 720 });
    expect(Buffer.from(withCover.cover!.base64, "base64")).toEqual(Buffer.from((await readCoverJpeg(key))!));
    expect(data.novels.find((n) => n.title === "No Cover Yet")!.cover).toBeNull();
    expect(JSON.stringify(data)).not.toContain(key);
    expect(JSON.stringify(data)).not.toMatch(/coverKey|cover_key/);
  });
});
