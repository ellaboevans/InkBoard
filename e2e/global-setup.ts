import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { E2E_DATABASE_URL, OTP_OUTBOX } from "../playwright.config";

export default async function globalSetup() {
  if (!/e2e|test/.test(new URL(E2E_DATABASE_URL).pathname)) {
    throw new Error(`Refusing to reset non-test database ${E2E_DATABASE_URL}`);
  }
  const pool = new pg.Pool({ connectionString: E2E_DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.query(
    "TRUNCATE editors, email_otps, sessions, poems, rate_limits CASCADE",
  );
  await pool.end();
  await mkdir(path.dirname(OTP_OUTBOX), { recursive: true });
  await writeFile(OTP_OUTBOX, "");
}
