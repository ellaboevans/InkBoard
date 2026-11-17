import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { chapterRevisions, chapters, editors, novels } from "@/db/schema";
import { toNfc } from "@/lib/letters";
import {
  BLURB_MAX,
  CHAPTER_BODY_MAX,
  CHAPTER_REVISIONS_KEPT,
  CHAPTER_TITLE_MAX,
  CHAPTERS_MAX,
  NOVEL_TITLE_MAX,
  NOVELS_MAX,
} from "@/lib/novel-limits";
import { POEM_LANGUAGE_CODES, type PoemLanguage } from "@/lib/poem-languages";
import { countWords, normalizeProse } from "@/lib/prose";
import { firstFreeSlug, isUniqueViolation, slugify } from "@/lib/slug";
import { compact, endPosition, moveItem, reorderItems, type Direction, type PositionSpec, type Tx } from "./positions";
import { recordVersion, type RevisionSpec } from "./revisions";

/*
 * Novels and their chapters, editor side (docs/PLAN.md, Phase 23a;
 * docs/research/novels.md). Framework-free like poems.ts:
 *
 * - Every function takes the DAL-resolved editor id and scopes every query by
 *   it; chapters are reached only through their novel's editor_id. Another
 *   editor's novel or chapter id behaves like a missing one, and malformed
 *   ids are rejected before SQL.
 * - Lock order (CLAUDE.md): the editor row (FOR NO KEY UPDATE, like poem
 *   saves) → the novel row (FOR NO KEY UPDATE) → chapter rows (FOR UPDATE).
 *   The editor lock queues one editor's writes, which also makes slug
 *   allocation, the limits and positions race-free.
 * - Slugs: a novel's is unique per editor and follows its title until any of
 *   its chapters has ever been published; a chapter's is unique per novel and
 *   follows its title until the chapter has ever been published. "Ever"
 *   because published_at is kept when a chapter is unpublished: links that
 *   went out keep working.
 * - Positions are 1..n over all the novel's chapters, drafts included,
 *   through src/server/positions.ts (shared with collections).
 * - A chapter save that changes its title or text records a version in
 *   chapter_revisions in the same transaction (src/server/revisions.ts),
 *   pruned to CHAPTER_REVISIONS_KEPT. Only this module reads that table.
 *
 * No reader queries here: those will live in board.ts with the same rules as
 * poems (published chapters only, numbered over published chapters).
 */

export { BLURB_MAX, CHAPTER_BODY_MAX, CHAPTER_REVISIONS_KEPT, CHAPTER_TITLE_MAX, CHAPTERS_MAX, NOVEL_TITLE_MAX, NOVELS_MAX };

const idSchema = z.uuid();
const isId = (id: unknown): id is string => idSchema.safeParse(id).success;

const CHAPTER_POSITIONS = {
  table: chapters,
  id: chapters.id,
  group: chapters.novelId,
  position: chapters.position,
} satisfies PositionSpec;

const CHAPTER_REVISIONS = {
  table: chapterRevisions,
  id: chapterRevisions.id,
  owner: chapterRevisions.chapterId,
  savedAt: chapterRevisions.savedAt,
} satisfies RevisionSpec;

// ---- validation ----------------------------------------------------------------

const novelSchema = z.object({
  title: z
    .string()
    .overwrite(toNfc)
    .trim()
    .min(1, "Give your novel a title")
    .max(NOVEL_TITLE_MAX, `Titles can be at most ${NOVEL_TITLE_MAX} characters`),
  blurb: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? "" : toNfc(s).replace(/\r\n?/g, "\n").trim()))
    .pipe(z.string().max(BLURB_MAX, `The blurb can be at most ${BLURB_MAX.toLocaleString("en")} characters`))
    .transform((s) => s || null),
  language: z
    .string()
    .optional()
    .transform((l) => (l ? l : null))
    .pipe(z.enum(POEM_LANGUAGE_CODES, "Choose a language from the list").nullable()),
  status: z.enum(["ongoing", "complete"], "Choose ongoing or complete").optional().default("ongoing"),
});

