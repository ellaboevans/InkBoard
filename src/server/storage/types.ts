/** A small object store (docs/PLAN.md, Phase 22): what profile photos need, nothing more. */
export interface ObjectStorage {
  /** "r2" or "local", for logs and the storage check. */
  readonly kind: "r2" | "local";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** The bytes, or null when there's no such object. */
  get(key: string): Promise<Uint8Array | null>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Every object under a prefix, with when it was written (the orphan sweep). */
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
}

/** A failure the storage check and the logs can explain without printing a secret. */
export class StorageError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "bad_credentials"
      | "access_denied"
      | "no_bucket"
      | "network"
      | "unexpected",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Keys are ours (photos/<random>/<file>): anything else is refused before any I/O. */
export const OBJECT_KEY = /^[a-z]+(?:\/[A-Za-z0-9_-]{1,64})*(?:\/[A-Za-z0-9_-]{1,64}\.[a-z]{2,4})?$/;

export function assertKey(key: string) {
  if (!OBJECT_KEY.test(key) || key.length > 200) throw new StorageError("unexpected", "Invalid object key");
}
