import "server-only";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
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
  /** Chosen avatar id, or null for the default (see avatarIdFor). */
  avatar: string | null;
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

/** Resolve a raw cookie token to its editor and session id, or null if unknown/expired. */
export async function validateSession(
  token: string,
): Promise<{ editor: SessionEditor; sessionId: string } | null> {
  if (!token || token.length > 128) return null;
  const [row] = await getDb()
    .select({
      sessionId: sessions.id,
      id: editors.id,
      email: editors.email,
      penName: editors.penName,
      slug: editors.slug,
      bio: editors.bio,
      avatar: editors.avatar,
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
  const { sessionId, ...editor } = row;
  return { editor, sessionId };
}

/** Resolve a raw cookie token to its editor, or null if unknown/expired. */
export async function validateSessionToken(
  token: string,
): Promise<SessionEditor | null> {
  return (await validateSession(token))?.editor ?? null;
}

export async function revokeSessionToken(token: string): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeAllSessions(editorId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.editorId, editorId));
}

/** A signed-in device as shown on the profile page. Never includes the token hash. */
export type SessionSummary = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
};

/** The editor's live sessions, current one first, then newest first. */
export async function listSessions(
  editorId: string,
  currentSessionId: string,
): Promise<SessionSummary[]> {
  const rows = await getDb()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
    })
    .from(sessions)
    .where(and(eq(sessions.editorId, editorId), gt(sessions.expiresAt, sql`now()`)))
    .orderBy(desc(sessions.createdAt), desc(sessions.id));
  return rows
    .map((r) => ({ ...r, current: r.id === currentSessionId }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

const sessionIdSchema = z.uuid();

/**
 * Revoke one of the editor's sessions. Scoped by editor, so another editor's
 * session id (or a malformed one) behaves like a missing one. Returns whether
 * a session was removed.
 */
export async function revokeSession(
  editorId: string,
  sessionId: unknown,
): Promise<boolean> {
  const id = sessionIdSchema.safeParse(sessionId);
  if (!id.success) return false;
  const removed = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.id, id.data), eq(sessions.editorId, editorId)))
    .returning({ id: sessions.id });
  return removed.length > 0;
}

/** Sign the editor out everywhere except `keepSessionId`. Returns how many were removed. */
export async function revokeOtherSessions(
  editorId: string,
  keepSessionId: string,
): Promise<number> {
  const removed = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.editorId, editorId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });
  return removed.length;
}
