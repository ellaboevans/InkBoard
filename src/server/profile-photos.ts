import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { parseCrop } from "@/lib/photo-crop";
import {
  PHOTO_JPEG_SIZE,
  PHOTO_MAX_BYTES,
  PHOTO_UPLOAD_LIMIT,
  PHOTO_UPLOAD_WINDOW_SECONDS,
  PHOTO_WEBP_SIZES,
  type PhotoWebpSize,
} from "@/lib/photo-limits";
import type { PhotoProblem } from "@/lib/photo-messages";
import type { SniffedType } from "@/lib/photo-sniff";
import { processPhoto } from "./photos/process";
import { rateLimit } from "./rate-limit";
import { photoStorage, StorageError, type ObjectStorage } from "./storage";

/*
 * Profile photos (docs/PLAN.md, Phase 22). Framework-free like poems.ts:
 * every function takes the DAL-resolved editor id (or, for the owner's
 * takedown, an author slug) and scopes every query by it.
 *
 * Saving is one step for the writer, and never half-done:
 * 1. checks and processing (process.ts) touch nothing stored;
 * 2. the copies go to storage under a NEW random key (photos/<key>/…);
 *    if any put fails, the ones written are deleted and the old photo stays;
 * 3. one UPDATE under the editor row lock swaps editors.photo_key;
 * 4. after the commit, the old key's files are deleted.
 * A crash between 2 and 3 (or a failed delete in 4) leaves files no row
 * points at: the daily cleanup (sweepOrphanPhotos) deletes those once they
 * are PHOTO_ORPHAN_GRACE_HOURS old, so an upload in progress is never touched.
 */

/** 128 random bits, base64url: never the email, id or slug. */
export const PHOTO_KEY = /^[A-Za-z0-9_-]{22}$/;
export const PHOTO_PREFIX = "photos/";

/** Files nothing points at are deleted by the daily cleanup once this old. */
export const PHOTO_ORPHAN_GRACE_HOURS = 6;

export function newPhotoKey(): string {
  return randomBytes(16).toString("base64url");
}

export const webpObject = (key: string, size: PhotoWebpSize) => `${PHOTO_PREFIX}${key}/${size}.webp`;
export const jpegObject = (key: string) => `${PHOTO_PREFIX}${key}/${PHOTO_JPEG_SIZE}.jpg`;

/** Every object one photo is stored as. */
export function photoObjects(key: string): string[] {
  return [...PHOTO_WEBP_SIZES.map((s) => webpObject(key, s)), jpegObject(key)];
}

const idSchema = z.uuid();

export type SavePhotoResult =
  | { ok: true; photoKey: string }
  | { ok: false; problem: PhotoProblem; type?: SniffedType; retryAfter?: number };

function isBlob(v: unknown): v is Blob {
  return typeof Blob !== "undefined" && v instanceof Blob;
}

export async function savePhoto(
  editorId: string,
  input: { file: unknown; crop: unknown },
  injected?: ObjectStorage,
): Promise<SavePhotoResult> {
  if (!idSchema.safeParse(editorId).success) return { ok: false, problem: "no_file" };
  if (!isBlob(input.file) || input.file.size === 0) return { ok: false, problem: "no_file" };
  // Before reading a byte of it.
  if (input.file.size > PHOTO_MAX_BYTES) return { ok: false, problem: "too_large" };
  const crop = parseCrop(input.crop);
  if (!crop) return { ok: false, problem: "crop" };

  const limit = await rateLimit(`photo:upload:${editorId}`, PHOTO_UPLOAD_LIMIT, PHOTO_UPLOAD_WINDOW_SECONDS);
  if (!limit.allowed) return { ok: false, problem: "rate_limited", retryAfter: limit.retryAfter };

  const processed = await processPhoto(new Uint8Array(await input.file.arrayBuffer()), crop);
  if (!processed.ok) {
    return { ok: false, problem: processed.error, ...(processed.error === "type" ? { type: processed.type } : {}) };
  }

  let storage: ObjectStorage;
  try {
    storage = injected ?? photoStorage();
  } catch (err) {
    // Production without R2: a clear log line for the owner, a clear toast for the writer.
    console.error("[photos] photo storage is not available", describeStorageError(err));
    return { ok: false, problem: "storage" };
  }

  const key = newPhotoKey();
  const files: [string, Uint8Array, string][] = [
    ...PHOTO_WEBP_SIZES.map((s) => [webpObject(key, s), processed.webp[s], "image/webp"] as [string, Uint8Array, string]),
    [jpegObject(key), processed.jpeg, "image/jpeg"],
  ];
  const puts = await Promise.allSettled(files.map(([k, body, type]) => storage.put(k, body, type)));
  const failed = puts.find((p) => p.status === "rejected");
  if (failed) {
    console.error("[photos] storing a photo failed", describeStorageError(failed.reason));
    await deleteObjects(storage, photoObjects(key));
    return { ok: false, problem: "storage" };
  }

  const old = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ photoKey: editors.photoKey })
      .from(editors)
      .where(eq(editors.id, editorId))
      .for("no key update");
    if (!row) return { found: false as const };
    await tx.update(editors).set({ photoKey: key }).where(eq(editors.id, editorId));
    return { found: true as const, photoKey: row.photoKey };
  }).catch(async (err) => {
    await deleteObjects(storage, photoObjects(key));
    throw err;
  });
  if (!old.found) {
    await deleteObjects(storage, photoObjects(key));
    return { ok: false, problem: "no_file" };
  }
  if (old.photoKey) await deletePhotoFiles(old.photoKey, storage);
  return { ok: true, photoKey: key };
}

