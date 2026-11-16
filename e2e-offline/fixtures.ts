/**
 * Fixtures for the production offline E2E (playwright.offline.config.ts).
 * Run with tsx --conditions=react-server before `next build`, so the
 * prerendered board already shows these poems. Uses the app's own functions
 * (createPoem, createSession), so slugs, revisions and hashes are real.
 * Writes what the specs need (an editor session token, poem ids) to a JSON file.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { createPoem } from "@/server/poems";

import { FIXTURES_FILE, PRIVATE_LINE, PRIVATE_PASSWORD } from "./constants";

async function main() {
  const url = process.env.DATABASE_URL!;
  if (!/e2e|test/.test(new URL(url).pathname)) throw new Error(`Refusing to reset non-test database ${url}`);
  const pool = new pg.Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.query("TRUNCATE editors, email_otps, sessions, poems, rate_limits, retired_slugs, push_subscriptions CASCADE");
  await pool.end();

  const [editor] = await getDb()
    .insert(editors)
    .values({ email: "offline-poet@example.com", penName: "Offline Poet", slug: "offline-poet", welcomedAt: new Date() })
    .returning({ id: editors.id });
  const poem = async (title: string, body: string, visibility: "public" | "private" = "public") => {
    const res = await createPoem(editor.id, {
      title,
      body,
      visibility,
      status: "published",
      ...(visibility === "private" && { password: PRIVATE_PASSWORD }),
    });
    if (!res.ok) throw new Error(`${title}: ${JSON.stringify(res.errors)}`);
    return res.poem;
  };
  const read = await poem("Low Tide Inventory", "one blue rope, frayed at the wrist,\na crab shell turned to a teacup");
  const unpublish = await poem("Harbour Lights", "The boats come in like tired dogs,\nnosing the pier for a place to sleep.");
  const unread = await poem("Salt", "It gets into everything here,\nthe hinges, the bread, the letters");
  const secret = await poem("Old Letters", PRIVATE_LINE, "private");
  const { token } = await createSession(editor.id);

  await mkdir(path.dirname(FIXTURES_FILE), { recursive: true });
  await writeFile(FIXTURES_FILE, JSON.stringify({ token, read, unpublish, unread, secret }, null, 2));
  console.log("offline fixtures ready");
  process.exit(0);
}

void main();
