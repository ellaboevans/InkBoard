import "server-only";
import { and, eq, isNotNull, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { isAvatarId, type AvatarId } from "@/lib/avatars";
import { toNfc } from "@/lib/letters";
import {
  BIO_MAX,
  LINK_MAX_LENGTH,
  LINKS_MAX,
  PEN_NAME_MAX,
  PEN_NAME_MIN,
  TAGLINE_MAX,
} from "@/lib/profile-limits";
import { firstFreeSlug, isUniqueViolation, slugify } from "@/lib/slug";

export const penNameSchema = z
  .string()
  .overwrite(toNfc)
  .trim()
  .min(PEN_NAME_MIN, `Pen name must be at least ${PEN_NAME_MIN} characters`)
  .max(PEN_NAME_MAX, `Pen name must be at most ${PEN_NAME_MAX} characters`)
  .regex(/\p{L}/u, "Pen name must contain at least one letter");

/** Plain text; line endings normalised, outer blank space trimmed, empty → null. */
export const bioSchema = z
  .string()
  .transform((s) => toNfc(s).replace(/\r\n?/g, "\n").trim())
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

export type ProfileFields = {
  penName: string;
  bio: string | null;
  tagline: string | null;
  avatar: AvatarId | null;
  links: string[];
  pinnedPoemId: string | null;
};

export type ProfileField = "penName" | "bio" | "tagline" | "avatar" | "links" | "pinnedPoemId";

export type UpdateProfileResult =
  | { ok: true; profile: ProfileFields }
  | { ok: false; error: string; field: ProfileField };

/** Plain one line; inner whitespace collapsed, empty → null. */
export const taglineSchema = z
  .string()
  .transform((s) => toNfc(s).replace(/\s+/g, " ").trim())
  .pipe(z.string().max(TAGLINE_MAX, `Tagline must be at most ${TAGLINE_MAX} characters`))
  .transform((s) => (s === "" ? null : s));

/**
 * A public link: https only, no credentials, a real-looking host. Returned in
 * normalised form (URL.href) so it renders exactly as validated.
 */
export function normalizeLink(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > LINK_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!/^[^.]+(\.[^.]+)+$/.test(url.hostname)) return null;
  return url.href.length > LINK_MAX_LENGTH ? null : url.href;
}

function parseLinks(input: unknown): { ok: true; links: string[] } | { ok: false; error: string } {
  const raw = (Array.isArray(input) ? input : input == null ? [] : [input])
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  if (raw.length > LINKS_MAX) return { ok: false, error: `Add at most ${LINKS_MAX} links` };
  const links: string[] = [];
  for (const r of raw) {
    const link = normalizeLink(r);
    if (!link) return { ok: false, error: `“${r.slice(0, 40)}” isn't a valid https link` };
    if (!links.includes(link)) links.push(link);
  }
  return { ok: true, links };
}

const poemIdSchema = z.uuid();

/**
 * Change an onboarded editor's public profile. The slug is deliberately left
 * alone: it is in every public poem URL (/p/[author]/[poem]), so renaming must
 * not break links that readers have shared. Only onboarded editors can update
 * (onboarding goes through setPenName, which allocates the slug).
 *
 * Fields left out of `input` (undefined) keep their stored value.
 */
export async function updateProfile(
  editorId: string,
  input: {
    penName: unknown;
    bio?: unknown;
    tagline?: unknown;
    avatar?: unknown;
    links?: unknown;
    pinnedPoemId?: unknown;
  },
): Promise<UpdateProfileResult> {
  const fail = (field: ProfileField, error: string) => ({ ok: false as const, field, error });
  const penName = penNameSchema.safeParse(input.penName);
  if (!penName.success) return fail("penName", penName.error.issues[0].message);

  const set: Partial<typeof editors.$inferInsert> = { penName: penName.data };
  if (input.bio !== undefined) {
    const bio = bioSchema.safeParse(input.bio ?? "");
    if (!bio.success) return fail("bio", bio.error.issues[0].message);
    set.bio = bio.data;
  }
  if (input.tagline !== undefined) {
    const tagline = taglineSchema.safeParse(input.tagline ?? "");
    if (!tagline.success) return fail("tagline", tagline.error.issues[0].message);
    set.tagline = tagline.data;
  }
  if (input.avatar !== undefined) {
    if (input.avatar === null || input.avatar === "") set.avatar = null;
    else if (isAvatarId(input.avatar)) set.avatar = input.avatar;
    else return fail("avatar", "Choose one of the avatars shown");
  }
  if (input.links !== undefined) {
    const links = parseLinks(input.links);
    if (!links.ok) return fail("links", links.error);
    set.links = links.links;
  }
  if (input.pinnedPoemId !== undefined) {
    if (input.pinnedPoemId === null || input.pinnedPoemId === "") set.pinnedPoemId = null;
    else {
      // Only one of this editor's own published poems can be pinned. Another
      // editor's poem id looks the same as a missing one.
      const id = poemIdSchema.safeParse(input.pinnedPoemId);
      const [own] = id.success
        ? await getDb()
            .select({ id: poems.id })
            .from(poems)
            .where(and(eq(poems.id, id.data), eq(poems.editorId, editorId), eq(poems.status, "published")))
        : [];
      if (!own) return fail("pinnedPoemId", "Pick one of your published poems");
      set.pinnedPoemId = own.id;
    }
  }

  const [row] = await getDb()
    .update(editors)
    .set(set)
    .where(and(eq(editors.id, editorId), isNotNull(editors.slug)))
    .returning(profileColumns);
  if (!row) return fail("penName", "Finish choosing a pen name first");
  return { ok: true, profile: toProfile(row) };
}

const profileColumns = {
  penName: editors.penName,
  bio: editors.bio,
  tagline: editors.tagline,
  avatar: editors.avatar,
  links: editors.links,
  pinnedPoemId: editors.pinnedPoemId,
};

function toProfile(row: {
  penName: string | null;
  bio: string | null;
  tagline: string | null;
  avatar: string | null;
  links: string[];
  pinnedPoemId: string | null;
}): ProfileFields {
  return {
    penName: row.penName ?? "",
    bio: row.bio,
    tagline: row.tagline,
    avatar: isAvatarId(row.avatar) ? row.avatar : null,
    links: Array.isArray(row.links) ? row.links : [],
    pinnedPoemId: row.pinnedPoemId,
  };
}

/** The editor's own profile, for the profile page. */
export async function getProfile(editorId: string): Promise<ProfileFields | null> {
  const [row] = await getDb().select(profileColumns).from(editors).where(eq(editors.id, editorId));
  return row ? toProfile(row) : null;
}

/**
 * Pin one of the editor's own published poems (or unpin with null). Another
 * editor's poem, a draft, or a malformed id is refused like a missing one.
 */
export async function setPinnedPoem(editorId: string, poemId: unknown): Promise<boolean> {
  let pinned: string | null = null;
  if (poemId !== null) {
    const id = poemIdSchema.safeParse(poemId);
    if (!id.success) return false;
    const [own] = await getDb()
      .select({ id: poems.id })
      .from(poems)
      .where(and(eq(poems.id, id.data), eq(poems.editorId, editorId), eq(poems.status, "published")));
    if (!own) return false;
    pinned = own.id;
  }
  const updated = await getDb()
    .update(editors)
    .set({ pinnedPoemId: pinned })
    .where(eq(editors.id, editorId))
    .returning({ id: editors.id });
  return updated.length > 0;
}
