import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Apply migrations to the test database once per run. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/poemhub_test";
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error(`Refusing to run tests against non-test database: ${url}`);
  }
  const pool = new pg.Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
