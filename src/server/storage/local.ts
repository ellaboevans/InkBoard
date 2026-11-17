import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertKey, type ObjectStorage } from "./types";

/*
 * The local driver: a folder on disk (gitignored `.storage/`), used in
 * development, Vitest and E2E. A folder rather than the database so it
 * behaves like the real store (bytes outside our rows, deleted separately,
 * listed for the orphan sweep) and tests can check that files are really gone.
 * Writes go to a temporary name first, so a crash never leaves half a file.
 */
export function localStorage(root: string): ObjectStorage {
  const full = (key: string) => {
    assertKey(key);
    return path.join(root, ...key.split("/"));
  };
  return {
    kind: "local",
    async put(key, body) {
      const file = full(key);
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, file);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(full(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async delete(key) {
      const file = full(key);
      await rm(file, { force: true });
      // Tidy the now-empty folder (photos/<key>/), ignoring "not empty".
      await rmdir(path.dirname(file)).catch(() => {});
    },
    async list(prefix) {
      const out: { key: string; lastModified: Date }[] = [];
      async function walk(dir: string, rel: string) {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
          throw err;
        }
        for (const e of entries) {
          const k = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(path.join(dir, e.name), k);
          else if (!e.name.endsWith(".tmp") && k.startsWith(prefix)) {
            out.push({ key: k, lastModified: (await stat(path.join(dir, e.name))).mtime });
          }
        }
      }
      await walk(root, "");
      return out;
    },
  };
}
