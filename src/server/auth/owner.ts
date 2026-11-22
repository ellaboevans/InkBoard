import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { env } from "@/env";
import { normalizeEmail } from "./email";
import type { SessionEditor } from "./sessions";

/*
 * Who is InkBoard's owner (docs/PLAN.md, Phase 32 round 3): the signed-in,
 * onboarded editor whose account email matches OWNER_EMAIL (both compared
 * after normalizeEmail), on a session that isn't a "This isn't my device"
 * one. Unset OWNER_EMAIL = nobody. Framework-free, so it's tested directly;
 * the DAL's requireOwner()/getOwnerSession() wrap it for pages and actions,
 * and the proxy asks it too (only for the 404 status). Never put the
 * address in code, a page or a log.
 */

/** OWNER_EMAIL as the auth module normalises addresses, or null when unset (or invalid). */
export function ownerEmail(): string | null {
  const raw = env().OWNER_EMAIL;
  return raw.trim() ? normalizeEmail(raw) : null;
}

export type OwnerSession = { editor: SessionEditor & { penName: string; slug: string }; sessionId: string };

/**
 * The session if it's the owner's, else null: OWNER_EMAIL set, the editor's
 * email matching it, onboarded, and the session live and not on a public device.
 */
export async function resolveOwner(session: { editor: SessionEditor; sessionId: string } | null): Promise<OwnerSession | null> {
  if (!session) return null;
  const owner = ownerEmail();
  if (!owner) return null;
  const { editor, sessionId } = session;
  if (normalizeEmail(editor.email) !== owner) return null;
  if (!editor.penName || !editor.slug) return null;
  // "This isn't my device" is never the owner (a borrowed computer mustn't hold that power).
  const [row] = await getDb()
    .select({ publicDevice: sessions.publicDevice })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.editorId, editor.id), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row || row.publicDevice) return null;
  return { editor: editor as OwnerSession["editor"], sessionId };
}
