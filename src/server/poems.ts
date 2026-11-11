import "server-only";
import { and, desc, eq, isNotNull, like, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { poems } from "@/db/schema";
import { BODY_MAX, PASSWORD_MAX, PASSWORD_MIN, TITLE_MAX } from "@/lib/poem-limits";
import { firstFreeSlug, isUniqueViolation, slugify } from "@/lib/slug";
import { hashPassword } from "./passwords";

/*
 * Editor-side poem management (R2, R3, N5, N6).
 *
 * Every function takes the *authenticated* editor id (from the DAL) and scopes
 * every query by it, so an editor can never read or modify another editor's
 * poem, even by guessing its id. Unknown and foreign ids both look like
 * "not found". Password hashes never leave this module.
 */

export { BODY_MAX, PASSWORD_MAX, PASSWORD_MIN, TITLE_MAX } from "@/lib/poem-limits";

const idSchema = z.uuid();

const inputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give your poem a title")
    .max(TITLE_MAX, `Titles can be at most ${TITLE_MAX} characters`),
  body: z
    .string()
    // Normalise line endings, drop leading blank lines and trailing
    // whitespace; indentation inside the poem is meaningful and kept.
    .transform((b) => b.replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").trimEnd())
    .pipe(
      z
        .string()
        .min(1, "The poem is empty")
        .max(BODY_MAX, `Poems can be at most ${BODY_MAX.toLocaleString("en")} characters`),
    ),
  visibility: z.enum(["public", "private"], "Choose who can read this poem"),
  status: z.enum(["draft", "published"]),
  /** Empty = keep the current password (edits) / none (public poems). */
  password: z
    .string()
    .optional()
    .transform((p) => (p ? p : undefined))
    .pipe(
      z
        .string()
        .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
        .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)
        .optional(),
    ),
});

export type PoemInput = z.input<typeof inputSchema>;
export type PoemField = keyof PoemInput;
export type PoemErrors = Partial<Record<PoemField | "form", string>>;

export type PoemMutationResult =
  | { ok: true; poem: { id: string; slug: string; status: "draft" | "published" } }
  | { ok: false; errors: PoemErrors };

function parse(raw: unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (parsed.success) return { data: parsed.data } as const;
  const errors: PoemErrors = {};
  for (const issue of parsed.error.issues) {
    const field = (issue.path[0] as PoemField | undefined) ?? "form";
    errors[field] ??= issue.message;
  }
  return { errors } as const;
}

const PRIVATE_NEEDS_PASSWORD = "Private poems need a password readers can use";

/** Columns that are safe to send to the editor's browser (no hash). */
const summaryColumns = {
  id: poems.id,
  title: poems.title,
  slug: poems.slug,
  visibility: poems.visibility,
  status: poems.status,
  publishedAt: poems.publishedAt,
  createdAt: poems.createdAt,
  updatedAt: poems.updatedAt,
  hasPassword: sql<boolean>`${poems.passwordHash} IS NOT NULL`,
};
const editorColumns = { ...summaryColumns, body: poems.body };

export type EditorPoem = {
  id: string;
  title: string;
  slug: string;
  body: string;
  visibility: "public" | "private";
  status: "draft" | "published";
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hasPassword: boolean;
};

export type EditorPoemSummary = Omit<EditorPoem, "body">;

export async function listEditorPoems(editorId: string): Promise<EditorPoemSummary[]> {
  return getDb()
    .select(summaryColumns)
    .from(poems)
    .where(eq(poems.editorId, editorId))
    .orderBy(desc(poems.updatedAt));
}

export async function getEditorPoem(
  editorId: string,
  poemId: string,
): Promise<EditorPoem | null> {
  if (!idSchema.safeParse(poemId).success) return null;
  const [row] = await getDb()
    .select(editorColumns)
    .from(poems)
    .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
    .limit(1);
  return row ?? null;
}

/** First free `slug`, `slug-2`, … among this editor's other poems. */
async function uniquePoemSlug(editorId: string, title: string, exceptId?: string) {
  const base = slugify(title, "untitled");
  const taken = await getDb()
    .select({ slug: poems.slug })
    .from(poems)
    .where(
      and(
        eq(poems.editorId, editorId),
        exceptId ? ne(poems.id, exceptId) : undefined,
        or(eq(poems.slug, base), like(poems.slug, `${base}-%`)),
      ),
    );
  return firstFreeSlug(base, taken.map((t) => t.slug));
}