const chapterSchema = z.object({
  /** Optional: empty shows "Chapter n" to readers. */
  title: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? "" : toNfc(s).trim()))
    .pipe(z.string().max(CHAPTER_TITLE_MAX, `Titles can be at most ${CHAPTER_TITLE_MAX} characters`)),
  /** Prose (src/lib/prose.ts); may be empty while a draft. */
  body: z
    .string()
    .optional()
    .transform((s) => normalizeProse(s ?? ""))
    .pipe(
      z
        .string()
        .max(CHAPTER_BODY_MAX, `A chapter can be at most ${CHAPTER_BODY_MAX.toLocaleString("en")} characters`),
    ),
  /** Absent = keep the current status. */
  status: z.enum(["draft", "published"]).optional(),
});

export type NovelInput = z.input<typeof novelSchema>;
export type ChapterInput = z.input<typeof chapterSchema>;
export type NovelErrors = Partial<Record<keyof NovelInput | "form", string>>;
export type ChapterErrors = Partial<Record<keyof ChapterInput | "form", string>>;

function parseWith<S extends z.ZodType, E extends Record<string, string | undefined>>(schema: S, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data as z.output<S> } as const;
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = (issue.path[0] as string | undefined) ?? "form";
    errors[field] ??= issue.message;
  }
  return { errors: errors as E } as const;
}

const EMPTY_CHAPTER = "The chapter is empty: write something before publishing it";
const TOO_MANY_CHAPTERS = `A novel can have at most ${CHAPTERS_MAX} chapters`;

// ---- locks and slugs -------------------------------------------------------------

async function lockEditor(tx: Tx, editorId: string): Promise<boolean> {
  const [row] = await tx.select({ id: editors.id }).from(editors).where(eq(editors.id, editorId)).for("no key update");
  return Boolean(row);
}

/** The editor's own novel, locked (after the editor lock), or null. */
async function lockNovel(tx: Tx, editorId: string, novelId: string) {
  const [row] = await tx
    .select({ id: novels.id, title: novels.title, slug: novels.slug })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.editorId, editorId)))
    .for("no key update");
  return row ?? null;
}

/** The novel a chapter of the editor's belongs to (stable under the editor lock: chapters never change novels). */
async function novelOfChapter(tx: Tx, editorId: string, chapterId: string): Promise<string | null> {
  const [row] = await tx
    .select({ novelId: chapters.novelId })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapters.id, chapterId), eq(novels.editorId, editorId)));
  return row?.novelId ?? null;
}

async function uniqueNovelSlug(tx: Tx, editorId: string, title: string, exceptId?: string) {
  const base = slugify(title, "novel");
  const taken = await tx
    .select({ slug: novels.slug })
    .from(novels)
    .where(
      and(
        eq(novels.editorId, editorId),
        exceptId ? ne(novels.id, exceptId) : undefined,
        or(eq(novels.slug, base), like(novels.slug, `${base}-%`)),
      ),
    );
  return firstFreeSlug(base, taken.map((t) => t.slug));
}

async function uniqueChapterSlug(tx: Tx, novelId: string, title: string, exceptId?: string) {
  const base = slugify(title, "chapter");
  const taken = await tx
    .select({ slug: chapters.slug })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        exceptId ? ne(chapters.id, exceptId) : undefined,
        or(eq(chapters.slug, base), like(chapters.slug, `${base}-%`)),
      ),
    );
  return firstFreeSlug(base, taken.map((t) => t.slug));
}

/** Whether any of the novel's chapters was ever published (its slug is then fixed). */
async function everPublished(tx: Tx, novelId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), isNotNull(chapters.publishedAt)))
    .limit(1);
  return Boolean(row);
}

/**
 * Retry a write whose slug lost a race. The editor lock already serialises
 * one editor's writes; this covers anything that slips past it (as poems do).
 */
