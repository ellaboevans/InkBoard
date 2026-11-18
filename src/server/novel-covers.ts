import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { editors, novels } from "@/db/schema";
import { parseCrop } from "@/lib/photo-crop";
import {
  COVER_JPEG_WIDTH,
  COVER_UPLOAD_LIMIT,
  COVER_UPLOAD_WINDOW_SECONDS,
  COVER_WEBP_WIDTHS,
  PHOTO_MAX_BYTES,
  type CoverWebpWidth,
} from "@/lib/photo-limits";
import type { PhotoProblem } from "@/lib/photo-messages";
import type { SniffedType } from "@/lib/photo-sniff";
import { processCover } from "./photos/process";
import {
  deleteImageFiles,
  deleteObjects,
  IMAGE_KEY,
  jpegObjectOf,
  objectsOf,
  ORPHAN_GRACE_HOURS,
  readImageJpeg,
  storageFor,
  storeImageFiles,
  sweepOrphanImages,
  webpObjectOf,
  type StoredImageKind,
} from "./photos/stored-images";
import { rateLimit } from "./rate-limit";
import { photoStorage, type ObjectStorage } from "./storage";

/*
 * Uploaded novel covers (docs/PLAN.md, Phase 25), through the profile
 * photos' pipeline (src/server/profile-photos.ts): the same checks in the
 * same order and the same processing (src/server/photos/process.ts, cropped
 * to 2:3), the same storage rules (src/server/photos/stored-images.ts: a new
 * random key per upload, all or nothing, files deleted after the row stops
 * pointing at them, the daily orphan sweep), served the same way from our
 * own origin (src/server/photo-route.ts, /covers/<key>/<width>.webp).
 *
 * Framework-free and scoped like novels.ts: every function takes the
 * DAL-resolved editor id, the novel must be theirs (another editor's novel id
 * behaves like a missing one, malformed ids are refused before SQL), and
 * writes lock the editor row, then the novel row (FOR NO KEY UPDATE), the
 * novels' lock order. No cover = the drawn cover (NovelCover), which also
 * stands behind an uploaded one while it loads or if it can't be read.
 */

export const COVER_KIND: StoredImageKind = {
  name: "covers",
  prefix: "covers/",
  webpWidths: COVER_WEBP_WIDTHS,
  jpegWidth: COVER_JPEG_WIDTH,
};

export const COVER_KEY = IMAGE_KEY;
/** Files nothing points at are deleted by the daily cleanup once this old (the photos' grace period). */
export const COVER_ORPHAN_GRACE_HOURS = ORPHAN_GRACE_HOURS;
export const coverWebpObject = (key: string, width: CoverWebpWidth) => webpObjectOf(COVER_KIND, key, width);
export const coverJpegObject = (key: string) => jpegObjectOf(COVER_KIND, key);
export const coverObjects = (key: string): string[] => objectsOf(COVER_KIND, key);

const idSchema = z.uuid();
const isId = (v: unknown): v is string => idSchema.safeParse(v).success;

export type SaveCoverResult =
  | { ok: true; coverKey: string }
  | { ok: false; problem: PhotoProblem; type?: SniffedType; retryAfter?: number };

function isBlob(v: unknown): v is Blob {
  return typeof Blob !== "undefined" && v instanceof Blob;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** The editor row, then the editor's own novel, locked (novels' lock order); the novel's cover key, or undefined if it isn't theirs. */
async function lockNovel(tx: Tx, editorId: string, novelId: string): Promise<{ coverKey: string | null } | undefined> {
  await tx.select({ id: editors.id }).from(editors).where(eq(editors.id, editorId)).for("no key update");
  const [row] = await tx
    .select({ coverKey: novels.coverKey })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.editorId, editorId)))
    .for("no key update");
  return row;
}

const ownsNovel = async (editorId: string, novelId: string) =>
  (await getDb().select({ id: novels.id }).from(novels).where(and(eq(novels.id, novelId), eq(novels.editorId, editorId))).limit(1)).length > 0;

/**
 * Upload, crop and save a novel's cover in one step: checks and processing,
 * the copies under a new key, then one UPDATE under the editor → novel
 * locks, then the old cover's files are deleted. Any failure before the
 * UPDATE deletes the new files and keeps the old cover.
 */
