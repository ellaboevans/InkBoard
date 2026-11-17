/**
 * The dashboard's welcome checklist for new writers (docs/PLAN.md, Phase 20).
 * Pure: the server loads the facts (src/server/welcome-checklist.ts) and this
 * turns them into steps. Nothing here comes from the client.
 */

export const CHECKLIST_STEPS = ["pen-name", "avatar", "about", "publish", "way-in", "share"] as const;
export type ChecklistStepId = (typeof CHECKLIST_STEPS)[number];

/** What the server knows about the editor, from real rows. */
export type ChecklistFacts = {
  hasPenName: boolean;
  /** editors.avatar set (null = the default derived from the id), or a profile photo (editors.photo_key). */
  hasAvatar: boolean;
  /** Tagline or bio set. */
  hasAbout: boolean;
  /** At least one published poem, public or private. */
  hasPublished: boolean;
  /** Any recovery-code set, or a passkey. */
  hasWayIn: boolean;
  /** Shared the author page from the checklist (editors.author_page_shared_at). */
  hasShared: boolean;
  /** "Not now" on the recovery-code setup (editors.recovery_prompt_dismissed_at): that step's nudge is skipped. */
  wayInSkipped: boolean;
};

export type ChecklistStep = {
  id: ChecklistStepId;
  title: string;
  line: string;
  done: boolean;
  /** Not done, and the editor said "Not now" to it: shown quietly, never as the next step. */
  skipped: boolean;
  /** Not offered yet (sharing waits for a published poem). */
  waiting: boolean;
  /** Where to do it; null for the share step (a button). */
  href: string | null;
};

export function checklistSteps(f: ChecklistFacts): ChecklistStep[] {
  const step = (id: ChecklistStepId, title: string, line: string, done: boolean, href: string | null, extra: Partial<ChecklistStep> = {}) => ({
    id,
    title,
    line,
    done,
    skipped: false,
    waiting: false,
    href,
    ...extra,
  });
  return [
    step("pen-name", "Choose your pen name", "It labels your section of the board.", f.hasPenName, "/admin/profile#penName"),
    step("avatar", "Pick an avatar", "The face that goes with your pen name, or a photo of you.", f.hasAvatar, "/admin/profile#avatar"),
    step("about", "Tell readers about yourself", "A tagline or a few lines of bio for your author page.", f.hasAbout, "/admin/profile#tagline"),
    step("publish", "Publish your first poem", "Public or password protected: either goes on the board.", f.hasPublished, "/admin/poems/new"),
    step("way-in", "Keep a way in without your email", "Recovery codes or a passkey, for days your email isn’t to hand.", f.hasWayIn, "/admin/profile#recovery-codes", {
      skipped: !f.hasWayIn && f.wayInSkipped,
    }),
    step(
      "share",
      "Share your author page",
      f.hasPublished ? "Send your page to the people you’d like to read you." : "Once your first poem is published.",
      f.hasShared,
      null,
      { waiting: !f.hasShared && !f.hasPublished },
    ),
  ];
}

export const doneCount = (steps: ChecklistStep[]) => steps.filter((s) => s.done).length;
export const allDone = (steps: ChecklistStep[]) => steps.every((s) => s.done);

/** The step to suggest next: the first one not done, not skipped, and on offer. */
export const nextStep = (steps: ChecklistStep[]) => steps.find((s) => !s.done && !s.skipped && !s.waiting) ?? null;