/** Retry a write whose slug lost a race with a concurrent save. */
async function withSlugRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 3) continue;
      throw err;
    }
  }
}

export async function createPoem(
  editorId: string,
  raw: unknown,
): Promise<PoemMutationResult> {
  const { data, errors } = parse(raw);
  if (errors) return { ok: false, errors };
  if (data.visibility === "private" && !data.password) {
    return { ok: false, errors: { password: PRIVATE_NEEDS_PASSWORD } };
  }

  const passwordHash =
    data.visibility === "private" ? await hashPassword(data.password!) : null;

  const [poem] = await withSlugRetry(async () =>
    getDb()
      .insert(poems)
      .values({
        editorId,
        title: data.title,
        slug: await uniquePoemSlug(editorId, data.title),
        body: data.body,
        visibility: data.visibility,
        passwordHash,
        status: data.status,
        publishedAt: data.status === "published" ? sql`now()` : null,
      })
      .returning({ id: poems.id, slug: poems.slug, status: poems.status }),
  );
  return { ok: true, poem };
}

export async function updatePoem(
  editorId: string,
  poemId: string,
  raw: unknown,
): Promise<PoemMutationResult | { ok: false; notFound: true }> {
  if (!idSchema.safeParse(poemId).success) return { ok: false, notFound: true };

  const { data, errors } = parse(raw);
  if (errors) return { ok: false, errors };

  const [current] = await getDb()
    .select({ title: poems.title, publishedAt: poems.publishedAt })
    .from(poems)
    .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
    .limit(1);
  if (!current) return { ok: false, notFound: true };

  // Password rules are applied *inside* the UPDATE, from the row's state at
  // write time, never from the read above, so concurrent saves (two tabs)
  // can't leave a public poem with a stale hash or a private one without.
  //   - public: drop any password; bump the version if there was one.
  //   - private + new password: replace it and bump the version, which
  //     revokes every reader's existing unlock (N6).
  //   - private + blank: keep the current password, but only if one exists.
  let password: { passwordHash: string | null; passwordVersion: SQL } | undefined;
  let requireExistingPassword = false;
  if (data.visibility === "public") {
    password = {
      passwordHash: null,
      passwordVersion: sql`${poems.passwordVersion} + (${poems.passwordHash} IS NOT NULL)::int`,
    };
  } else if (data.password) {
    password = {
      passwordHash: await hashPassword(data.password),
      passwordVersion: sql`${poems.passwordVersion} + 1`,
    };
  } else {
    requireExistingPassword = true;
  }

  // Keep URLs stable once a poem has been published; drafts follow their title.
  // (Slug uniqueness is enforced by the DB index; a race here is harmless.)
  const retitledDraft = !current.publishedAt && data.title !== current.title;

  const [poem] = await withSlugRetry(async () =>
    getDb()
      .update(poems)
      .set({
        title: data.title,
        body: data.body,
        visibility: data.visibility,
        status: data.status,
        ...(retitledDraft && { slug: await uniquePoemSlug(editorId, data.title, poemId) }),
        // First publish only, decided at write time.
        ...(data.status === "published" && {
          publishedAt: sql`COALESCE(${poems.publishedAt}, now())`,
        }),
        ...password,
      })
      .where(
        and(
          eq(poems.id, poemId),
          eq(poems.editorId, editorId),
          requireExistingPassword ? isNotNull(poems.passwordHash) : undefined,
        ),
      )
      .returning({ id: poems.id, slug: poems.slug, status: poems.status }),
  );
  if (poem) return { ok: true, poem };

  // Nothing updated: either the poem is gone, or it has no password to keep.
  if (requireExistingPassword && (await poemExists(editorId, poemId))) {
    return { ok: false, errors: { password: PRIVATE_NEEDS_PASSWORD } };
  }
  return { ok: false, notFound: true };
}

async function poemExists(editorId: string, poemId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: poems.id })
    .from(poems)
    .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
    .limit(1);
  return rows.length > 0;
}

export async function deletePoem(editorId: string, poemId: string): Promise<boolean> {
  if (!idSchema.safeParse(poemId).success) return false;
  const rows = await getDb()
    .delete(poems)
    .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
    .returning({ id: poems.id });
  return rows.length > 0;
}
