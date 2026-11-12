/** Board search results (src/server/search.ts). Never includes poem text. */
export type SearchResults = {
  authors: { editorId: string; penName: string; slug: string; poemCount: number }[];
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
