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
};

export type BoardSection = {
  editorId: string;
  penName: string;
  slug: string;
  poems: BoardPoem[];
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
};
