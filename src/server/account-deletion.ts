import "server-only";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { editors, emailOtps, novels, poems, rateLimits, retiredSlugs, sessions } from "@/db/schema";
import { toNfc } from "@/lib/letters";
import { describeUserAgent } from "@/lib/user-agent";
import { isSessionFresh } from "./auth/step-up";
import { sha256 } from "./crypto";
import { sendAccountDeletedEmail } from "./email";
import { deleteCoverFiles } from "./novel-covers";
import { deletePhotoFiles } from "./profile-photos";

/*
 * "Delete my account" (docs/PLAN.md, Phase 17). One transaction, under the
 * editor row lock (lock order: editor first, CLAUDE.md):
 *
 * 1. Needs a recent verification (isSessionFresh: email or passkey; a
 *    recovery-code sign-in alone doesn't count) and the pen name typed back.
 * 2. Retires the author slug (retired_slugs), so no later editor can take it
 *    and old links never point at someone else's poems.
 * 3. Deletes what isn't tied to the editor row by a foreign key: sign-in codes
 *    (email_otps, by address) and rate-limit counters that name the editor,
 *    one of their sessions, their email's hash, or one of their poems.
 * 4. Deletes the editor row. Everything else goes by ON DELETE CASCADE:
 *    sessions (and with them step-up codes and their WebAuthn challenges),
 *    poems (and their revisions, and their short links with their visit
 *    counts, whose codes a trigger retires so no other poem gets them),
 *    collections, passkeys, recovery codes,
 *    WebAuthn challenges, known sign-in devices and networks.
 *    tests/account/deletion.test.ts walks every table that references
 *    editors (directly or through those) and checks nothing is left.
 *
 * 5. After the commit, deletes the profile photo's and the novels' uploaded
 *    covers' files from storage (Phase 25).
 *
 * The caller then invalidates the readers' cache, clears the cookie and sends
 * the browser to the board. Saved offline copies in readers' browsers are out
 * of reach; the confirmation says so.
 */

export type DeleteAccountResult =
  | { ok: true; poemIds: string[] }
  | { ok: false; error: "step_up_required" | "wrong_confirmation" | "no_session" };

/** The pen name as typed back: NFC, spaces collapsed, trimmed; case matters. */
export function confirmsPenName(typed: unknown, penName: string | null): boolean {
  if (typeof typed !== "string" || !penName) return false;
  const tidy = (s: string) => toNfc(s).replace(/\s+/g, " ").trim();
  return tidy(typed) === tidy(penName);
}

export async function deleteAccount(input: {
  editorId: string;
  sessionId: string;
  confirmation: unknown;
  userAgent?: string | null;
}): Promise<DeleteAccountResult> {
  const { editorId, sessionId } = input;
  const result = await getDb().transaction(async (tx) => {
    const [editor] = await tx
      .select({ email: editors.email, penName: editors.penName, slug: editors.slug, photoKey: editors.photoKey })
      .from(editors)
      .where(eq(editors.id, editorId))
      .for("no key update");
    if (!editor) return { ok: false as const, error: "no_session" as const };
    if (!(await isSessionFresh(editorId, sessionId, tx))) return { ok: false as const, error: "step_up_required" as const };
    if (!confirmsPenName(input.confirmation, editor.penName)) {
      return { ok: false as const, error: "wrong_confirmation" as const };
    }

    const ownPoems = await tx.select({ id: poems.id }).from(poems).where(eq(poems.editorId, editorId));
    const ownSessions = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.editorId, editorId));
    // Read before the cascade: their files are deleted after the commit.
    const covers = await tx
      .select({ key: novels.coverKey })
      .from(novels)
      .where(and(eq(novels.editorId, editorId), isNotNull(novels.coverKey)));

    if (editor.slug) await tx.insert(retiredSlugs).values({ slug: editor.slug }).onConflictDoNothing();

    // Not linked by foreign keys, so deleted by hand.
    await tx.delete(emailOtps).where(eq(emailOtps.email, editor.email));
    // Counters naming the editor, a session, the email's hash, or one of their poems
    // (share-visit and unlock counters, Phase 21 round 3).
    const named = [editorId, ...ownSessions.map((s) => s.id), sha256(editor.email), ...ownPoems.map((p) => p.id)];
    await tx.delete(rateLimits).where(or(...named.map((id) => sql`${rateLimits.key} LIKE ${`%${id}%`}`)));

    // Everything else follows by ON DELETE CASCADE (see the header).
    await tx.delete(editors).where(eq(editors.id, editorId));
    return { ok: true as const, editor, poemIds: ownPoems.map((p) => p.id), coverKeys: covers.flatMap((c) => (c.key ? [c.key] : [])) };
  });
  if (!result.ok) return result;

  const { editor, poemIds, coverKeys } = result;
  // The profile photo's files (Phase 22) and the novels' covers (Phase 25):
  // deleted now, not just unlinked. A failure is logged and the daily sweep
  // deletes them (no row points at them).
  if (editor.photoKey) await deletePhotoFiles(editor.photoKey);
  for (const key of coverKeys) await deleteCoverFiles(key);
  const details = { penName: editor.penName, device: describeUserAgent(input.userAgent), at: new Date() };
  after(async () => {
    try {
      await sendAccountDeletedEmail(editor.email, details);
    } catch (err) {
      console.error("[account] failed to send account-deleted notice", err);
    }
  });
  return { ok: true, poemIds };
}