async function withSlugRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 3) continue;
      throw err;
    }
  }
}

const touchNovel = (tx: Tx, novelId: string) =>
  tx.update(novels).set({ updatedAt: sql`now()` }).where(eq(novels.id, novelId));

// ---- reads ---------------------------------------------------------------------

export type NovelSummary = {
  id: string;
  title: string;
  slug: string;
  status: "ongoing" | "complete";
  language: PoemLanguage | null;
  chapterCount: number;
  publishedCount: number;
  updatedAt: Date;
};

export type EditorChapterSummary = {
  id: string;
  title: string;
  slug: string;
  position: number;
  status: "draft" | "published";
  publishedAt: Date | null;
  wordCount: number;
  updatedAt: Date;
};

export type EditorNovel = Omit<NovelSummary, "chapterCount" | "publishedCount"> & {
  blurb: string | null;
  createdAt: Date;
  chapters: EditorChapterSummary[];
};

export type EditorChapter = EditorChapterSummary & { novelId: string; body: string; createdAt: Date };

const novelColumns = {
  id: novels.id,
  title: novels.title,
  slug: novels.slug,
  status: novels.status,
  language: sql<PoemLanguage | null>`${novels.language}`,
  updatedAt: novels.updatedAt,
};

const chapterSummaryColumns = {
  id: chapters.id,
  title: chapters.title,
  slug: chapters.slug,
  position: chapters.position,
  status: chapters.status,
  publishedAt: chapters.publishedAt,
  wordCount: chapters.wordCount,
  updatedAt: chapters.updatedAt,
};

/** The editor's novels, most recently changed first. */
export async function listNovels(editorId: string): Promise<NovelSummary[]> {
  return getDb()
    .select({
      ...novelColumns,
      chapterCount: sql<number>`count(${chapters.id})::int`,
      publishedCount: sql<number>`count(${chapters.id}) FILTER (WHERE ${chapters.status} = 'published')::int`,
    })
    .from(novels)
    .leftJoin(chapters, eq(chapters.novelId, novels.id))
    .where(eq(novels.editorId, editorId))
    .groupBy(novels.id)
    .orderBy(desc(novels.updatedAt), asc(novels.id));
}

/** One of the editor's novels with its chapters in order (no text), or null. */
export async function getNovel(editorId: string, novelId: string): Promise<EditorNovel | null> {
  if (!isId(novelId)) return null;
  const db = getDb();
  const [n] = await db
    .select({ ...novelColumns, blurb: novels.blurb, createdAt: novels.createdAt })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.editorId, editorId)))
    .limit(1);
  if (!n) return null;
  const list = await db
    .select(chapterSummaryColumns)
    .from(chapters)
    .where(eq(chapters.novelId, n.id))
    .orderBy(asc(chapters.position));
  return { ...n, chapters: list };
}

/** One chapter of one of the editor's novels, with its text, or null. */
export async function getChapter(editorId: string, chapterId: string): Promise<EditorChapter | null> {
  if (!isId(chapterId)) return null;
  const [row] = await getDb()
    .select({ ...chapterSummaryColumns, novelId: chapters.novelId, body: chapters.body, createdAt: chapters.createdAt })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapters.id, chapterId), eq(novels.editorId, editorId)))
    .limit(1);
  return row ?? null;
}

// ---- novel writes ------------------------------------------------------------------

export type NovelResult =
  | { ok: true; novel: { id: string; slug: string } }
  | { ok: false; errors: NovelErrors }
  | { ok: false; notFound: true };

