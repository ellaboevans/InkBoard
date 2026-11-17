import "server-only";
import { and, asc, count, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { collections, editors, poems } from "@/db/schema";
import {
  COLLECTION_INTRO_MAX,
  COLLECTION_POEMS_MAX,
  COLLECTION_TITLE_MAX,
  COLLECTIONS_MAX,
} from "@/lib/collection-limits";
import { toNfc } from "@/lib/letters";
import { firstFreeSlug, slugify } from "@/lib/slug";
import { compact, endPosition, moveItem, orderOf as positionsOrder, reorderItems, type PositionSpec, type Tx } from "./positions";

/*
 * Collections (docs/PLAN.md, Phase 14): an editor's named, ordered groups of
 * their own poems. Same rules as poems.ts: every function takes the
 * DAL-resolved editor id and scopes every query by it, so another editor's
 * collection or poem id behaves like a missing one, and malformed ids are
 * rejected before SQL.
 *
 * Positions are 1..n over all of a collection's poems (drafts included) and
 * stay contiguous through every add, move, removal and delete. Readers'
 * "Part 3 of 7" counts published poems only (board.ts).
 *
 * Lock order (CLAUDE.md): the editor row first (FOR NO KEY UPDATE, like poem
 * saves), then collection rows, then poem rows. The editor lock alone queues
 * all of one editor's writes behind each other, so reorders, saves and
 * deletes can't interleave; the rest keeps a fixed order for safety.
 * NO KEY UPDATE on collections doesn't block the foreign-key checks
 * (KEY SHARE) of poems pointing at them.
 */

export { COLLECTION_INTRO_MAX, COLLECTION_POEMS_MAX, COLLECTION_TITLE_MAX, COLLECTIONS_MAX };

const idSchema = z.uuid();
const isId = (id: unknown): id is string => idSchema.safeParse(id).success;

export type { Tx };

const inputSchema = z.object({
  title: z
    .string()
    .overwrite(toNfc)
    .trim()
    .min(1, "Give the collection a title")
    .max(COLLECTION_TITLE_MAX, `Titles can be at most ${COLLECTION_TITLE_MAX} characters`),
  intro: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? "" : toNfc(s).replace(/\r\n?/g, "\n").trim()))
    .pipe(z.string().max(COLLECTION_INTRO_MAX, `The intro can be at most ${COLLECTION_INTRO_MAX} characters`))
    .transform((s) => s || null),
});

export type CollectionInput = z.input<typeof inputSchema>;
export type CollectionErrors = Partial<Record<keyof CollectionInput | "form", string>>;
export type CollectionResult =
  | { ok: true; collection: { id: string; slug: string } }
  | { ok: false; errors: CollectionErrors }
  | { ok: false; notFound: true };

function parse(raw: unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (parsed.success) return { data: parsed.data } as const;
  const errors: CollectionErrors = {};
  for (const issue of parsed.error.issues) {
    const field = (issue.path[0] as keyof CollectionInput | undefined) ?? "form";
    errors[field] ??= issue.message;
  }
  return { errors } as const;
}

// ---- locks and positions (used by poems.ts too) ---------------------------

/** Editor row first, like every poem save (see lockPasswordMode in poems.ts). */
async function lockEditor(tx: Tx, editorId: string) {
  await tx.select({ id: editors.id }).from(editors).where(eq(editors.id, editorId)).for("no key update");
}

/**
 * Lock the editor's own collections among `ids` (in id order) and return the
 * ones that exist. Call after the editor lock and before locking poems.
 */
export async function lockCollections(tx: Tx, editorId: string, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter(isId))].sort();
  if (wanted.length === 0) return new Set<string>();
  const rows = await tx
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.editorId, editorId), inArray(collections.id, wanted)))
    .orderBy(asc(collections.id))
    .for("no key update");
  return new Set(rows.map((r) => r.id));
}

/** Where a collection's poems keep their order (src/server/positions.ts, shared with novels). */
const POSITIONS = { table: poems, id: poems.id, group: poems.collectionId, position: poems.collectionPosition } satisfies PositionSpec;

const touch = (tx: Tx, collectionId: string) =>
  tx.update(collections).set({ updatedAt: sql`now()` }).where(eq(collections.id, collectionId));

/** The collection's poem ids in order (locked). */
const orderOf = (tx: Tx, collectionId: string) => positionsOrder(tx, POSITIONS, collectionId);

/** Close the gaps after a poem left (or was deleted). */
export async function compactCollection(tx: Tx, collectionId: string) {
  await compact(tx, POSITIONS, collectionId);
  await touch(tx, collectionId);
}

const FULL = `A collection can hold at most ${COLLECTION_POEMS_MAX} poems`;

/**
 * Move a (locked) poem into `to` (at the end), out of `from`, or both.
 * Collections must already be locked and checked to be the editor's.
 * Returns an error message if `to` is full.
 */
