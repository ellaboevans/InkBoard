import "server-only";
import { claimReleasedChapters } from "./novels";
import { announceChapter } from "./push";

export type ReleaseAnnouncements = { claimed: number; sent: number; failed: number };

/**
 * "New chapter" notifications for scheduled chapters that have been released
 * (Phase 28). Readers see a scheduled chapter at its minute without anything
 * running; its notification goes out here, at the latest by the next daily
 * cleanup (/api/cron/cleanup), or sooner whenever its writer works on their
 * novels (`onlyEditorId`, from `after()` in every novel and chapter action:
 * no work on any page render, reader or writer). The once-only claim, followers only and the usual limits are the
 * publish path's own (claimReleasedChapters, announceChapter).
 */
export async function announceReleasedChapters(onlyEditorId?: string): Promise<ReleaseAnnouncements> {
  const ids = await claimReleasedChapters(onlyEditorId);
  const out: ReleaseAnnouncements = { claimed: ids.length, sent: 0, failed: 0 };
  for (const id of ids) {
    try {
      out.sent += (await announceChapter(id)).sent;
    } catch (err) {
      out.failed++;
      console.error("[push] release announcement failed", err instanceof Error ? err.message : err);
    }
  }
  return out;
}
