import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { editors, novels, poems } from "@/db/schema";

/*
 * "Can readers see this?" for poems, novels and authors (docs/PLAN.md,
 * Phase 32 round 2: the owner's takedown). The one definition every reader
 * query uses, enforced like chapterReleased() (chapter-release.ts):
 *
 *   poemShown()    published, and not hidden by the owner
 *   novelShown()   not hidden by the owner (it still needs a released chapter)
 *   authorShown()  onboarded (a pen name), and not hidden by the owner
 *
 * A hidden poem, novel or author is exactly a missing one to readers. Each
 * helper checks its own row only, so a reader query joins the author and
 * applies authorShown() too (a hidden author hides everything of theirs).
 *
 * Reader modules (board.ts, feeds.ts, search.ts, short-links.ts, unlock.ts,
 * push.ts' announcements, the photo and cover serving checks, reports.ts…)
 * must never test `poems.status = 'published'` or `pen_name IS NOT NULL`
 * themselves: tests/board/shown-helper.test.ts fails if they do, or if a
 * module that reads one of these tables doesn't use its helper.
 *
 * Hand-written SQL passes its alias: `poemShown("p")`. A Drizzle alias of
 * editors (short-links.ts) passes the aliased table: `authorShown(poemAuthor)`.
 */

const ALIAS = /^[a-z_]+$/;
function raw(alias: string, condition: string): SQL {
  if (!ALIAS.test(alias)) throw new Error(`Bad SQL alias ${alias}`);
  return sql.raw(condition.replaceAll("$", alias));
}

/** A poem readers can see: published and not hidden. */
export function poemShown(alias?: string): SQL {
  if (alias === undefined) return sql`(${poems.status} = 'published' AND ${poems.hiddenAt} IS NULL)`;
  return raw(alias, "($.status = 'published' AND $.hidden_at IS NULL)");
}

/** A novel readers can see (with a released chapter: chapterReleased()): not hidden. */
export function novelShown(alias?: string): SQL {
  if (alias === undefined) return sql`(${novels.hiddenAt} IS NULL)`;
  return raw(alias, "($.hidden_at IS NULL)");
}

/** An author readers can see: onboarded (a pen name) and not hidden. */
export function authorShown(table?: string | { penName: AnyPgColumn; hiddenAt: AnyPgColumn }): SQL {
  if (typeof table === "string") return raw(table, "($.pen_name IS NOT NULL AND $.hidden_at IS NULL)");
  const t = table ?? editors;
  return sql`(${t.penName} IS NOT NULL AND ${t.hiddenAt} IS NULL)`;
}
