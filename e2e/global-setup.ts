import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { E2E_BASE_URL, E2E_DATABASE_URL, OTP_OUTBOX } from "../playwright.config";

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
  await warmUp();
}

/**
 * `next dev` compiles each route the first time it's requested, which can
 * take 10–20 s on a busy machine and blow test timeouts. Request every route
 * once up front (unknown slugs/ids are fine: the route still compiles).
 * The poem overlay is an intercepted route, compiled only for a client-side
 * navigation, so it's requested the way the router does (RSC + Next-Url).
 */
async function warmUp() {
  const routes: [string, Record<string, string>?][] = [
    ["/sign-in"],
    ["/"],
    ["/admin"],
    ["/admin/onboarding"],
    ["/admin/poems/new"],
    ["/admin/poems/00000000-0000-0000-0000-000000000000"],
    ["/admin/settings"],
    ["/admin/profile"],
    ["/avatars/a01"],
    ["/api/search?q=warm"],
    ["/p/warm-up/warm-up"],
    ["/p/warm-up/warm-up", { RSC: "1", "Next-Url": "/" }],
  ];
  await Promise.all(
    routes.map(([route, headers]) =>
      fetch(E2E_BASE_URL + route, { headers, redirect: "manual", signal: AbortSignal.timeout(120_000) })
        .then((r) => r.arrayBuffer())
        .catch(() => {}),
    ),
  );
}
