import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, sessions } from "@/db/schema";
import { env } from "@/env";
import { generateToken, sha256 } from "@/server/crypto";
import { isEmailAllowed } from "./email";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The subset of an editor that is safe to hand to UI code. */
export type SessionEditor = {
  id: string;
  email: string;
  penName: string | null;
  slug: string | null;
  bio: string | null;
};

export async function createSession(
  editorId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const [row] = await getDb()
    .insert(sessions)
    .values({
      editorId,
      tokenHash: sha256(token),
      expiresAt: sql`now() + make_interval(secs => ${SESSION_TTL_SECONDS})`,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip ?? null,
    })
    .returning({ expiresAt: sessions.expiresAt });
  return { token, expiresAt: row.expiresAt };
}

/** Resolve a raw cookie token to its editor, or null if unknown/expired. */
export async function validateSessionToken(
  token: string,
): Promise<SessionEditor | null> {
  if (!token || token.length > 128) return null;
  const [row] = await getDb()
    .select({
      id: editors.id,
      email: editors.email,
      penName: editors.penName,
      slug: editors.slug,
      bio: editors.bio,
    })
    .from(sessions)
    .innerJoin(editors, eq(editors.id, sessions.editorId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Removing someone from EDITOR_ALLOWLIST ends their existing sessions too.
  if (!isEmailAllowed(row.email, env().EDITOR_ALLOWLIST)) return null;
  return row;
}

export async function revokeSessionToken(token: string): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeAllSessions(editorId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.editorId, editorId));
}