/** The editor's own photo goes, files and all. False when there was none. */
export async function removePhoto(editorId: string, storage?: ObjectStorage): Promise<boolean> {
  if (!idSchema.safeParse(editorId).success) return false;
  const [row] = await getDb()
    .select({ photoKey: editors.photoKey })
    .from(editors)
    .where(and(eq(editors.id, editorId), isNotNull(editors.photoKey)));
  if (!row?.photoKey) return false;
  return unlink(eq(editors.id, editorId), row.photoKey, storage);
}

/**
 * The site owner's takedown (docs/PLAN.md, Phase 22): an author's photo goes,
 * found by their public slug, without their account. The caller refreshes
 * the readers' cache. Null when the author doesn't exist.
 */
export async function takeDownPhoto(authorSlug: string, storage?: ObjectStorage): Promise<{ removed: boolean } | null> {
  const [row] = await getDb()
    .select({ id: editors.id, photoKey: editors.photoKey })
    .from(editors)
    .where(eq(editors.slug, authorSlug));
  if (!row) return null;
  if (!row.photoKey) return { removed: false };
  return { removed: await unlink(eq(editors.id, row.id), row.photoKey, storage) };
}

/** Clear photo_key only if it is still `key` (a newer upload wins), then delete the files. */
async function unlink(who: ReturnType<typeof eq>, key: string, storage?: ObjectStorage): Promise<boolean> {
  const cleared = await getDb()
    .update(editors)
    .set({ photoKey: null })
    .where(and(who, eq(editors.photoKey, key)))
    .returning({ id: editors.id });
  if (cleared.length === 0) return false;
  await deletePhotoFiles(key, storage);
  return true;
}

/**
 * Delete one photo's files. Never throws: a failure is logged and the
 * daily sweep deletes them later (no row points at them any more).
 */
export async function deletePhotoFiles(key: string, storage?: ObjectStorage): Promise<void> {
  try {
    await deleteObjects(storage ?? photoStorage(), photoObjects(key));
  } catch (err) {
    console.error("[photos] deleting a photo's files failed; the daily cleanup will retry", describeStorageError(err));
  }
}

async function deleteObjects(storage: ObjectStorage, keys: string[]) {
  const results = await Promise.allSettled(keys.map((k) => storage.delete(k)));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) console.error("[photos] delete failed", describeStorageError(failed.reason));
}

/** Whether `key` is someone's current photo (the serving route checks before reading storage). */
export async function isCurrentPhoto(key: string): Promise<boolean> {
  if (!PHOTO_KEY.test(key)) return false;
  const [row] = await getDb().select({ id: editors.id }).from(editors).where(eq(editors.photoKey, key)).limit(1);
  return Boolean(row);
}

/** The JPEG copy (Satori, the JSON download), or null if it can't be read. */
export async function readPhotoJpeg(key: string, storage?: ObjectStorage): Promise<Uint8Array | null> {
  if (!PHOTO_KEY.test(key)) return null;
  try {
    return await (storage ?? photoStorage()).get(jpegObject(key));
  } catch (err) {
    console.error("[photos] reading a photo failed", describeStorageError(err));
    return null;
  }
}

/**
 * The daily cleanup's part (src/server/maintenance.ts): delete files under
 * photos/ that no editor points at and that are older than the grace period.
 * Returns how many photos (keys) were deleted.
 */
export async function sweepOrphanPhotos(storage: ObjectStorage = photoStorage(), now = new Date()): Promise<number> {
  const objects = await storage.list(PHOTO_PREFIX);
  const cutoff = now.getTime() - PHOTO_ORPHAN_GRACE_HOURS * 3600 * 1000;
  const byKey = new Map<string, { objects: string[]; newest: number }>();
  for (const o of objects) {
    const key = o.key.slice(PHOTO_PREFIX.length).split("/")[0];
    if (!PHOTO_KEY.test(key)) continue; // not ours: leave it alone
    const entry = byKey.get(key) ?? { objects: [], newest: 0 };
    entry.objects.push(o.key);
    entry.newest = Math.max(entry.newest, o.lastModified.getTime());
    byKey.set(key, entry);
  }
  const old = [...byKey].filter(([, e]) => e.newest < cutoff).map(([k]) => k);
  if (old.length === 0) return 0;
  const live = new Set<string>();
  for (let i = 0; i < old.length; i += 500) {
    const rows = await getDb()
      .select({ photoKey: editors.photoKey })
      .from(editors)
      .where(inArray(editors.photoKey, old.slice(i, i + 500)));
    for (const r of rows) if (r.photoKey) live.add(r.photoKey);
  }
  let deleted = 0;
  for (const key of old) {
    if (live.has(key)) continue;
    await deleteObjects(storage, byKey.get(key)!.objects);
    deleted++;
  }
  return deleted;
}

/** For logs: the code and message (StorageError messages never hold a secret), or the error's name. */
export function describeStorageError(err: unknown): string {
  if (err instanceof StorageError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
