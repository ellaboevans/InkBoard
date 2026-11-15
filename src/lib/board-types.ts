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
  poems: BoardPoem[];
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
};

/** An author's public page (/a/[author]). Never includes the email. */
export type AuthorPage = {
  penName: string;
  slug: string;
  /** For the stable default avatar when none is chosen. */
  editorId: string;
  avatar: string | null;
  tagline: string | null;
  bio: string | null;
  links: string[];
  /** Published poems, newest first; the pinned one (if still published) is first. */
  poems: (BoardPoem & { pinned: boolean; publishedAt: string | null })[];
  /** Collections with at least one published poem, A–Z. */
  collections: AuthorCollection[];
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
