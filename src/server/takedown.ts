import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { readerPathFromPathname } from "@/lib/reader-paths";
import { parseShortCode } from "@/lib/share-image/short-code";
import { chapterReleased } from "./chapter-release";

/*
 * The owner's takedown (docs/PLAN.md, Phase 32 round 2): hide a reported
 * poem, novel (with every chapter) or author (everything of theirs, and their
 * page) from every reader, and restore it. Framework-free like otp.ts: the
 * route (src/server/takedown-route.ts) authorises, refreshes the caches and
 * emails the writer.
 *
 * Hiding sets `hidden_at`; nothing is deleted, and restoring clears it, so the
 * work comes back exactly as it was. Readers' queries apply the helpers in
 * shown.ts; the writer's own screens, export and deletion ignore the flag.
 *
 * These lookups are the owner's, so they deliberately see hidden rows (a
 * restore has to find what it hid). Never use them for readers.
 */

/** A link as the report email shows it: a reader page, or a short link. */
export type TakedownLink =
  | { kind: "poem"; author: string; poem: string }
  | { kind: "novel"; author: string; novel: string }
  | { kind: "chapter"; author: string; novel: string; chapter: string }
  | { kind: "author"; author: string }
  | { kind: "short"; code: string };

/**
 * Read the owner's link: a path or a whole URL ("https://…/p/ama/dusk"), with
 * any query or fragment ignored. Null for anything else, a collection page
 * included (hide its poems, or the author).
 */
export function parseTakedownLink(raw: unknown): TakedownLink | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 600) return null;
  let pathname: string;
  try {
    pathname = new URL(text, "https://inkboard.invalid").pathname;
  } catch {
    return null;
  }
  const short = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (short) {
    const code = parseShortCode(short[1]);
    return code ? { kind: "short", code } : null;
  }
  const path = readerPathFromPathname(pathname);
  if (!path || path.kind === "collection") return null;
  return path;
}

/** What a takedown acts on: one row of poems, novels or editors. */
export type TakedownTarget = {
  kind: "poem" | "novel" | "author";
  id: string;
  editorId: string;
  /** The poem's or novel's title; the pen name for an author. */
  title: string;
  penName: string;
  /** Its reader path, as the report email shows it. */
  path: string;
  hidden: boolean;
  /** The writer's address, for their notice only: never in a response or a log. */
  email: string;
  /** A chapter link hides its novel: the chapter it named. */
  viaChapter?: { title: string; slug: string };
};

type Row = { id: string; editor_id: string; title: string; pen_name: string; author_slug: string; slug: string; hidden: boolean; email: string };
const rows = async (q: ReturnType<typeof sql>) => ((await getDb().execute(q)) as unknown as { rows: Row[] }).rows;

async function findPoem(where: ReturnType<typeof sql>): Promise<TakedownTarget | null> {
  const [r] = await rows(sql`
    SELECT p.id, p.editor_id, p.title, e.pen_name, e.slug AS author_slug, p.slug, p.hidden_at IS NOT NULL AS hidden, e.email
    FROM poems p JOIN editors e ON e.id = p.editor_id
    WHERE e.pen_name IS NOT NULL AND ${where}
    LIMIT 1`);
  return r ? { kind: "poem", id: r.id, editorId: r.editor_id, title: r.title, penName: r.pen_name, path: `/p/${r.author_slug}/${r.slug}`, hidden: r.hidden, email: r.email } : null;
}

async function findNovel(where: ReturnType<typeof sql>): Promise<TakedownTarget | null> {
  const [r] = await rows(sql`
    SELECT n.id, n.editor_id, n.title, e.pen_name, e.slug AS author_slug, n.slug, n.hidden_at IS NOT NULL AS hidden, e.email
    FROM novels n JOIN editors e ON e.id = n.editor_id
    WHERE e.pen_name IS NOT NULL AND ${where}
    LIMIT 1`);
  return r ? { kind: "novel", id: r.id, editorId: r.editor_id, title: r.title, penName: r.pen_name, path: `/a/${r.author_slug}/n/${r.slug}`, hidden: r.hidden, email: r.email } : null;
}

/** The chapter a link names (its novel's id, title and slug), or null. */
async function findChapter(where: ReturnType<typeof sql>) {
  const r = (await getDb().execute(sql`
    SELECT c.novel_id, c.title, c.slug FROM chapters c JOIN novels n ON n.id = c.novel_id JOIN editors e ON e.id = n.editor_id
    WHERE ${where} LIMIT 1`)) as unknown as { rows: { novel_id: string; title: string; slug: string }[] };
  return r.rows[0] ?? null;
}

