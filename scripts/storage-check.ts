/**
 * `pnpm storage:check` (docs/DEPLOY.md, "Profile photos: Cloudflare R2"):
 * once the R2 env vars are set, put a small test object, read it back, list
 * it, delete it, and say plainly whether that worked or what is wrong (wrong
 * key, missing bucket, permissions). Never prints a secret.
 *
 * Reads .env.local / .env like `pnpm dev`; to check Vercel's values, run it
 * with them in the environment (e.g. `vercel env pull .env.check` and
 * `DOTENV_CONFIG_PATH=.env.check pnpm storage:check`).
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import { photoStorageConfig } from "@/env";
import { localStorage } from "@/server/storage/local";
import { r2Storage } from "@/server/storage/r2";
import { StorageError, type ObjectStorage } from "@/server/storage/types";

config({ path: process.env.DOTENV_CONFIG_PATH ? [process.env.DOTENV_CONFIG_PATH] : [".env.local", ".env"], quiet: true });

const HINTS: Record<StorageError["code"], string> = {
  not_configured: "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (docs/DEPLOY.md).",
  bad_credentials: "R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is wrong: copy both again from the API token's page (the secret is shown once).",
  access_denied: "The token can't do this: give it \"Object Read & Write\", applied to this bucket.",
  no_bucket: "R2_BUCKET doesn't name a bucket in this account: check the spelling, and that R2_ACCOUNT_ID is this account's.",
  network: "R2 couldn't be reached: check R2_ACCOUNT_ID (the 32-character account ID) and your connection.",
  unexpected: "R2 answered something unexpected; the status and code above say what.",
};

async function main() {
  const cfg = photoStorageConfig();
  let storage: ObjectStorage;
  if (cfg.driver === "r2") {
    console.log(`Checking R2: bucket "${cfg.bucket}", account …${cfg.accountId.slice(-4)}, key …${cfg.accessKeyId.slice(-4)}`);
    storage = r2Storage(cfg);
  } else if (cfg.driver === "local") {
    console.log(`No R2 variables set: checking the local folder ${cfg.dir} (development only).`);
    storage = localStorage(path.resolve(cfg.dir));
  } else {
    throw new StorageError("not_configured", cfg.reason);
  }

  const key = `check/${randomBytes(9).toString("base64url")}.txt`;
  const body = new TextEncoder().encode(`InkBoard storage check ${new Date().toISOString()}`);
  const step = async <T>(name: string, run: () => Promise<T>) => {
    process.stdout.write(`  ${name}… `);
    const out = await run();
    console.log("ok");
    return out;
  };

  await step("put a test object", () => storage.put(key, body, "text/plain"));
  try {
    const back = await step("read it back", () => storage.get(key));
    if (!back || Buffer.compare(Buffer.from(back), Buffer.from(body)) !== 0) {
      throw new StorageError("unexpected", "The object read back isn't the one written.");
    }
    const listed = await step("list it (the daily cleanup needs this)", () => storage.list("check/"));
    if (!listed.some((o) => o.key === key)) throw new StorageError("unexpected", "The test object wasn't in the listing.");
  } finally {
    await step("delete it", () => storage.delete(key));
  }
  const gone = await step("check it's gone", () => storage.get(key));
  if (gone) throw new StorageError("unexpected", "The test object is still there after deleting it.");
  console.log(`\nPASS: photo storage (${storage.kind}) works.`);
}

main().catch((err) => {
  console.log("failed");
  if (err instanceof StorageError) {
    console.error(`\nFAIL (${err.code}): ${err.message}\n${HINTS[err.code]}`);
  } else {
    console.error(`\nFAIL: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
