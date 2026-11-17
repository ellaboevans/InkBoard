import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, passkeys, poems, recoveryCodes } from "@/db/schema";
import { allDone, checklistSteps, type ChecklistFacts, type ChecklistStep } from "@/lib/welcome-checklist";

/*
 * The dashboard's welcome checklist (docs/PLAN.md, Phase 20). Framework-free
 * and scoped by the DAL-resolved editor id, like poems.ts. Every step comes
 * from real rows; the only stored state is editors.author_page_shared_at and
 * editors.checklist_hidden_at.
 */

export type WelcomeChecklist =
  | { kind: "steps"; steps: ChecklistStep[] }
  /** All six done: shown on exactly one render, the one that closed the checklist. */
  | { kind: "all-set" }
  | null;

/** The facts the steps are made of, in one statement. Null for an unknown editor. */
export async function loadChecklistFacts(editorId: string): Promise<(ChecklistFacts & { hidden: boolean }) | null> {
  const exists = (q: unknown) => sql<boolean>`EXISTS (${q})`;
  const [row] = await getDb()
    .select({
      penName: editors.penName,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
      tagline: editors.tagline,
      bio: editors.bio,
      sharedAt: editors.authorPageSharedAt,
      hiddenAt: editors.checklistHiddenAt,
      recoveryDismissedAt: editors.recoveryPromptDismissedAt,
      hasPublished: exists(
        sql`SELECT 1 FROM ${poems} WHERE ${poems.editorId} = ${editors.id} AND ${poems.status} = 'published'`,
      ),
      hasCodes: exists(sql`SELECT 1 FROM ${recoveryCodes} WHERE ${recoveryCodes.editorId} = ${editors.id}`),
      hasPasskey: exists(sql`SELECT 1 FROM ${passkeys} WHERE ${passkeys.editorId} = ${editors.id}`),
    })
    .from(editors)
    .where(eq(editors.id, editorId))
    .limit(1);
  if (!row) return null;
  const filled = (s: string | null) => Boolean(s && s.trim());
  return {
    hasPenName: filled(row.penName),
    // A profile photo (Phase 22) is a picked face too.
    hasAvatar: row.avatar !== null || row.photoKey !== null,
    hasAbout: filled(row.tagline) || filled(row.bio),
    hasPublished: Boolean(row.hasPublished),
    hasWayIn: Boolean(row.hasCodes) || Boolean(row.hasPasskey),
    hasShared: row.sharedAt !== null,
    wayInSkipped: row.recoveryDismissedAt !== null,
    hidden: row.hiddenAt !== null,
  };
}

/**
 * What the dashboard shows. Hidden (by the editor, or because it was finished)
 * means never again, whatever happens to the data later. When every step is
 * done, one conditional UPDATE closes the checklist; only the request whose
 * UPDATE changed the row shows "You're all set", so it appears once across
 * devices, reloads and concurrent renders.
 */
export async function getWelcomeChecklist(editorId: string): Promise<WelcomeChecklist> {
  const facts = await loadChecklistFacts(editorId);
  if (!facts || facts.hidden) return null;
  const steps = checklistSteps(facts);
  if (!allDone(steps)) return { kind: "steps", steps };
  const claimed = await getDb()
    .update(editors)
    .set({ checklistHiddenAt: sql`now()` })
    .where(and(eq(editors.id, editorId), isNull(editors.checklistHiddenAt)))
    .returning({ id: editors.id });
  return claimed.length > 0 ? { kind: "all-set" } : null;
}

/** "Hide checklist": permanent, on every device. */
export async function hideChecklist(editorId: string): Promise<void> {
  await getDb()
    .update(editors)
    .set({ checklistHiddenAt: sql`now()` })
    .where(and(eq(editors.id, editorId), isNull(editors.checklistHiddenAt)));
}

/**
 * The editor shared (or copied) their author page from the checklist. Only
 * counts once they have a published poem (before that the step isn't
 * offered); the first time is kept.
 */
export async function markAuthorPageShared(editorId: string): Promise<boolean> {
  const res = await getDb()
    .update(editors)
    .set({ authorPageSharedAt: sql`now()` })
    .where(
      and(
        eq(editors.id, editorId),
        isNull(editors.authorPageSharedAt),
        sql`EXISTS (SELECT 1 FROM ${poems} WHERE ${poems.editorId} = ${editorId} AND ${poems.status} = 'published')`,
      ),
    )
    .returning({ id: editors.id });
  return res.length > 0;
}
