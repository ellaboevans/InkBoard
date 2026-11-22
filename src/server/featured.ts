import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chapterReleased } from "./chapter-release";
import { authorShown, novelShown, poemShown } from "./shown";
import { findTakedownTarget, parseTakedownLink } from "./takedown";

/*
 * Featured (docs/PLAN.md, Phase 33): the owner picks up to FEATURED_MAX
 * public poems and novels; new readers see them first (the reader loaders'
 * `featuredAt`, board.ts). Owner-only: the owner's page and its actions call
 * these after requireOwner(). Links read like the takedown's (a chapter means
 * its novel; /s/ codes too); authors can't be featured. Readers' rules decide
 * what may be featured: shown (poemShown / novelShown + a released chapter),
 * public, by an author who is shown.
 */

import { FEATURED_MAX } from "@/lib/featured";

export { FEATURED_MAX };

export type FeatureRefusal = "bad_link" | "author" | "not_found" | "not_shown" | "already" | "full";

export const FEATURE_REFUSAL_MESSAGE: Record<FeatureRefusal, string> = {
  bad_link: "That isn't a link to a poem or a novel. Paste the page's address, like /p/author/poem or /a/author/n/novel.",
  author: "Authors can't be featured, only their poems and novels.",
  not_found: "There's no poem or novel at that link.",
  not_shown: "Readers can't see that one: only public, published poems and public novels with a released chapter can be featured.",
  already: "That one is already featured.",
  full: `${FEATURED_MAX} works are featured already. Remove one first.`,
};

export type FeatureResult =
  | { ok: false; error: FeatureRefusal }
  | {
      ok: true;
      kind: "poem" | "novel";
      id: string;
      title: string;
      penName: string;
      path: string;
      /** The writer, for the first-feature email only: never in a response or a log. */
      email: string;
      /** True only the first time this work is ever featured (the email's claim). */
      firstTime: boolean;
    };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
const one = async <T,>(tx: Tx, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as { rows: T[] }).rows[0];

/** Feature what the link names, if readers can see it, it isn't featured and there's room. */
export async function featureWork(rawLink: unknown): Promise<FeatureResult> {
  const link = parseTakedownLink(rawLink);
  if (!link) return { ok: false, error: "bad_link" };
  if (link.kind === "author") return { ok: false, error: "author" };
  const target = await findTakedownTarget(link);
  if (!target) return { ok: false, error: "not_found" };
  if (target.kind === "author") return { ok: false, error: "author" };
  const kind = target.kind;

  return getDb().transaction(async (tx): Promise<FeatureResult> => {
    // One featuring at a time (two tabs): the cap is counted under this lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inkboard:featured'))`);
    const shown =
      kind === "poem"
        ? await one<{ featured: boolean }>(tx, sql`
            SELECT p.featured_at IS NOT NULL AS featured FROM poems p JOIN editors e ON e.id = p.editor_id
            WHERE p.id = ${target.id} AND ${poemShown("p")} AND p.visibility = 'public' AND ${authorShown("e")}`)
        : await one<{ featured: boolean }>(tx, sql`
            SELECT n.featured_at IS NOT NULL AS featured FROM novels n JOIN editors e ON e.id = n.editor_id
            WHERE n.id = ${target.id} AND ${novelShown("n")} AND n.visibility = 'public' AND ${authorShown("e")}
              AND EXISTS (SELECT 1 FROM chapters c WHERE c.novel_id = n.id AND ${chapterReleased("c")})`);
    if (!shown) return { ok: false, error: "not_shown" };
    if (shown.featured) return { ok: false, error: "already" };
    const count = await one<{ n: number }>(tx, sql`
      SELECT (SELECT count(*) FROM poems WHERE featured_at IS NOT NULL) + (SELECT count(*) FROM novels WHERE featured_at IS NOT NULL) AS n`);
    if (Number(count?.n ?? 0) >= FEATURED_MAX) return { ok: false, error: "full" };
    const table = sql.raw(kind === "poem" ? "poems" : "novels");
    await tx.execute(sql`UPDATE ${table} SET featured_at = now() WHERE id = ${target.id} AND featured_at IS NULL`);
    const claimed = (await tx.execute(sql`
      UPDATE ${table} SET featured_notice_at = now() WHERE id = ${target.id} AND featured_notice_at IS NULL RETURNING id
    `)) as unknown as { rows: unknown[] };
    return {
      ok: true,
      kind,
      id: target.id,
      title: target.title,
      penName: target.penName,
      path: target.path,
      email: target.email,
      firstTime: claimed.rows.length > 0,
    };
  });
}

/** Stop featuring it. False when it wasn't featured (or isn't there). */
export async function unfeatureWork(kind: unknown, id: unknown): Promise<boolean> {
  if ((kind !== "poem" && kind !== "novel") || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const table = sql.raw(kind === "poem" ? "poems" : "novels");
  const r = (await getDb().execute(sql`
    UPDATE ${table} SET featured_at = NULL WHERE id = ${id}::uuid AND featured_at IS NOT NULL RETURNING id
  `)) as unknown as { rows: unknown[] };
  return r.rows.length > 0;
}

export type FeaturedItem = {
  kind: "poem" | "novel";
  id: string;
  title: string;
  penName: string;
  path: string;
  featuredAt: Date;
  /** False while readers can't see it (hidden, private, unpublished, author hidden): it stays featured for the owner. */
  shown: boolean;
};

/** Everything featured, newest featured first, with whether readers see it now (the owner's tab). */
export async function loadFeaturedForOwner(): Promise<FeaturedItem[]> {
  const res = (await getDb().execute(sql`
    SELECT 'poem' AS kind, p.id::text AS id, p.title, e.pen_name AS "penName", '/p/' || e.slug || '/' || p.slug AS path,
           p.featured_at AS "featuredAt", (${poemShown("p")} AND p.visibility = 'public' AND ${authorShown("e")}) AS shown
      FROM poems p JOIN editors e ON e.id = p.editor_id WHERE p.featured_at IS NOT NULL
    UNION ALL
    SELECT 'novel', n.id::text, n.title, e.pen_name, '/a/' || e.slug || '/n/' || n.slug, n.featured_at,
           (${novelShown("n")} AND n.visibility = 'public' AND ${authorShown("e")}
             AND EXISTS (SELECT 1 FROM chapters c WHERE c.novel_id = n.id AND ${chapterReleased("c")}))
      FROM novels n JOIN editors e ON e.id = n.editor_id WHERE n.featured_at IS NOT NULL
    ORDER BY "featuredAt" DESC, id
  `)) as unknown as { rows: (Omit<FeaturedItem, "featuredAt"> & { featuredAt: Date | string })[] };
  return res.rows.map((r) => ({ ...r, penName: r.penName ?? "", shown: Boolean(r.shown), featuredAt: new Date(r.featuredAt) }));
}
