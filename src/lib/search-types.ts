/** Board search results (src/server/search.ts). Never includes poem or chapter text. */
export type SearchResults = {
  authors: { editorId: string; penName: string; slug: string; poemCount: number }[];
  /** Novels with a published chapter, by title only (Phase 24). */
  novels: { id: string; title: string; slug: string; editorId: string; penName: string; authorSlug: string }[];
  poems: {
    id: string;
    title: string;
    slug: string;
    visibility: "public" | "private";
    editorId: string;
    penName: string;
    authorSlug: string;
  }[];
};
