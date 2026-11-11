import "server-only";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import ws from "ws";
import { env } from "@/env";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function isNeonUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

function createDb(url: string): Database {
  if (isNeonUrl(url)) {
    // WebSocket pool: supports interactive transactions, unlike neon-http.
    // Node < 22 has no global WebSocket, so provide one.
    neonConfig.webSocketConstructor ??= ws;
    return drizzleNeon({ client: new NeonPool({ connectionString: url }), schema });
  }
  return drizzlePg({ client: new pg.Pool({ connectionString: url, max: 10 }), schema });
}

// Reuse a single pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __poemhubDb?: Database };

export function getDb(): Database {
  globalForDb.__poemhubDb ??= createDb(env().DATABASE_URL);
  return globalForDb.__poemhubDb;
}

export { schema };