export async function placePoem(
  tx: Tx,
  poemId: string,
  from: string | null,
  to: string | null,
): Promise<string | null> {
  if (from === to) return null;
  if (to) {
    const [{ n }] = await tx.select({ n: count() }).from(poems).where(eq(poems.collectionId, to));
    if (n >= COLLECTION_POEMS_MAX) return FULL;
  }
  await tx
    .update(poems)
    .set(to ? { collectionId: to, collectionPosition: endPosition(POSITIONS, to) } : { collectionId: null, collectionPosition: null })
    .where(eq(poems.id, poemId));
  if (from) await compactCollection(tx, from);
  if (to) await touch(tx, to);
  return null;
}

// ---- reads ------------------------------------------------------------------

export type CollectionSummary = {
  id: string;
  title: string;
  slug: string;
  intro: string | null;
  poemCount: number;
  publishedCount: number;
  updatedAt: Date;
};

export type CollectionPoem = {
  id: string;
  title: string;
  status: "draft" | "published";
  visibility: "public" | "private";
  position: number;
};

export type EditorCollection = Omit<CollectionSummary, "poemCount" | "publishedCount"> & {
  poems: CollectionPoem[];
};

/** The editor's collections, A–Z. */
export async function listCollections(editorId: string): Promise<CollectionSummary[]> {
  const rows = await getDb()
    .select({
      id: collections.id,
      title: collections.title,
      slug: collections.slug,
      intro: collections.intro,
      updatedAt: collections.updatedAt,
      poemCount: sql<number>`count(${poems.id})::int`,
      publishedCount: sql<number>`count(${poems.id}) FILTER (WHERE ${poems.status} = 'published')::int`,
    })
    .from(collections)
    .leftJoin(poems, eq(poems.collectionId, collections.id))
    .where(eq(collections.editorId, editorId))
    .groupBy(collections.id)
    .orderBy(asc(sql`lower(${collections.title})`), asc(collections.id));
  return rows;
}

/** For the poem editor's picker. */
export async function collectionOptions(editorId: string): Promise<{ id: string; title: string }[]> {
  return getDb()
    .select({ id: collections.id, title: collections.title })
    .from(collections)
    .where(eq(collections.editorId, editorId))
    .orderBy(asc(sql`lower(${collections.title})`), asc(collections.id));
}

/** One of the editor's collections with its poems in order, or null. */
export async function getCollection(editorId: string, collectionId: string): Promise<EditorCollection | null> {
  if (!isId(collectionId)) return null;
  const db = getDb();
  const [c] = await db
    .select({
      id: collections.id,
      title: collections.title,
      slug: collections.slug,
      intro: collections.intro,
      updatedAt: collections.updatedAt,
    })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.editorId, editorId)))
    .limit(1);
  if (!c) return null;
  const list = await db
    .select({
      id: poems.id,
      title: poems.title,
      status: poems.status,
      visibility: poems.visibility,
      position: sql<number>`${poems.collectionPosition}`,
    })
    .from(poems)
    .where(and(eq(poems.collectionId, c.id), eq(poems.editorId, editorId)))
    .orderBy(asc(poems.collectionPosition));
  return { ...c, poems: list };
}

/** The editor's poems that aren't in any collection (to add from the collection page). */
export async function poemsWithoutCollection(editorId: string): Promise<{ id: string; title: string }[]> {
  return getDb()
    .select({ id: poems.id, title: poems.title })
    .from(poems)
    .where(and(eq(poems.editorId, editorId), isNull(poems.collectionId)))
    .orderBy(asc(sql`lower(${poems.title})`), asc(poems.id));
}

// ---- writes -------------------------------------------------------------------

async function uniqueCollectionSlug(tx: Tx, editorId: string, title: string) {
  const base = slugify(title, "collection");
  const taken = await tx
    .select({ slug: collections.slug })
    .from(collections)
    .where(
      and(
        eq(collections.editorId, editorId),
        or(eq(collections.slug, base), like(collections.slug, `${base}-%`)),
      ),
    );
  return firstFreeSlug(base, taken.map((t) => t.slug));
}

export async function createCollection(editorId: string, raw: unknown): Promise<CollectionResult> {
  const { data, errors } = parse(raw);
  if (errors) return { ok: false, errors };
  return getDb().transaction(async (tx): Promise<CollectionResult> => {
    // Locks the editor's collections list too: the limit and the slug are race-free.
    await lockEditor(tx, editorId);
    const [{ n }] = await tx.select({ n: count() }).from(collections).where(eq(collections.editorId, editorId));
    if (n >= COLLECTIONS_MAX) {
      return { ok: false, errors: { form: `You can have at most ${COLLECTIONS_MAX} collections` } };
    }
    const [c] = await tx
      .insert(collections)
      .values({
        editorId,
        title: data.title,
        intro: data.intro,
        slug: await uniqueCollectionSlug(tx, editorId, data.title),
      })
      .returning({ id: collections.id, slug: collections.slug });
    return { ok: true, collection: c };
  });
}