/** What the link names, hidden or not; null when nothing's there (unknown, deleted, not onboarded). */
export async function findTakedownTarget(link: TakedownLink): Promise<TakedownTarget | null> {
  if (link.kind === "author") {
    const [r] = await rows(sql`
      SELECT e.id, e.id AS editor_id, e.pen_name AS title, e.pen_name, e.slug AS author_slug, e.slug, e.hidden_at IS NOT NULL AS hidden, e.email
      FROM editors e WHERE e.slug = ${link.author} AND e.pen_name IS NOT NULL LIMIT 1`);
    return r ? { kind: "author", id: r.id, editorId: r.id, title: r.pen_name, penName: r.pen_name, path: `/a/${r.slug}`, hidden: r.hidden, email: r.email } : null;
  }
  if (link.kind === "poem") return findPoem(sql`e.slug = ${link.author} AND p.slug = ${link.poem}`);
  if (link.kind === "novel") return findNovel(sql`e.slug = ${link.author} AND n.slug = ${link.novel}`);
  if (link.kind === "chapter") {
    const c = await findChapter(sql`e.slug = ${link.author} AND n.slug = ${link.novel} AND c.slug = ${link.chapter}`);
    if (!c) return null;
    const novel = await findNovel(sql`n.id = ${c.novel_id}`);
    return novel && { ...novel, viaChapter: { title: c.title, slug: c.slug } };
  }
  // A short link points at a poem or a chapter (shown or not: the owner sees both).
  const s = (await getDb().execute(sql`SELECT poem_id, chapter_id FROM short_links WHERE code = ${link.code} LIMIT 1`)) as unknown as {
    rows: { poem_id: string | null; chapter_id: string | null }[];
  };
  const hit = s.rows[0];
  if (!hit) return null;
  if (hit.poem_id) return findPoem(sql`p.id = ${hit.poem_id}`);
  const c = hit.chapter_id ? await findChapter(sql`c.id = ${hit.chapter_id}`) : null;
  if (!c) return null;
  const novel = await findNovel(sql`n.id = ${c.novel_id}`);
  return novel && { ...novel, viaChapter: { title: c.title, slug: c.slug } };
}

const TABLE = { poem: sql.raw("poems"), novel: sql.raw("novels"), author: sql.raw("editors") } as const;

/**
 * Hide or restore the target. `changed` is false when it already was so
 * (hiding something hidden, restoring something shown): nothing is written.
 * Lock order as everywhere: the editor row, then novel rows, then poems.
 *
 * Restoring a novel or an author settles the "new chapter" notifications of
 * chapters released while hidden (never to be sent, like updateNovel's
 * visibility rule): hidden work is never announced, then or later.
 */
export async function applyTakedown(target: TakedownTarget, action: "hide" | "restore"): Promise<{ changed: boolean; at: Date }> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM editors WHERE id = ${target.editorId} FOR NO KEY UPDATE`);
    const novelIds =
      target.kind === "novel"
        ? [target.id]
        : target.kind === "author"
          ? ((await tx.execute(sql`SELECT id FROM novels WHERE editor_id = ${target.editorId} ORDER BY id FOR NO KEY UPDATE`)) as unknown as { rows: { id: string }[] }).rows.map((r) => r.id)
          : [];
    if (target.kind === "novel") await tx.execute(sql`SELECT 1 FROM novels WHERE id = ${target.id} FOR NO KEY UPDATE`);
    const set = action === "hide" ? sql`now()` : sql`NULL`;
    const was = action === "hide" ? sql`hidden_at IS NULL` : sql`hidden_at IS NOT NULL`;
    const r = (await tx.execute(sql`
      UPDATE ${TABLE[target.kind]} SET hidden_at = ${set} WHERE id = ${target.id} AND ${was} RETURNING now() AS at
    `)) as unknown as { rows: { at: Date }[] };
    const changed = r.rows.length > 0;
    if (changed && action === "restore" && novelIds.length > 0) {
      await tx.execute(sql`
        UPDATE chapters c SET notified_at = '-infinity'::timestamptz
        WHERE c.novel_id IN (${sql.join(novelIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND c.notified_at IS NULL AND ${chapterReleased("c")}
      `);
    }
    const at = r.rows[0]?.at ?? (((await tx.execute(sql`SELECT now() AS at`)) as unknown as { rows: { at: Date }[] }).rows[0].at);
    return { changed, at: new Date(at) };
  });
}

/** Is any of this writer's work hidden? For their dashboard (scoped by the DAL editor id). */
export type HiddenState = { account: boolean; poems: number; novels: number };

export async function hiddenStateFor(editorId: string): Promise<HiddenState> {
  const r = (await getDb().execute(sql`
    SELECT (SELECT hidden_at IS NOT NULL FROM editors WHERE id = ${editorId}) AS account,
           (SELECT count(*)::int FROM poems WHERE editor_id = ${editorId} AND hidden_at IS NOT NULL) AS poems,
           (SELECT count(*)::int FROM novels WHERE editor_id = ${editorId} AND hidden_at IS NOT NULL) AS novels
  `)) as unknown as { rows: { account: boolean | null; poems: number; novels: number }[] };
  const row = r.rows[0];
  return { account: Boolean(row?.account), poems: Number(row?.poems ?? 0), novels: Number(row?.novels ?? 0) };
}