export async function createNovel(editorId: string, raw: unknown): Promise<NovelResult> {
  const { data, errors } = parseWith<typeof novelSchema, NovelErrors>(novelSchema, raw);
  if (errors) return { ok: false, errors };
  return withSlugRetry(() =>
    getDb().transaction(async (tx): Promise<NovelResult> => {
      if (!(await lockEditor(tx, editorId))) return { ok: false, notFound: true };
      const [{ n }] = await tx.select({ n: count() }).from(novels).where(eq(novels.editorId, editorId));
      if (n >= NOVELS_MAX) return { ok: false, errors: { form: `You can have at most ${NOVELS_MAX} novels` } };
      const [novel] = await tx
        .insert(novels)
        .values({
          editorId,
          title: data.title,
          slug: await uniqueNovelSlug(tx, editorId, data.title),
          blurb: data.blurb,
          language: data.language,
          status: data.status,
        })
        .returning({ id: novels.id, slug: novels.slug });
      return { ok: true, novel };
    }),
  );
}

/** Title, blurb, language and status. The slug follows the title until a chapter has been published. */
export async function updateNovel(editorId: string, novelId: string, raw: unknown): Promise<NovelResult> {
  if (!isId(novelId)) return { ok: false, notFound: true };
  const { data, errors } = parseWith<typeof novelSchema, NovelErrors>(novelSchema, raw);
  if (errors) return { ok: false, errors };
  return withSlugRetry(() =>
    getDb().transaction(async (tx): Promise<NovelResult> => {
      await lockEditor(tx, editorId);
      const current = await lockNovel(tx, editorId, novelId);
      if (!current) return { ok: false, notFound: true };
      const followTitle = data.title !== current.title && !(await everPublished(tx, novelId));
      const [novel] = await tx
        .update(novels)
        .set({
          title: data.title,
          blurb: data.blurb,
          language: data.language,
          status: data.status,
          ...(followTitle && { slug: await uniqueNovelSlug(tx, editorId, data.title, novelId) }),
        })
        .where(and(eq(novels.id, novelId), eq(novels.editorId, editorId)))
        .returning({ id: novels.id, slug: novels.slug });
      return { ok: true, novel };
    }),
  );
}

/** Delete a novel with all its chapters and their versions (ON DELETE CASCADE). */
export async function deleteNovel(editorId: string, novelId: string): Promise<boolean> {
  if (!isId(novelId)) return false;
  return getDb().transaction(async (tx) => {
    await lockEditor(tx, editorId);
    if (!(await lockNovel(tx, editorId, novelId))) return false;
    const rows = await tx
      .delete(novels)
      .where(and(eq(novels.id, novelId), eq(novels.editorId, editorId)))
      .returning({ id: novels.id });
    return rows.length > 0;
  });
}

// ---- chapter writes ------------------------------------------------------------------

export type ChapterResult =
  | {
      ok: true;
      chapter: { id: string; slug: string; position: number; status: "draft" | "published" };
      /** This save published the chapter for the first time ever (for the coming "new chapter" notice). */
      publishedNow: boolean;
    }
  | { ok: false; errors: ChapterErrors }
  | { ok: false; notFound: true };

const chapterReturn = {
  id: chapters.id,
  slug: chapters.slug,
  position: chapters.position,
  status: chapters.status,
};