/** Rename and/or edit the intro. The slug never changes. */
export async function updateCollection(editorId: string, collectionId: string, raw: unknown): Promise<CollectionResult> {
  if (!isId(collectionId)) return { ok: false, notFound: true };
  const { data, errors } = parse(raw);
  if (errors) return { ok: false, errors };
  return getDb().transaction(async (tx): Promise<CollectionResult> => {
    await lockEditor(tx, editorId);
    if (!(await lockCollections(tx, editorId, [collectionId])).has(collectionId)) return { ok: false, notFound: true };
    const [c] = await tx
      .update(collections)
      .set({ title: data.title, intro: data.intro })
      .where(and(eq(collections.id, collectionId), eq(collections.editorId, editorId)))
      .returning({ id: collections.id, slug: collections.slug });
    return { ok: true, collection: c };
  });
}

/** Delete a collection; its poems stay and simply leave it. Returns the poems that left. */
export async function deleteCollection(editorId: string, collectionId: string): Promise<string[] | null> {
  if (!isId(collectionId)) return null;
  return getDb().transaction(async (tx) => {
    await lockEditor(tx, editorId);
    if (!(await lockCollections(tx, editorId, [collectionId])).has(collectionId)) return null;
    const left = await orderOf(tx, collectionId);
    await tx
      .update(poems)
      .set({ collectionId: null, collectionPosition: null })
      .where(eq(poems.collectionId, collectionId));
    await tx.delete(collections).where(and(eq(collections.id, collectionId), eq(collections.editorId, editorId)));
    return left;
  });
}

export type MoveResult =
  | { ok: true; position: number; total: number; title: string }
  | { ok: false; notFound: true };

/**
 * Move one of the collection's poems one place up or down (or to the start or
 * end). Relative moves, not a whole new order from the client, so a stale
 * page can't undo someone else's change.
 */
export async function moveCollectionPoem(
  editorId: string,
  collectionId: string,
  poemId: string,
  direction: "up" | "down" | "first" | "last",
): Promise<MoveResult> {
  if (!isId(collectionId) || !isId(poemId)) return { ok: false, notFound: true };
  return getDb().transaction(async (tx): Promise<MoveResult> => {
    await lockEditor(tx, editorId);
    if (!(await lockCollections(tx, editorId, [collectionId])).has(collectionId)) return { ok: false, notFound: true };
    const moved = await moveItem(tx, POSITIONS, collectionId, poemId, direction);
    if (!moved) return { ok: false, notFound: true };
    if (moved.changed) await touch(tx, collectionId);
    const [p] = await tx.select({ title: poems.title }).from(poems).where(eq(poems.id, poemId));
    return { ok: true, position: moved.position, total: moved.total, title: p.title };
  });
}

export type ReorderResult = { ok: true } | { ok: false; notFound: true } | { ok: false; stale: true };

/**
 * Save a whole new order (drag and drop). `ids` must be exactly the
 * collection's current poems, checked under the lock: if someone added,
 * removed or moved a poem meanwhile, nothing changes and the page reloads.
 */
export async function reorderCollection(editorId: string, collectionId: string, ids: unknown): Promise<ReorderResult> {
  if (!isId(collectionId) || !Array.isArray(ids) || !ids.every(isId) || new Set(ids).size !== ids.length) {
    return { ok: false, notFound: true };
  }
  return getDb().transaction(async (tx): Promise<ReorderResult> => {
    await lockEditor(tx, editorId);
    if (!(await lockCollections(tx, editorId, [collectionId])).has(collectionId)) return { ok: false, notFound: true };
    const result = await reorderItems(tx, POSITIONS, collectionId, ids);
    if (result === "stale") return { ok: false, stale: true };
    if (result === "changed") await touch(tx, collectionId);
    return { ok: true };
  });
}

export type PlaceResult = { ok: true; from: string | null } | { ok: false; notFound: true } | { ok: false; error: string };

/**
 * Put one of the editor's poems into one of their collections (at the end),
 * or take it out with null. A poem is in at most one collection, so adding it
 * to another moves it.
 */
export async function setPoemCollection(
  editorId: string,
  poemId: string,
  collectionId: string | null,
): Promise<PlaceResult> {
  if (!isId(poemId) || (collectionId !== null && !isId(collectionId))) return { ok: false, notFound: true };
  return getDb().transaction(async (tx): Promise<PlaceResult> => {
    await lockEditor(tx, editorId);
    // Stable under the editor lock: only this editor's writes move their poems.
    const [current] = await tx
      .select({ collectionId: poems.collectionId })
      .from(poems)
      .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)));
    if (!current) return { ok: false, notFound: true };
    const locked = await lockCollections(tx, editorId, [current.collectionId, collectionId]);
    if (collectionId && !locked.has(collectionId)) return { ok: false, notFound: true };
    await tx.select({ id: poems.id }).from(poems).where(eq(poems.id, poemId)).for("update");
    const error = await placePoem(tx, poemId, current.collectionId, collectionId);
    return error ? { ok: false, error } : { ok: true, from: current.collectionId };
  });
}
