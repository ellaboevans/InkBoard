import "server-only";
import { randomBytes } from "node:crypto";
import { photoStorage, StorageError, type ObjectStorage } from "../storage";
import type { ProcessedImage } from "./process";

/*
 * Our processed copies of uploaded images in object storage, shared by
 * profile photos (docs/PLAN.md, Phase 22; src/server/profile-photos.ts) and
 * novel covers (Phase 25; src/server/novel-covers.ts). Each kind has its own
 * prefix and sizes; everything else is the same:
 *
 * - every upload is stored under a NEW random key (128 bits, base64url):
 *   never the email, an id, a slug or a title;
 * - storing is all or nothing: if any put fails, the files already written
 *   are deleted and nothing changed;
 * - deleting never throws (logged; the daily sweep retries);
 * - the daily sweep deletes files no row points at once they're older than
 *   ORPHAN_GRACE_HOURS, so an upload in progress is never touched.
 * The row that points at a key (and its locks) belongs to each kind's module.
 */

/** 128 random bits, base64url. */
export const IMAGE_KEY = /^[A-Za-z0-9_-]{22}$/;

/** Files nothing points at are deleted by the daily cleanup once this old. */
export const ORPHAN_GRACE_HOURS = 6;

export type StoredImageKind = {
  /** For logs: "photos", "covers". */
  name: string;
  /** Storage prefix, with its slash: "photos/". */
  prefix: string;
  webpWidths: readonly number[];
  jpegWidth: number;
};

export function newImageKey(): string {
  return randomBytes(16).toString("base64url");
}

export const webpObjectOf = (kind: StoredImageKind, key: string, width: number) => `${kind.prefix}${key}/${width}.webp`;
export const jpegObjectOf = (kind: StoredImageKind, key: string) => `${kind.prefix}${key}/${kind.jpegWidth}.jpg`;

/** Every object one image is stored as. */
export function objectsOf(kind: StoredImageKind, key: string): string[] {
  return [...kind.webpWidths.map((w) => webpObjectOf(kind, key, w)), jpegObjectOf(kind, key)];
}

/** The kind's storage, or null with a log line (production without R2: the caller answers "storage"). */
export function storageFor(kind: StoredImageKind, injected?: ObjectStorage): ObjectStorage | null {
  try {
    return injected ?? photoStorage();
  } catch (err) {
    console.error(`[${kind.name}] image storage is not available`, describeStorageError(err));
    return null;
  }
}

/** Put every copy under a new key; on any failure delete what was written and return null. */
export async function storeImageFiles(kind: StoredImageKind, image: ProcessedImage, storage: ObjectStorage): Promise<string | null> {
  const key = newImageKey();
  const files: [string, Uint8Array, string][] = [
    ...kind.webpWidths.map((w) => [webpObjectOf(kind, key, w), image.webp[w], "image/webp"] as [string, Uint8Array, string]),
    [jpegObjectOf(kind, key), image.jpeg, "image/jpeg"],
  ];
  const puts = await Promise.allSettled(files.map(([k, body, type]) => storage.put(k, body, type)));
  const failed = puts.find((p) => p.status === "rejected");
  if (failed) {
    console.error(`[${kind.name}] storing an image failed`, describeStorageError(failed.reason));
    await deleteObjects(kind, storage, objectsOf(kind, key));
    return null;
  }
  return key;
}

/** Delete one image's files. Never throws: a failure is logged and the daily sweep deletes them later. */
export async function deleteImageFiles(kind: StoredImageKind, key: string, storage?: ObjectStorage): Promise<void> {
  try {
    await deleteObjects(kind, storage ?? photoStorage(), objectsOf(kind, key));
  } catch (err) {
    console.error(`[${kind.name}] deleting an image's files failed; the daily cleanup will retry`, describeStorageError(err));
  }
}

export async function deleteObjects(kind: StoredImageKind, storage: ObjectStorage, keys: string[]) {
  const results = await Promise.allSettled(keys.map((k) => storage.delete(k)));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) console.error(`[${kind.name}] delete failed`, describeStorageError(failed.reason));
}

/** The JPEG copy (Satori, the JSON download), or null if it can't be read. */
export async function readImageJpeg(kind: StoredImageKind, key: string, storage?: ObjectStorage): Promise<Uint8Array | null> {
  if (!IMAGE_KEY.test(key)) return null;
  try {
    return await (storage ?? photoStorage()).get(jpegObjectOf(kind, key));
  } catch (err) {
    console.error(`[${kind.name}] reading an image failed`, describeStorageError(err));
    return null;
  }
}

/**
 * The daily cleanup's part for one kind: delete files under its prefix that
 * no row points at (`liveKeys` answers which of the given keys are still
 * current) and that are older than the grace period. Returns how many images
 * (keys) were deleted.
 */
export async function sweepOrphanImages(
  kind: StoredImageKind,
  liveKeys: (keys: string[]) => Promise<Iterable<string>>,
  storage: ObjectStorage,
  now = new Date(),
): Promise<number> {
  const objects = await storage.list(kind.prefix);
  const cutoff = now.getTime() - ORPHAN_GRACE_HOURS * 3600 * 1000;
  const byKey = new Map<string, { objects: string[]; newest: number }>();
  for (const o of objects) {
    const key = o.key.slice(kind.prefix.length).split("/")[0];
    if (!IMAGE_KEY.test(key)) continue; // not ours: leave it alone
    const entry = byKey.get(key) ?? { objects: [], newest: 0 };
    entry.objects.push(o.key);
    entry.newest = Math.max(entry.newest, o.lastModified.getTime());
    byKey.set(key, entry);
  }
  const old = [...byKey].filter(([, e]) => e.newest < cutoff).map(([k]) => k);
  if (old.length === 0) return 0;
  const live = new Set<string>();
  for (let i = 0; i < old.length; i += 500) for (const k of await liveKeys(old.slice(i, i + 500))) live.add(k);
  let deleted = 0;
  for (const key of old) {
    if (live.has(key)) continue;
    await deleteObjects(kind, storage, byKey.get(key)!.objects);
    deleted++;
  }
  return deleted;
}

/** For logs: the code and message (StorageError messages never hold a secret), or the error's name. */
export function describeStorageError(err: unknown): string {
  if (err instanceof StorageError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