/** A new chapter at the end of the novel (a draft unless `status: "published"`). */
export async function createChapter(editorId: string, novelId: string, raw: unknown): Promise<ChapterResult> {
  if (!isId(novelId)) return { ok: false, notFound: true };
  const { data, errors } = parseWith<typeof chapterSchema, ChapterErrors>(chapterSchema, raw);
  if (errors) return { ok: false, errors };
  const status = data.status ?? "draft";
  if (status === "published" && data.body === "") return { ok: false, errors: { body: EMPTY_CHAPTER } };
  return withSlugRetry(() =>
    getDb().transaction(async (tx): Promise<ChapterResult> => {
      await lockEditor(tx, editorId);
      if (!(await lockNovel(tx, editorId, novelId))) return { ok: false, notFound: true };
      const [{ n }] = await tx.select({ n: count() }).from(chapters).where(eq(chapters.novelId, novelId));
      if (n >= CHAPTERS_MAX) return { ok: false, errors: { form: TOO_MANY_CHAPTERS } };
      const [chapter] = await tx
        .insert(chapters)
        .values({
          novelId,
          title: data.title,
          slug: await uniqueChapterSlug(tx, novelId, data.title),
          body: data.body,
          position: endPosition(CHAPTER_POSITIONS, novelId),
          status,
          publishedAt: status === "published" ? sql`now()` : null,
          wordCount: countWords(data.body),
        })
        .returning(chapterReturn);
      // Version 1 of its history (an empty new draft has nothing worth keeping yet).
      if (data.title !== "" || data.body !== "") {
        await recordVersion(tx, CHAPTER_REVISIONS, chapter.id, { chapterId: chapter.id, title: data.title, body: data.body }, CHAPTER_REVISIONS_KEPT);
      }
      await touchNovel(tx, novelId);
      return { ok: true, chapter, publishedNow: status === "published" };
    }),
  );
}

/**
 * Save a chapter's title and text, and its status if given. A new version is
 * recorded only when the title or text changed; the slug follows the title
 * until the chapter has ever been published. Publishing needs some text.
 */
export async function saveChapter(editorId: string, chapterId: string, raw: unknown): Promise<ChapterResult> {
  if (!isId(chapterId)) return { ok: false, notFound: true };
  const { data, errors } = parseWith<typeof chapterSchema, ChapterErrors>(chapterSchema, raw);
  if (errors) return { ok: false, errors };
  return withSlugRetry(() =>
    getDb().transaction(async (tx): Promise<ChapterResult> => {
      await lockEditor(tx, editorId);
      const novelId = await novelOfChapter(tx, editorId, chapterId);
      if (!novelId || !(await lockNovel(tx, editorId, novelId))) return { ok: false, notFound: true };
      const [current] = await tx
        .select({
          title: chapters.title,
          body: chapters.body,
          status: chapters.status,
          publishedAt: chapters.publishedAt,
          updatedAt: chapters.updatedAt,
        })
        .from(chapters)
        .where(eq(chapters.id, chapterId))
        .for("update");
      if (!current) return { ok: false, notFound: true };
      const status = data.status ?? current.status;
      if (status === "published" && data.body === "") return { ok: false, errors: { body: EMPTY_CHAPTER } };

      const retitledDraft = !current.publishedAt && data.title !== current.title;
      const [chapter] = await tx
        .update(chapters)
        .set({
          title: data.title,
          body: data.body,
          status,
          wordCount: countWords(data.body),
          ...(retitledDraft && { slug: await uniqueChapterSlug(tx, novelId, data.title, chapterId) }),
          ...(status === "published" && { publishedAt: sql`COALESCE(${chapters.publishedAt}, now())` }),
        })
        .where(eq(chapters.id, chapterId))
        .returning(chapterReturn);

      if (data.title !== current.title || data.body !== current.body) {
        const row = (c: { title: string; body: string }) => ({ chapterId, title: c.title, body: c.body });
        await recordVersion(tx, CHAPTER_REVISIONS, chapterId, row(data), CHAPTER_REVISIONS_KEPT, {
          ...row(current),
          savedAt: current.updatedAt,
        });
      }
      await touchNovel(tx, novelId);
      return { ok: true, chapter, publishedNow: status === "published" && !current.publishedAt };
    }),
  );
}

