import "server-only";
import { and, eq, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { editors } from "@/db/schema";

export const penNameSchema = z
  .string()
  .trim()
  .min(2, "Pen name must be at least 2 characters")
  .max(60, "Pen name must be at most 60 characters")
  .regex(/\p{L}/u, "Pen name must contain at least one letter");

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "author"
  );
}

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
  const used = new Set(taken.map((t) => t.slug));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
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
    const slug = await uniqueEditorSlug(slugify(penName), editorId);
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

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
