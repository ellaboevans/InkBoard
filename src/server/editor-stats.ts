import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { poems } from "@/db/schema";

export type EditorStats = {
  total: number;
  published: number;
  drafts: number;
  /** Published poems behind a password (what readers see locked on the board). */
  privatePublished: number;
  firstPublishedAt: Date | null;
  lastPublishedAt: Date | null;
};

/** Counts for the dashboard and profile, scoped to one editor. */
export async function getEditorStats(editorId: string): Promise<EditorStats> {
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) FILTER (WHERE ${poems.status} = 'published')::int`,
      drafts: sql<number>`count(*) FILTER (WHERE ${poems.status} = 'draft')::int`,
      privatePublished: sql<number>`count(*) FILTER (WHERE ${poems.status} = 'published' AND ${poems.visibility} = 'private')::int`,
      firstPublishedAt: sql<Date | null>`min(${poems.publishedAt})`,
      lastPublishedAt: sql<Date | null>`max(${poems.publishedAt})`,
    })
    .from(poems)
    .where(eq(poems.editorId, editorId));
  const date = (v: Date | string | null) => (v == null ? null : new Date(v));
  return {
    total: Number(row.total),
    published: Number(row.published),
    drafts: Number(row.drafts),
    privatePublished: Number(row.privatePublished),
    firstPublishedAt: date(row.firstPublishedAt),
    lastPublishedAt: date(row.lastPublishedAt),
  };
}
