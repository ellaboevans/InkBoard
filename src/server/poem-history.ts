import "server-only";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { poemRevisions, poems } from "@/db/schema";
import type { PoemLanguage } from "@/lib/poem-languages";

/*
 * Revision history (docs/PLAN.md, Phase 13). Editor-only, like poems.ts:
 * reads take the DAL-resolved editor id and reach revisions only through the
 * editor's own poems, so another editor's poem or revision id looks missing,
 * and malformed ids are rejected before SQL. Nothing here is ever read for
 * readers (board, feeds, search, share cards): a test checks that only this
 * module and poems.ts touch the table.
 *
 * Writes happen only inside poems.ts' save transactions, after the
 * editor → poem row locks, so one editor's saves (and their pruning) run one
 * at a time.
 */

/** Versions kept per poem, the current one included. */
export const REVISIONS_KEPT = 20;

const idSchema = z.uuid();

export type PoemContent = { title: string; body: string; language: string | null };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export const sameContent = (a: PoemContent, b: PoemContent) =>
  a.title === b.title && a.body === b.body && (a.language ?? null) === (b.language ?? null);

/**
 * Record `content` as the newest version and prune to REVISIONS_KEPT.
 * `previous` (with its last save time) is recorded first if the poem has no
 * history yet: poems from before history existed, or inserted by the seed,
 * would otherwise lose the state their first edit replaced.
 */
export async function recordRevision(
  tx: Tx,
  poemId: string,
  content: PoemContent,
  previous?: PoemContent & { savedAt: Date },
) {
  if (previous) {
    const [any] = await tx
      .select({ id: poemRevisions.id })
      .from(poemRevisions)
      .where(eq(poemRevisions.poemId, poemId))
      .limit(1);
    if (!any) {
      await tx.insert(poemRevisions).values({
        poemId,
        title: previous.title,
        body: previous.body,
        language: previous.language,
        savedAt: previous.savedAt,
      });
    }
  }
  await tx.insert(poemRevisions).values({ poemId, ...content });

  const keep = tx
    .select({ id: poemRevisions.id })
    .from(poemRevisions)
    .where(eq(poemRevisions.poemId, poemId))
    .orderBy(desc(poemRevisions.savedAt), desc(poemRevisions.id))
    .limit(REVISIONS_KEPT);
  await tx
    .delete(poemRevisions)
    .where(and(eq(poemRevisions.poemId, poemId), notInArray(poemRevisions.id, keep)));
}

export type PoemRevisionSummary = {
  id: string;
  savedAt: Date;
  title: string;
  /** First non-blank line of the text, cut to PREVIEW_CHARS (in SQL). */
  preview: string;
  language: PoemLanguage | null;
};

export type PoemRevision = PoemRevisionSummary & { body: string };

export const PREVIEW_CHARS = 80;

/** Only the editor's own poem's revisions, newest first. */
const ownRevisions = (editorId: string, poemId: string) =>
  and(eq(poemRevisions.poemId, poemId), eq(poems.editorId, editorId));

const summaryColumns = {
  id: poemRevisions.id,
  savedAt: poemRevisions.savedAt,
  title: poemRevisions.title,
  // Leading blank lines are already stripped on save (normalizePoemBody).
  preview: sql<string>`left(split_part(${poemRevisions.body}, E'\\n', 1), ${PREVIEW_CHARS})`,
  language: sql<PoemLanguage | null>`${poemRevisions.language}`,
};

/**
 * A poem's versions, newest first (the first one is the current text); [] for
 * missing or foreign poems. Bodies are included for the server to summarise
 * (at most REVISIONS_KEPT); pages pass only previews on to the browser.
 */
export async function listPoemRevisions(editorId: string, poemId: string): Promise<PoemRevision[]> {
  if (!idSchema.safeParse(poemId).success) return [];
  return getDb()
    .select({ ...summaryColumns, body: poemRevisions.body })
    .from(poemRevisions)
    .innerJoin(poems, eq(poems.id, poemRevisions.poemId))
    .where(ownRevisions(editorId, poemId))
    .orderBy(desc(poemRevisions.savedAt), desc(poemRevisions.id));
}

/** One version of the editor's own poem, or null (missing, foreign, malformed). */
export async function getPoemRevision(
  editorId: string,
  poemId: string,
  revisionId: string,
): Promise<PoemRevision | null> {
  if (!idSchema.safeParse(poemId).success || !idSchema.safeParse(revisionId).success) return null;
  const [row] = await getDb()
    .select({ ...summaryColumns, body: poemRevisions.body })
    .from(poemRevisions)
    .innerJoin(poems, eq(poems.id, poemRevisions.poemId))
    .where(and(eq(poemRevisions.id, revisionId), ownRevisions(editorId, poemId)))
    .limit(1);
  return row ?? null;
}
