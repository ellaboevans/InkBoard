import "server-only";
import { and, eq, isNotNull, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { BIO_MAX, PEN_NAME_MAX, PEN_NAME_MIN } from "@/lib/profile-limits";
import { firstFreeSlug, isUniqueViolation, slugify } from "@/lib/slug";

export const penNameSchema = z
  .string()
  .trim()
  .min(PEN_NAME_MIN, `Pen name must be at least ${PEN_NAME_MIN} characters`)
  .max(PEN_NAME_MAX, `Pen name must be at most ${PEN_NAME_MAX} characters`)
  .regex(/\p{L}/u, "Pen name must contain at least one letter");

/** Plain text; line endings normalised, outer blank space trimmed, empty → null. */
export const bioSchema = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().max(BIO_MAX, `Bio must be at most ${BIO_MAX} characters`))
  .transform((s) => (s === "" ? null : s));

/** Find a slug not used by another editor: `rumi`, `rumi-2`, `rumi-3`, … */
async function uniqueEditorSlug(base: string, editorId: string) {
  const taken = await getDb()
    .select({ slug: editors.slug })
    .from(editors)
    .where(
      and(
        ne(editors.id, editorId),
        or(eq(editors.slug, base), like(editors.slug, `${base}-%`)),
      ),
    );
  return firstFreeSlug(base, taken.map((t) => t.slug));
}

export type SetPenNameResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export async function setPenName(
  editorId: string,
  rawPenName: unknown,
): Promise<SetPenNameResult> {
  const parsed = penNameSchema.safeParse(rawPenName);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const penName = parsed.data;

  // Retry if another editor grabbed the same slug concurrently.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await uniqueEditorSlug(slugify(penName, "author"), editorId);
    try {
      await getDb()
        .update(editors)
        .set({ penName, slug })
        .where(eq(editors.id, editorId));
      return { ok: true, slug };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  return { ok: false, error: "Could not save pen name, please try again" };
}

export type ProfileFields = { penName: string; bio: string | null };

export type UpdateProfileResult =
  | { ok: true; profile: ProfileFields }
  | { ok: false; error: string; field: "penName" | "bio" };

/**
 * Change an onboarded editor's pen name and bio. The slug is deliberately left
 * alone: it is in every public poem URL (/p/[author]/[poem]), so renaming must
 * not break links that readers have shared. Only onboarded editors can update
 * (onboarding goes through setPenName, which allocates the slug).
 */
export async function updateProfile(
  editorId: string,
  input: { penName: unknown; bio: unknown },
): Promise<UpdateProfileResult> {
  const penName = penNameSchema.safeParse(input.penName);
  if (!penName.success) {
    return { ok: false, field: "penName", error: penName.error.issues[0].message };
  }
  const bio = bioSchema.safeParse(input.bio ?? "");
  if (!bio.success) {
    return { ok: false, field: "bio", error: bio.error.issues[0].message };
  }
  const [row] = await getDb()
    .update(editors)
    .set({ penName: penName.data, bio: bio.data })
    .where(and(eq(editors.id, editorId), isNotNull(editors.slug)))
    .returning({ penName: editors.penName, bio: editors.bio });
  if (!row) return { ok: false, field: "penName", error: "Finish choosing a pen name first" };
  return { ok: true, profile: { penName: row.penName!, bio: row.bio } };
}
