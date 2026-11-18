import type { AuthorPicture } from "./author-picture";

/** Reader-facing shapes, shared by the server loaders and the board UI. */

export type BoardPoem = {
  id: string;
  title: string;
  slug: string;
  visibility: "public" | "private";
  /** BCP 47 tag (src/lib/poem-languages.ts) for the card's `lang`; null = not set. */
  language: string | null;
  /** First few lines of a public poem. Always null for private poems (N1). */
  excerpt: string | null;
  /** True when a public poem continues past the excerpt. */
  hasMore: boolean;
  /** Its collection, for the card's badge; null when it's in none (docs/PLAN.md, Phase 14). */
  collection: CollectionBadge | null;
};

/** "Harmattan Cycle · 2/4": numbered over the collection's published poems only. */
export type CollectionBadge = { title: string; slug: string; part: number; parts: number };

export type BoardSection = {
  editorId: string;
  penName: string;
  slug: string;
  /** Photo or avatar, beside the section's label (Phase 22). */
  picture: AuthorPicture;
  /** Novels with at least one published chapter: book cards, placed before the poems (Phase 23b). */
  novels: BoardNovel[];
  poems: BoardPoem[];
};

/**
 * A novel as readers see it in lists (docs/PLAN.md, Phase 23b): the board's
 * book card and the author page. Counts, words and dates come from published
 * chapters only, so drafts never show, not even as a number.
 */
export type BoardNovel = {
  id: string;
  title: string;
  slug: string;
  /** BCP 47 tag (src/lib/poem-languages.ts) for `lang` on the title and blurb; null = not set. */
  language: string | null;
  status: "ongoing" | "complete";
  /** Private (Phase 25): title, cover, blurb and chapter list are shown; chapter text only after unlocking. */
  visibility: "public" | "private";
  /** The uploaded cover's key (Phase 25), or null: the drawn cover. Public even for a private novel. */
  coverKey: string | null;
  /** The blurb's first paragraph, cut short for the card; null = none. */
  blurb: string | null;
  /** Published chapters. Always at least 1: a novel with none isn't shown. */
  chapterCount: number;
  /** Over published chapters. */
  wordCount: number;
  readingMinutes: number;
  /** The latest published chapter's first publish (ISO). */
  updatedAt: string | null;
};

/** A published chapter in reading order: `number` is 1..n over published chapters only. */
export type ReaderChapterSummary = {
  number: number;
  /** As written; may be empty. `displayTitle` is what readers see ("Chapter n" when empty). */
  title: string;
  displayTitle: string;
  slug: string;
  wordCount: number;
  readingMinutes: number;
  publishedAt: string | null;
};

/** A novel's public page (/a/[author]/n/[novel]). Never the email; no draft, no chapter text. */
export type NovelPage = BoardNovel & {
  /** The whole blurb (the card's `blurb` is only its start). */
  fullBlurb: string | null;
  /** Private novels: true when the author uses one password for all their private poems and novels. */
  sharedPassword: boolean;
  penName: string;
  authorSlug: string;
  editorId: string;
  /** Photo or avatar, in the byline. */
  picture: AuthorPicture;
  chapters: ReaderChapterSummary[];
};

/** A published chapter's page (/a/[author]/n/[novel]/[chapter]). */
export type ReaderChapter = ReaderChapterSummary & {
  /** The chapter's text (prose, src/lib/prose.ts); always null for a private novel (N1: unlock.ts reads it). */
  body: string | null;
  /** Published chapters in the novel ("Chapter n of m"). */
  of: number;
  novel: {
    id: string;
    title: string;
    slug: string;
    language: string | null;
    status: "ongoing" | "complete";
    visibility: "public" | "private";
    /** Private novels: the author's one password opens it. */
    sharedPassword: boolean;
    /** For the chapter's link card. */
    coverKey: string | null;
  };
  penName: string;
  authorSlug: string;
  editorId: string;
  prev: Pick<ReaderChapterSummary, "number" | "displayTitle" | "slug"> | null;
  next: Pick<ReaderChapterSummary, "number" | "displayTitle" | "slug"> | null;
};

/** A neighbour in a collection: title only, like a board card (never text). */
export type ReaderCollectionPoem = { title: string; slug: string; visibility: "public" | "private"; language: string | null };

/**
 * Where a published poem sits in its collection (docs/PLAN.md, Phase 14).
 * Counts published poems only, so drafts never leave gaps ("Part 3 of 7").
 */
export type ReaderCollection = {
  title: string;
  slug: string;
  part: number;
  parts: number;
  prev: ReaderCollectionPoem | null;
  next: ReaderCollectionPoem | null;
};

export type ReaderPoem = {
  title: string;
  slug: string;
  penName: string;
  authorSlug: string;
  visibility: "public" | "private";
  language: string | null;
  /** Full text of a public poem; always null for private ones (see unlock.ts). */
  body: string | null;
  /** Private poems: true when the author uses one password for all of them. */
  sharedPassword: boolean;
  publishedAt: string | null;
  /** Null when the poem isn't in a collection. */
  collection: ReaderCollection | null;
  /** The author's photo or avatar, in the byline and link card (Phase 22). */
  picture: AuthorPicture;
};

/** An author's public page (/a/[author]). Never includes the email. */
export type AuthorPage = {
  penName: string;
  slug: string;
  /** For the stable default avatar when none is chosen. */
  editorId: string;
  avatar: string | null;
  /** Photo or avatar (Phase 22). */
  picture: AuthorPicture;
  tagline: string | null;
  bio: string | null;
  links: string[];
  /** Published poems, newest first; the pinned one (if still published) is first. */
  poems: (BoardPoem & { pinned: boolean; publishedAt: string | null })[];
  /** Collections with at least one published poem, A–Z. */
  collections: AuthorCollection[];
  /** Novels with at least one published chapter, most recently updated first (Phase 23b). */
  novels: BoardNovel[];
};

export type AuthorCollection = { title: string; slug: string; intro: string | null; poemCount: number };

/**
 * A collection's public page (/a/[author]/c/[collection]): its published
 * poems in reading order, numbered 1..n without drafts. Never the email.
 */
export type CollectionPage = {
  title: string;
  slug: string;
  intro: string | null;
  penName: string;
  authorSlug: string;
  /** For the author's feed link and JSON-LD. */
  editorId: string;
  updatedAt: string;
  poems: (BoardPoem & { part: number; publishedAt: string | null })[];
};
