import "server-only";
import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "./positions";

/*
 * Recording saved versions (docs/PLAN.md, Phases 13 and 23), shared by poems
 * (src/server/poem-history.ts) and chapters (src/server/novels.ts), each with
 * its own table passed in as a RevisionSpec, so only those two modules name
 * them (tests check). Called only inside a save
 * transaction, after the editor → owner row locks, and only when the content
 * changed (the caller compares). Each table keeps its own columns: this only
 * inserts the row it's given and prunes to `keep`.
 */

/** A revisions table: its id, the owner column (poem or chapter id) and saved_at (clock_timestamp()). */
export type RevisionSpec = { table: PgTable; id: PgColumn; owner: PgColumn; savedAt: PgColumn };

/**
 * Record `values` (the new version's columns, owner id included) as the
 * newest version and prune to `keep`, newest first. `previous` is recorded
 * first if the owner has no history yet (rows from before history existed,
 * or written by the seed, would otherwise lose the state their first edit
 * replaced).
 */
export async function recordVersion<V extends Record<string, unknown>>(
  tx: Tx,
  spec: RevisionSpec,
  ownerId: string,
  values: V,
  keep: number,
  previous?: V & { savedAt: Date },
): Promise<void> {
  const table = spec.table as PgTable & { $inferInsert: Record<string, unknown> };
  if (previous) {
    const res = (await tx.execute(sql`SELECT 1 FROM ${spec.table} WHERE ${spec.owner} = ${ownerId} LIMIT 1`)) as unknown as {
      rows: unknown[];
    };
    if (res.rows.length === 0) await tx.insert(table).values(previous as never);
  }
  await tx.insert(table).values(values as never);
  await tx.execute(sql`
    DELETE FROM ${spec.table}
    WHERE ${spec.owner} = ${ownerId} AND ${spec.id} NOT IN (
      SELECT ${spec.id} FROM ${spec.table} WHERE ${spec.owner} = ${ownerId}
      ORDER BY ${spec.savedAt} DESC, ${spec.id} DESC LIMIT ${keep}
    )
  `);
}
