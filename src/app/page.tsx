import type { Metadata } from "next";
import { BoardView } from "@/components/board/board-view";
import { JsonLd } from "@/components/seo/json-ld";
import { feedAlternates } from "@/lib/feed-links";
import { absoluteUrl, BASE_OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { getBoardSections } from "@/server/board-cache";

export const metadata: Metadata = {
  alternates: { canonical: "/", ...feedAlternates() },
  openGraph: { ...BASE_OPEN_GRAPH, type: "website", url: "/" },
};

// Cached reader data (tagged "board"), so the board is part of the static
// shell and admin edits invalidate it via updateTag (src/server/cache-tags.ts).
export default async function HomePage() {
  const sections = await getBoardSections();
  return (
    <main className="h-dvh">
      <h1 className="sr-only">InkBoard board</h1>
      <BoardView sections={sections} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          description: SITE_DESCRIPTION,
          url: absoluteUrl("/"),
        }}
      />
    </main>
  );
}
