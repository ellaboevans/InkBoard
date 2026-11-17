import "server-only";
import path from "node:path";
import { photoStorageConfig } from "@/env";
import { localStorage } from "./local";
import { r2Storage } from "./r2";
import { StorageError, type ObjectStorage } from "./types";

export { StorageError, type ObjectStorage } from "./types";

let cached: { signature: string; storage: ObjectStorage } | undefined;

/**
 * The photo store: R2 when its four env vars are set, else the local folder
 * (development, Vitest, E2E). Production without R2 throws
 * StorageError("not_configured") here, at the first upload or read, never at
 * build time.
 */
export function photoStorage(): ObjectStorage {
  const config = photoStorageConfig();
  const signature = JSON.stringify(config);
  if (cached?.signature === signature) return cached.storage;
  let storage: ObjectStorage;
  if (config.driver === "r2") storage = r2Storage(config);
  else if (config.driver === "local") storage = localStorage(path.resolve(/* turbopackIgnore: true */ process.cwd(), config.dir));
  else throw new StorageError("not_configured", config.reason);
  cached = { signature, storage };
  return storage;
}