/** Change only the status (no version is recorded: the title and text don't change). */
async function setChapterStatus(editorId: string, chapterId: string, status: "draft" | "published"): Promise<ChapterResult> {
  if (!isId(chapterId)) return { ok: false, notFound: true };
  return getDb().transaction(async (tx): Promise<ChapterResult> => {
    await lockEditor(tx, editorId);
    const novelId = await novelOfChapter(tx, editorId, chapterId);
    if (!novelId || !(await lockNovel(tx, editorId, novelId))) return { ok: false, notFound: true };
    const [row] = await tx
      .select({ body: chapters.body, publishedAt: chapters.publishedAt })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .for("update");
    if (!row) return { ok: false, notFound: true };
    if (status === "published" && row.body === "") return { ok: false, errors: { body: EMPTY_CHAPTER } };
    const [chapter] = await tx
      .update(chapters)
      .set({ status, ...(status === "published" && { publishedAt: sql`COALESCE(${chapters.publishedAt}, now())` }) })
      .where(eq(chapters.id, chapterId))
      .returning(chapterReturn);
    await touchNovel(tx, novelId);
    return { ok: true, chapter, publishedNow: status === "published" && !row.publishedAt };
  });
}

export const publishChapter = (editorId: string, chapterId: string) => setChapterStatus(editorId, chapterId, "published");
export const unpublishChapter = (editorId: string, chapterId: string) => setChapterStatus(editorId, chapterId, "draft");

/** Delete a chapter; the rest close up (positions stay 1..n). */
export async function deleteChapter(editorId: string, chapterId: string): Promise<boolean> {
  if (!isId(chapterId)) return false;
  return getDb().transaction(async (tx) => {
    await lockEditor(tx, editorId);
    const novelId = await novelOfChapter(tx, editorId, chapterId);
    if (!novelId || !(await lockNovel(tx, editorId, novelId))) return false;
    const rows = await tx.delete(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId))).returning({ id: chapters.id });
    if (rows.length === 0) return false;
    await compact(tx, CHAPTER_POSITIONS, novelId);
    await touchNovel(tx, novelId);
    return true;
  });
}

export type MoveChapterResult = { ok: true; position: number; total: number } | { ok: false; notFound: true };

/** Move one chapter up, down, first or last (relative, so a stale page can't undo a newer order). */
export async function moveChapter(
  editorId: string,
  novelId: string,
  chapterId: string,
  direction: Direction,
): Promise<MoveChapterResult> {
  if (!isId(novelId) || !isId(chapterId) || !["up", "down", "first", "last"].includes(direction)) {
    return { ok: false, notFound: true };
  }
  return getDb().transaction(async (tx): Promise<MoveChapterResult> => {
    await lockEditor(tx, editorId);
    if (!(await lockNovel(tx, editorId, novelId))) return { ok: false, notFound: true };
    const moved = await moveItem(tx, CHAPTER_POSITIONS, novelId, chapterId, direction);
    if (!moved) return { ok: false, notFound: true };
    if (moved.changed) await touchNovel(tx, novelId);
    return { ok: true, position: moved.position, total: moved.total };
  });
}

export type ReorderChaptersResult = { ok: true } | { ok: false; notFound: true } | { ok: false; stale: true };

/** A whole new order (drag and drop): exactly the novel's current chapters, checked under the lock. */
export async function reorderChapters(editorId: string, novelId: string, ids: unknown): Promise<ReorderChaptersResult> {
  if (!isId(novelId) || !Array.isArray(ids) || !ids.every(isId) || new Set(ids).size !== ids.length) {
    return { ok: false, notFound: true };
  }
  return getDb().transaction(async (tx): Promise<ReorderChaptersResult> => {
    await lockEditor(tx, editorId);
    if (!(await lockNovel(tx, editorId, novelId))) return { ok: false, notFound: true };
    const result = await reorderItems(tx, CHAPTER_POSITIONS, novelId, ids);
    if (result === "stale") return { ok: false, stale: true };
    if (result === "changed") await touchNovel(tx, novelId);
    return { ok: true };
  });
}

// ---- revisions -------------------------------------------------------------------

export type ChapterRevision = { id: string; savedAt: Date; title: string; body: string };

