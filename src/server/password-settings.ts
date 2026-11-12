import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/poem-limits";
import { hashPassword } from "./passwords";

/*
 * Per-editor choice of how private poems are protected (see schema.ts
 * `passwordMode`). Framework-free; callers pass the DAL-resolved editor id.
 *
 * Switching rules (every switch revokes all reader unlocks):
 *   per_poem -> shared: the editor sets one password; poem-level passwords
 *                       are cleared, since they no longer apply.
 *   shared -> per_poem: every private poem starts with the shared password
 *                       as its own, so none is left without one; the editor
 *                       can then change them individually.
 */

export type PasswordMode = "per_poem" | "shared";

export type PasswordSettings = {
  mode: PasswordMode;
  privatePoemCount: number;
};

const passwordSchema = z
  .string("Enter a password")
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

export async function getPasswordSettings(editorId: string): Promise<PasswordSettings> {
  const [row] = await getDb()
    .select({
      mode: editors.passwordMode,
      // Raw, table-qualified names: drizzle renders bare column names inside
      // subqueries, where "id" would resolve to poems.id.
      privatePoemCount: sql<number>`(
        SELECT count(*)::int FROM poems p
        WHERE p.editor_id = "editors"."id" AND p.visibility = 'private'
      )`,
    })
    .from(editors)
    .where(eq(editors.id, editorId))
    .limit(1);
  return row ?? { mode: "per_poem", privatePoemCount: 0 };
}

export async function getPasswordMode(editorId: string): Promise<PasswordMode> {
  return (await getPasswordSettings(editorId)).mode;
}

export type SettingsResult = { ok: true } | { ok: false; error: string };

/** Switch to (or stay in) shared mode with a new shared password. */
export async function setSharedPassword(
  editorId: string,
  rawPassword: unknown,
): Promise<SettingsResult> {
  const parsed = passwordSchema.safeParse(rawPassword);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const hash = await hashPassword(parsed.data);

  await getDb().transaction(async (tx) => {
    // Editor first: the poems trigger then sees shared mode (same transaction).
    await tx
      .update(editors)
      .set({
        passwordMode: "shared",
        sharedPasswordHash: hash,
        sharedPasswordVersion: sql`${editors.sharedPasswordVersion} + 1`,
      })
      .where(eq(editors.id, editorId));
    await tx
      .update(poems)
      .set({ passwordHash: null })
      .where(and(eq(poems.editorId, editorId), eq(poems.visibility, "private")));
  });
  return { ok: true };
}

/** Switch back to a password per poem, seeded from the shared password. */
export async function switchToPerPoemPasswords(editorId: string): Promise<SettingsResult> {
  await getDb().transaction(async (tx) => {
    // Lock the editor row so a concurrent shared-password change can't
    // interleave between copying the hash and switching the mode.
    const [editor] = await tx
      .select({ mode: editors.passwordMode, hash: editors.sharedPasswordHash })
      .from(editors)
      .where(eq(editors.id, editorId))
      .for("update");
    if (!editor || editor.mode === "per_poem") return;

    // Poems first: the editors trigger then finds none without a password.
    await tx
      .update(poems)
      .set({
        passwordHash: editor.hash,
        passwordVersion: sql`${poems.passwordVersion} + 1`,
      })
      .where(and(eq(poems.editorId, editorId), eq(poems.visibility, "private")));
    await tx
      .update(editors)
      .set({
        passwordMode: "per_poem",
        sharedPasswordHash: null,
        sharedPasswordVersion: sql`${editors.sharedPasswordVersion} + 1`,
      })
      .where(eq(editors.id, editorId));
  });
  return { ok: true };
}
