/**
 * Runs before `pnpm dev`: fails fast, in plain words, if DATABASE_URL is
 * missing migrations from ./drizzle. Otherwise new code queries columns the
 * database doesn't have yet, and you get cryptic "column does not exist"
 * errors on random pages.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

type Journal = { entries: { tag: string; when: number }[] };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) return; // env validation reports this properly at runtime
  const journal: Journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    console.warn(`⚠ Could not reach the database to check migrations: ${(err as Error).message}`);
    return;
  }
  let applied: number[] = [];
  try {
    const res = await client.query<{ created_at: string }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations",
    );
    applied = res.rows.map((r) => Number(r.created_at));
  } catch {
    // No migrations table yet: nothing applied.
  } finally {
    await client.end();
  }

  // Same rule drizzle's migrator uses: anything newer than the last applied one is pending.
  const last = Math.max(0, ...applied);
  const pending = journal.entries.filter((e) => e.when > last);
  if (pending.length === 0) return;

  const db = new URL(url);
  console.error(
    `\n✖ Your database (${db.host}${db.pathname}) is missing ${pending.length} migration(s):\n` +
      pending.map((p) => `    - ${p.tag}`).join("\n") +
      `\n\n  Run:  pnpm db:migrate\n` +
      `  (or SKIP_MIGRATION_CHECK=1 pnpm dev to start anyway)\n`,
  );
  process.exit(1);
}

if (!process.env.SKIP_MIGRATION_CHECK) {
  main().catch((err) => {
    console.warn(`⚠ Migration check skipped: ${(err as Error).message}`);
  });
}
