import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { collections, editors, poems, shortLinks } from "@/db/schema";
import { EXPORT_FORMAT_VERSION, type EditorExport } from "@/lib/export-format";
import { COVER_JPEG_WIDTH, coverHeight, PHOTO_JPEG_SIZE } from "@/lib/photo-limits";
import { readCoverJpeg } from "./novel-covers";
import { readPhotoJpeg } from "./profile-photos";
import { novelsForExport } from "./novels";
import { revisionsForExport } from "./poem-history";
import { rateLimit } from "./rate-limit";

/*
 * "Download your poems" (docs/PLAN.md, Phase 17): everything an editor wrote,
 * for the DAL-resolved editor only. Framework-free and integration-tested;
 * the files are built by the pure functions in src/lib/export-format.ts and
 * served by GET /admin/export/[format].
 *
 * Every query selects named columns, scoped by the editor id. What never goes
 * in: password hashes and versions, the shared password, the email address,
 * sessions, sign-in history, recovery codes, passkeys, rate limits, and
 * anything of another editor's (tests/account/export.test.ts pins this).
 */

export const EXPORTS_PER_HOUR = 10;

/** Counted per editor, like the other limits; false once over the hourly budget. */
export async function allowExport(editorId: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const res = await rateLimit(`export:${editorId}`, EXPORTS_PER_HOUR, 3600);
  return { allowed: res.allowed, retryAfter: res.retryAfter };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The editor's whole account as data, or null if there's no such (onboarded) editor. */
export async function loadEditorExport(
  editorId: string,
  { site, now = new Date() }: { site: string; now?: Date },
): Promise<EditorExport | null> {
  const db = getDb();
  const [profile] = await db
    .select({
      penName: editors.penName,
      slug: editors.slug,
      tagline: editors.tagline,
      bio: editors.bio,
      links: editors.links,
      avatar: editors.avatar,
      photoKey: editors.photoKey,
      pinnedPoemId: editors.pinnedPoemId,
      joinedAt: editors.createdAt,
    })
    .from(editors)
    .where(eq(editors.id, editorId));
  if (!profile?.penName || !profile.slug) return null;

  const [poemRows, collectionRows, revisions, photoJpeg, novelRows] = await Promise.all([
    db
      .select({
        id: poems.id,
        title: poems.title,
        slug: poems.slug,
        body: poems.body,
        language: poems.language,
        visibility: poems.visibility,
        status: poems.status,
        publishedAt: poems.publishedAt,
        createdAt: poems.createdAt,
        updatedAt: poems.updatedAt,
        collectionId: poems.collectionId,
        collectionPosition: poems.collectionPosition,
        // Visits through its short link (Phase 21 round 3): a number about the poem, nothing about visitors.
        shareVisits: sql<number>`coalesce(${shortLinks.visits}, 0)`,
      })
      .from(poems)
      .leftJoin(shortLinks, eq(shortLinks.poemId, poems.id))
      .where(eq(poems.editorId, editorId))
      .orderBy(asc(poems.createdAt), asc(poems.id)),
    db
      .select({
        id: collections.id,
        title: collections.title,
        slug: collections.slug,
        intro: collections.intro,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
      })
      .from(collections)
      .where(eq(collections.editorId, editorId))
      // The order of the editor's own Collections page.
      .orderBy(asc(sql`lower(${collections.title})`), asc(collections.id)),
    revisionsForExport(editorId),
    // The photo's own JPEG copy (Phase 22). Unreadable storage leaves it out rather than failing the download.
    profile.photoKey ? readPhotoJpeg(profile.photoKey) : Promise.resolve(null),
    // Novels with every chapter and version (Phase 23); scoped in novels.ts like every read there.
    novelsForExport(editorId),
  ]);

  // Each uploaded cover's own JPEG copy (Phase 25), like the photo: never its storage key.
  const coverJpegs = await Promise.all(novelRows.map((n) => (n.coverKey ? readCoverJpeg(n.coverKey) : Promise.resolve(null))));
  const titles = new Map(collectionRows.map((c) => [c.id, c.title]));
  return {
    format: "inkboard-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    site,
    profile: {
      penName: profile.penName,
      slug: profile.slug,
      tagline: profile.tagline,
      bio: profile.bio,
      links: Array.isArray(profile.links) ? profile.links : [],
      avatar: profile.avatar,
      photo: photoJpeg
        ? { type: "image/jpeg", width: PHOTO_JPEG_SIZE, height: PHOTO_JPEG_SIZE, base64: Buffer.from(photoJpeg).toString("base64") }
        : null,
      pinnedPoemId: profile.pinnedPoemId,
      joinedAt: profile.joinedAt.toISOString(),
    },
    collections: collectionRows.map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      intro: c.intro,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      poemIds: poemRows
        .filter((p) => p.collectionId === c.id)
        .sort((a, b) => (a.collectionPosition ?? 0) - (b.collectionPosition ?? 0))
        .map((p) => p.id),
    })),
    poems: poemRows.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      text: p.body,
      language: p.language,
      visibility: p.visibility,
      status: p.status,
      publishedAt: iso(p.publishedAt),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      shareVisits: Number(p.shareVisits),
      collection:
        p.collectionId && p.collectionPosition !== null
          ? { id: p.collectionId, title: titles.get(p.collectionId) ?? "", position: p.collectionPosition }
          : null,
      revisions: revisions
        .filter((r) => r.poemId === p.id)
        .map((r) => ({ savedAt: r.savedAt.toISOString(), title: r.title, text: r.body, language: r.language })),
    })),
    novels: novelRows.map((n, i) => ({
      id: n.id,
      title: n.title,
      slug: n.slug,
      blurb: n.blurb,
      language: n.language,
      status: n.status,
      visibility: n.visibility,
      cover: coverJpegs[i]
        ? {
            type: "image/jpeg" as const,
            width: COVER_JPEG_WIDTH,
            height: coverHeight(COVER_JPEG_WIDTH),
            base64: Buffer.from(coverJpegs[i]!).toString("base64"),
          }
        : null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      chapters: n.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        position: c.position,
        status: c.scheduledFor ? ("scheduled" as const) : c.status,
        publishedAt: iso(c.publishedAt),
        scheduledFor: iso(c.scheduledFor),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        wordCount: c.wordCount,
        shareVisits: c.shareVisits,
        text: c.body,
        revisions: c.revisions.map((r) => ({ savedAt: r.savedAt.toISOString(), title: r.title, text: r.body })),
      })),
    })),
  };
}