/** A chapter's versions, newest first (the first is the current text); [] for missing or foreign chapters. */
export async function listChapterRevisions(editorId: string, chapterId: string): Promise<ChapterRevision[]> {
  if (!isId(chapterId)) return [];
  return getDb()
    .select({ id: chapterRevisions.id, savedAt: chapterRevisions.savedAt, title: chapterRevisions.title, body: chapterRevisions.body })
    .from(chapterRevisions)
    .innerJoin(chapters, eq(chapters.id, chapterRevisions.chapterId))
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapterRevisions.chapterId, chapterId), eq(novels.editorId, editorId)))
    .orderBy(desc(chapterRevisions.savedAt), desc(chapterRevisions.id));
}

/** One version of one of the editor's chapters, or null (missing, foreign, malformed, or another chapter's). */
export async function getChapterRevision(editorId: string, chapterId: string, revisionId: string): Promise<ChapterRevision | null> {
  if (!isId(chapterId) || !isId(revisionId)) return null;
  const [row] = await getDb()
    .select({ id: chapterRevisions.id, savedAt: chapterRevisions.savedAt, title: chapterRevisions.title, body: chapterRevisions.body })
    .from(chapterRevisions)
    .innerJoin(chapters, eq(chapters.id, chapterRevisions.chapterId))
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapterRevisions.id, revisionId), eq(chapterRevisions.chapterId, chapterId), eq(novels.editorId, editorId)))
    .limit(1);
  return row ?? null;
}

// ---- export ----------------------------------------------------------------------

export type NovelForExport = {
  id: string;
  title: string;
  slug: string;
  blurb: string | null;
  language: string | null;
  status: "ongoing" | "complete";
  createdAt: Date;
  updatedAt: Date;
  chapters: {
    id: string;
    title: string;
    slug: string;
    position: number;
    status: "draft" | "published";
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    wordCount: number;
    body: string;
    revisions: { savedAt: Date; title: string; body: string }[];
  }[];
};

/**
 * Every novel of the editor's, oldest first, with every chapter in order
 * (drafts included, with their text) and its saved versions oldest first,
 * for the editor's own download (src/server/export.ts). Scoped like every
 * other read here; never for readers.
 */
export async function novelsForExport(editorId: string): Promise<NovelForExport[]> {
  const db = getDb();
  const list = await db
    .select({
      id: novels.id,
      title: novels.title,
      slug: novels.slug,
      blurb: novels.blurb,
      language: novels.language,
      status: novels.status,
      createdAt: novels.createdAt,
      updatedAt: novels.updatedAt,
    })
    .from(novels)
    .where(eq(novels.editorId, editorId))
    .orderBy(asc(novels.createdAt), asc(novels.id));
  if (list.length === 0) return [];
  const ids = list.map((n) => n.id);
  const [chapterRows, revisionRows] = await Promise.all([
    db
      .select({
        ...chapterSummaryColumns,
        novelId: chapters.novelId,
        createdAt: chapters.createdAt,
        body: chapters.body,
      })
      .from(chapters)
      .where(inArray(chapters.novelId, ids))
      .orderBy(asc(chapters.novelId), asc(chapters.position)),
    db
      .select({
        chapterId: chapterRevisions.chapterId,
        savedAt: chapterRevisions.savedAt,
        title: chapterRevisions.title,
        body: chapterRevisions.body,
      })
      .from(chapterRevisions)
      .innerJoin(chapters, eq(chapters.id, chapterRevisions.chapterId))
      .innerJoin(novels, eq(novels.id, chapters.novelId))
      .where(eq(novels.editorId, editorId))
      .orderBy(asc(chapterRevisions.chapterId), asc(chapterRevisions.savedAt), asc(chapterRevisions.id)),
  ]);
  return list.map((n) => ({
    ...n,
    chapters: chapterRows
      .filter((c) => c.novelId === n.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        position: c.position,
        status: c.status,
        publishedAt: c.publishedAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        wordCount: c.wordCount,
        body: c.body,
        revisions: revisionRows
          .filter((r) => r.chapterId === c.id)
          .map((r) => ({ savedAt: r.savedAt, title: r.title, body: r.body })),
      })),
  }));
}
