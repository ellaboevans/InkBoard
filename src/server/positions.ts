import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { getDb } from "@/db";

/*
 * Contiguous positions 1..n within a group (docs/PLAN.md, Phases 14 and 23):
 * a collection's poems, a novel's chapters. Shared, not copied: both keep
 * every add, move, removal and delete contiguous through these helpers, and a
 * unique (group, position) index forbids duplicates.
 *
 * Callers hold the locks (editor row → group row → item rows, CLAUDE.md);
 * orderOf locks the items itself (FOR UPDATE).
 */

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Where an ordered group lives: the items' table, its id, the group column and the position column. */
export type PositionSpec = { table: PgTable; id: PgColumn; group: PgColumn; position: PgColumn };

export type Direction = "up" | "down" | "first" | "last";

/** The group's item ids in order, locking the rows. */
export async function orderOf(tx: Tx, spec: PositionSpec, groupId: string): Promise<string[]> {
  const res = (await tx.execute(sql`
    SELECT ${spec.id} AS id FROM ${spec.table}
    WHERE ${spec.group} = ${groupId}
    ORDER BY ${spec.position}, ${spec.id}
    FOR UPDATE
  `)) as unknown as { rows: { id: string }[] };
  return res.rows.map((r) => r.id);
}

/**
 * Write positions 1..n for `ids` (every item of the group). Two steps, so the
 * unique (group, position) index never sees two items at one position
 * mid-update: first everyone to a negative position, then to their final one.
 */
export async function applyOrder(tx: Tx, spec: PositionSpec, groupId: string, ids: string[]): Promise<void> {
  const pos = sql.identifier(spec.position.name);
  await tx.execute(sql`UPDATE ${spec.table} SET ${pos} = -${spec.position} WHERE ${spec.group} = ${groupId}`);
  if (ids.length === 0) return;
  const cases = sql.join(
    ids.map((id, i) => sql`WHEN ${id}::uuid THEN ${i + 1}::int`),
    sql` `,
  );
  await tx.execute(sql`
    UPDATE ${spec.table} SET ${pos} = CASE ${spec.id} ${cases} END
    WHERE ${spec.group} = ${groupId} AND ${spec.id} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
}

/** Close the gaps after an item left (or was deleted). */
export async function compact(tx: Tx, spec: PositionSpec, groupId: string): Promise<void> {
  await applyOrder(tx, spec, groupId, await orderOf(tx, spec, groupId));
}

/** The next position at the end of the group, as SQL for an INSERT or UPDATE (call under the group lock). */
export function endPosition(spec: PositionSpec, groupId: string): SQL {
  return sql`(SELECT count(*) + 1 FROM ${spec.table} WHERE ${spec.group} = ${groupId})`;
}

/** Where `from` goes for a relative move (pure). */
export function moveTarget(length: number, from: number, direction: Direction): number {
  return direction === "up" ? Math.max(0, from - 1)
    : direction === "down" ? Math.min(length - 1, from + 1)
      : direction === "first" ? 0
        : length - 1;
}

/**
 * A relative move of one item, under the caller's locks. Relative, not a
 * whole new order from the client, so a stale page can't undo someone
 * else's change. Null when the item isn't in the group.
 */
export async function moveItem(
  tx: Tx,
  spec: PositionSpec,
  groupId: string,
  itemId: string,
  direction: Direction,
): Promise<{ position: number; total: number; changed: boolean } | null> {
  const ids = await orderOf(tx, spec, groupId);
  const from = ids.indexOf(itemId);
  if (from < 0) return null;
  const to = moveTarget(ids.length, from, direction);
  if (to !== from) {
    ids.splice(to, 0, ...ids.splice(from, 1));
    await applyOrder(tx, spec, groupId, ids);
  }
  return { position: to + 1, total: ids.length, changed: to !== from };
}

/**
 * Save a whole new order (drag and drop), under the caller's locks. `ids`
 * must be exactly the group's current items: if someone added, removed or
 * moved one meanwhile, nothing changes ("stale").
 */
export async function reorderItems(
  tx: Tx,
  spec: PositionSpec,
  groupId: string,
  ids: string[],
): Promise<"changed" | "unchanged" | "stale"> {
  const current = await orderOf(tx, spec, groupId);
  if (current.length !== ids.length || new Set(ids).size !== ids.length || !current.every((id) => ids.includes(id))) {
    return "stale";
  }
  if (current.every((id, i) => id === ids[i])) return "unchanged";
  await applyOrder(tx, spec, groupId, ids);
  return "changed";
}