export async function saveCover(
  editorId: string,
  novelId: string,
  input: { file: unknown; crop: unknown },
  injected?: ObjectStorage,
): Promise<SaveCoverResult> {
  if (!isId(editorId) || !isId(novelId)) return { ok: false, problem: "not_found" };
  if (!isBlob(input.file) || input.file.size === 0) return { ok: false, problem: "no_file" };
  // Before reading a byte of it.
  if (input.file.size > PHOTO_MAX_BYTES) return { ok: false, problem: "too_large" };
  const crop = parseCrop(input.crop);
  if (!crop) return { ok: false, problem: "crop" };
  // Nothing is processed or stored for a novel that isn't theirs (checked again under the lock).
  if (!(await ownsNovel(editorId, novelId))) return { ok: false, problem: "not_found" };

  const limit = await rateLimit(`cover:upload:${editorId}`, COVER_UPLOAD_LIMIT, COVER_UPLOAD_WINDOW_SECONDS);
  if (!limit.allowed) return { ok: false, problem: "rate_limited", retryAfter: limit.retryAfter };

  const processed = await processCover(new Uint8Array(await input.file.arrayBuffer()), crop);
  if (!processed.ok) {
    return { ok: false, problem: processed.error, ...(processed.error === "type" ? { type: processed.type } : {}) };
  }

  const storage = storageFor(COVER_KIND, injected);
  if (!storage) return { ok: false, problem: "storage" };
  const key = await storeImageFiles(COVER_KIND, processed, storage);
  if (!key) return { ok: false, problem: "storage" };

  const old = await getDb()
    .transaction(async (tx) => {
      const row = await lockNovel(tx, editorId, novelId);
      if (!row) return { found: false as const };
      await tx.update(novels).set({ coverKey: key }).where(and(eq(novels.id, novelId), eq(novels.editorId, editorId)));
      return { found: true as const, coverKey: row.coverKey };
    })
    .catch(async (err) => {
      await deleteObjects(COVER_KIND, storage, coverObjects(key));
      throw err;
    });
  if (!old.found) {
    // Deleted (or not theirs) since the first check: nothing points at the new files.
    await deleteObjects(COVER_KIND, storage, coverObjects(key));
    return { ok: false, problem: "not_found" };
  }
  if (old.coverKey) await deleteCoverFiles(old.coverKey, storage);
  return { ok: true, coverKey: key };
}

/**
 * The novel goes back to its drawn cover, and the uploaded one's files are
 * deleted. Clears cover_key only if it is still the key read under the lock,
 * so a racing upload's new cover is never unlinked or deleted. False when
 * there was none (or the novel isn't theirs).
 */
export async function removeCover(editorId: string, novelId: string, storage?: ObjectStorage): Promise<boolean> {
  if (!isId(editorId) || !isId(novelId)) return false;
  const removed = await getDb().transaction(async (tx) => {
    const row = await lockNovel(tx, editorId, novelId);
    if (!row?.coverKey) return null;
    const cleared = await tx
      .update(novels)
      .set({ coverKey: null })
      .where(and(eq(novels.id, novelId), eq(novels.editorId, editorId), eq(novels.coverKey, row.coverKey)))
      .returning({ id: novels.id });
    return cleared.length > 0 ? row.coverKey : null;
  });
  if (!removed) return false;
  await deleteCoverFiles(removed, storage);
  return true;
}

/** Delete one cover's files (never throws; the sweep retries). Novel and account deletion call it after their commit. */
export const deleteCoverFiles = (key: string, storage?: ObjectStorage) => deleteImageFiles(COVER_KIND, key, storage);

/** Whether `key` is some novel's current cover (the serving route checks before reading storage). */
export async function isCurrentCover(key: string): Promise<boolean> {
  if (!COVER_KEY.test(key)) return false;
  const [row] = await getDb().select({ id: novels.id }).from(novels).where(eq(novels.coverKey, key)).limit(1);
  return Boolean(row);
}

/** The JPEG copy (Satori, the JSON download), or null if it can't be read. */
export const readCoverJpeg = (key: string, storage?: ObjectStorage) => readImageJpeg(COVER_KIND, key, storage);

/**
 * A cover as a data URI for Satori (the novel's and chapters' link cards):
 * the JPEG copy read straight from storage, never a fetch to our own URL.
 * Null without an upload, or when it can't be read: the card draws the cover.
 */
export async function coverDataUri(coverKey: string | null): Promise<string | null> {
  if (!coverKey) return null;
  const jpeg = await readCoverJpeg(coverKey);
  return jpeg ? `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` : null;
}

/** The daily cleanup's part: cover files no novel points at, once COVER_ORPHAN_GRACE_HOURS old. */
export function sweepOrphanCovers(storage: ObjectStorage = photoStorage(), now = new Date()): Promise<number> {
  return sweepOrphanImages(
    COVER_KIND,
    async (keys) => {
      const rows = await getDb().select({ coverKey: novels.coverKey }).from(novels).where(inArray(novels.coverKey, keys));
      return rows.flatMap((r) => (r.coverKey ? [r.coverKey] : []));
    },
    storage,
    now,
  );
}
