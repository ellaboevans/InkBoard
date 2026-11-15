import type { Metadata } from "next";
import { AccountDeletedFlash } from "@/components/board/account-deleted-flash";
import { BoardView } from "@/components/board/board-view";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { JsonLd } from "@/components/seo/json-ld";
import { feedAlternates, SITE_FEED_PATH } from "@/lib/feed-links";
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
      {/* Offline reading: the board as last seen (Phase 15 round 2). */}
      <OfflineMarker save kind="board" title="The board" />
      <SaveForOffline path="/" />
      {/* Absolute, from siteUrl(): the client has no APP_URL to build it. */}
      <BoardView sections={sections} feedUrl={absoluteUrl(SITE_FEED_PATH)} />
      <AccountDeletedFlash />
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
