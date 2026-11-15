import "server-only";
import { and, desc, eq, like, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { toNfc } from "@/lib/letters";
import { POEM_LANGUAGE_CODES, type PoemLanguage } from "@/lib/poem-languages";
import { normalizePoemBody } from "@/lib/poem-text";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { BODY_MAX, PASSWORD_MAX, PASSWORD_MIN, TITLE_MAX } from "@/lib/poem-limits";
import { firstFreeSlug, isCheckViolation, isUniqueViolation, slugify } from "@/lib/slug";
import { hashPassword } from "./passwords";
import { recordRevision, sameContent } from "./poem-history";

/*
 * Editor-side poem management (R2, R3, N5, N6).
 *
 * Every function takes the *authenticated* editor id (from the DAL) and scopes
 * every query by it, so an editor can never read or modify another editor's
 * poem, even by guessing its id. Unknown and foreign ids both look like
 * "not found". Password hashes never leave this module.
 *
 * Saves that change the title, text or language also record a version in
 * poem_revisions, in the same transaction (src/server/poem-history.ts).
 */

export { BODY_MAX, PASSWORD_MAX, PASSWORD_MIN, TITLE_MAX } from "@/lib/poem-limits";

const idSchema = z.uuid();

const inputSchema = z.object({
  title: z
    .string()
    .overwrite(toNfc)
    .trim()
    .min(1, "Give your poem a title")
    .max(TITLE_MAX, `Titles can be at most ${TITLE_MAX} characters`),
  body: z
    .string()
    // Normalise line endings, drop leading blank lines and trailing
    // whitespace; indentation inside the poem is meaningful and kept.
    .transform(normalizePoemBody)
    .pipe(
      z
        .string()
        .min(1, "The poem is empty")
        .max(BODY_MAX, `Poems can be at most ${BODY_MAX.toLocaleString("en")} characters`),
    ),
  visibility: z.enum(["public", "private"], "Choose who can read this poem"),
  /** Optional; "" (the "Not set" option) means untagged. */
  language: z
    .string()
    .optional()
    .transform((l) => (l ? l : null))
    .pipe(z.enum(POEM_LANGUAGE_CODES, "Choose a language from the list").nullable()),
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
const SETTINGS_CHANGED =
  "Your password settings changed while saving. Please review and save again.";

/**
 * Run a write; if the DB's password invariant rejects it (an editor switched
 * password mode in another tab mid-save), report it instead of crashing.
 */
async function guardPasswordInvariant<T>(
  write: () => Promise<T>,
): Promise<T | { ok: false; errors: PoemErrors }> {
  try {
    return await write();
  } catch (err) {
    if (isCheckViolation(err)) return { ok: false, errors: { form: SETTINGS_CHANGED } };
    throw err;
  }
}

/** Columns that are safe to send to the editor's browser (no hash). */
const summaryColumns = {
  id: poems.id,
  title: poems.title,
  slug: poems.slug,
  visibility: poems.visibility,
  language: sql<PoemLanguage | null>`${poems.language}`,
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
  language: PoemLanguage | null;
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

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** First free `slug`, `slug-2`, … among this editor's other poems. */
async function uniquePoemSlug(tx: Tx, editorId: string, title: string, exceptId?: string) {
  const base = slugify(title, "untitled");
  const taken = await tx
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

/**
 * Lock order is always editor row -> poem rows (mode switches in
 * password-settings.ts do the same), so poem saves and mode switches can't
 * deadlock, and the mode read here can't change before this write commits.
 * NO KEY UPDATE also queues one editor's own saves behind each other, which
 * makes slug allocation race-free; other editors are unaffected, and foreign
 * key checks (KEY SHARE) don't conflict with it.
 */
async function lockPasswordMode(tx: Tx, editorId: string) {
  const [row] = await tx
    .select({ mode: editors.passwordMode })
    .from(editors)
    .where(eq(editors.id, editorId))
    .for("no key update");
  return row?.mode ?? "per_poem";
}

export async function createPoem(
  editorId: string,
  raw: unknown,
): Promise<PoemMutationResult> {
  const { data, errors } = parse(raw);
  if (errors) return { ok: false, errors };
  // Hash outside the transaction (it's slow); it's discarded in shared mode.
  const typedHash =
    data.visibility === "private" && data.password ? await hashPassword(data.password) : null;

  return guardPasswordInvariant(() =>
    withSlugRetry(() =>
      getDb().transaction(async (tx): Promise<PoemMutationResult> => {
        // Shared mode: the author's one password protects the poem; any
        // password typed into the poem form is ignored.
        const shared = (await lockPasswordMode(tx, editorId)) === "shared";
        if (data.visibility === "private" && !shared && !typedHash) {
          return { ok: false, errors: { password: PRIVATE_NEEDS_PASSWORD } };
        }
        const [poem] = await tx
          .insert(poems)
          .values({
            editorId,
            title: data.title,
            slug: await uniquePoemSlug(tx, editorId, data.title),
            body: data.body,
            visibility: data.visibility,
            language: data.language,
            passwordHash: data.visibility === "private" && !shared ? typedHash : null,
            status: data.status,
            publishedAt: data.status === "published" ? sql`now()` : null,
          })
          .returning({ id: poems.id, slug: poems.slug, status: poems.status });
        // Version 1 of its history.
        await recordRevision(tx, poem.id, { title: data.title, body: data.body, language: data.language });
        return { ok: true, poem };
      }),
    ),
  );
}

export async function updatePoem(
  editorId: string,
  poemId: string,
  raw: unknown,
): Promise<PoemMutationResult | { ok: false; notFound: true }> {
  if (!idSchema.safeParse(poemId).success) return { ok: false, notFound: true };

  const { data, errors } = parse(raw);
  if (errors) return { ok: false, errors };
  const typedHash =
    data.visibility === "private" && data.password ? await hashPassword(data.password) : null;

  return guardPasswordInvariant(() =>
    withSlugRetry(() =>
      getDb().transaction(async (tx) => {
        const shared = (await lockPasswordMode(tx, editorId)) === "shared";
        const [current] = await tx
          .select({
            title: poems.title,
            body: poems.body,
            language: poems.language,
            status: poems.status,
            publishedAt: poems.publishedAt,
            updatedAt: poems.updatedAt,
            passwordHash: poems.passwordHash,
          })
          .from(poems)
          .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
          .for("update");
        if (!current) return { ok: false as const, notFound: true as const };

        // Password rules (the row is locked, so `current` is authoritative):
        //   - shared mode, private: the poem has no password of its own.
        //   - public: drop any password; bump the version if there was one.
        //   - private + new password: replace it and bump the version, which
        //     revokes every reader's existing unlock (N6).
        //   - private + blank: keep the current password, if there is one.
        let password: { passwordHash: string | null; passwordVersion?: SQL } | undefined;
        if (data.visibility === "private" && shared) {
          password = { passwordHash: null };
        } else if (data.visibility === "public") {
          password = {
            passwordHash: null,
            passwordVersion: sql`${poems.passwordVersion} + (${poems.passwordHash} IS NOT NULL)::int`,
          };
        } else if (typedHash) {
          password = { passwordHash: typedHash, passwordVersion: sql`${poems.passwordVersion} + 1` };
        } else if (!current.passwordHash) {
          return { ok: false as const, errors: { password: PRIVATE_NEEDS_PASSWORD } };
        }

        // Keep URLs stable once a poem has been published; drafts follow their title.
        const retitledDraft = !current.publishedAt && data.title !== current.title;

        // Unpublishing withdraws access: readers who unlocked the poem must
        // enter the password again if it's republished. (Shared-mode grants
        // cover the author as a whole and are revoked from Settings.)
        const unpublishing = current.status === "published" && data.status === "draft";
        const revoke = unpublishing && !password?.passwordVersion
          ? { passwordVersion: sql`${poems.passwordVersion} + 1` }
          : undefined;

        const [poem] = await tx
          .update(poems)
          .set({
            title: data.title,
            body: data.body,
            visibility: data.visibility,
            language: data.language,
            status: data.status,
            ...(retitledDraft && { slug: await uniquePoemSlug(tx, editorId, data.title, poemId) }),
            ...(data.status === "published" && {
              publishedAt: sql`COALESCE(${poems.publishedAt}, now())`,
            }),
            ...password,
            ...revoke,
          })
          .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
          .returning({ id: poems.id, slug: poems.slug, status: poems.status });

        // A new version only when the content changed (not for status,
        // visibility or password changes). Stored values are normalised the
        // same way as `data`, so this compares like with like.
        const next = { title: data.title, body: data.body, language: data.language };
        if (!sameContent(next, current)) {
          await recordRevision(tx, poemId, next, { ...current, savedAt: current.updatedAt });
        }
        return { ok: true as const, poem };
      }),
    ),
  );
}

export async function deletePoem(editorId: string, poemId: string): Promise<boolean> {
  if (!idSchema.safeParse(poemId).success) return false;
  const rows = await getDb()
    .delete(poems)
    .where(and(eq(poems.id, poemId), eq(poems.editorId, editorId)))
    .returning({ id: poems.id });
  return rows.length > 0;
}
