import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SerialCard } from "@/components/novel/serial-card";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { JsonLd } from "@/components/seo/json-ld";
import { SiteLinks } from "@/components/site-links";
import { Button } from "@/components/ui/button";
import type { SerialNovel } from "@/lib/board-types";
import { serialsPageAlternates } from "@/lib/feed-links";
import { novelPath } from "@/lib/novel-seo";
import { absoluteUrl, BASE_OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { getSerialsPage } from "@/server/board-cache";

/*
 * "Ongoing serials" (docs/PLAN.md, Phase 29): every novel readers can see,
 * still being written first, then finished, each most recently updated first
 * (by its latest released chapter). A static shell with the cached
 * (BOARD_TAG, release-aware) data behind Suspense; nothing here reads cookies,
 * and "Continue: Chapter n" comes from this browser only, after hydration, so
 * the page is prerendered and the same for everyone. Saved for offline
 * reading as kind "page", like /about.
 */

const title = "Novels on InkBoard";
const description = "Serial novels still being written, most recently updated first, and the finished ones below.";

export const metadata: Metadata = {
  title,
  description,
  alternates: serialsPageAlternates(),
  openGraph: { ...BASE_OPEN_GRAPH, type: "website", url: "/novels", title, description },
  twitter: { card: "summary_large_image", title, description },
};

export default function NovelsPage() {
  return (
    <main className="flex-1 bg-background">
      <OfflineMarker save kind="page" title={title} />
      <SaveForOffline path="/novels" />
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4 z-30" />
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/">
            <ArrowLeftIcon />
            Back to the board
          </Link>
        </Button>
        <h1 className="mt-6 font-serif text-4xl leading-tight sm:text-5xl">Novels</h1>
        <p className="mt-3 max-w-[36em] text-muted-foreground">
          Serials on {SITE_NAME}, chapter by chapter: the ones still being written come first, the most recently updated at the top.
        </p>
        <Suspense fallback={<div className="mt-10 h-80 animate-pulse rounded-2xl bg-muted" />}>
          <Serials />
        </Suspense>
        <SiteLinks className="mt-16 border-t pt-6" />
      </div>
    </main>
  );
}

async function Serials() {
  const { ongoing, complete } = await getSerialsPage();
  const featured = [...ongoing, ...complete]
    .filter((n) => n.featuredAt)
    .sort((a, b) => (a.featuredAt! < b.featuredAt! ? 1 : a.featuredAt! > b.featuredAt! ? -1 : 0));
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: title,
          description,
          url: absoluteUrl("/novels"),
          isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
          hasPart: [...ongoing, ...complete].map((n) => ({ "@type": "Book", name: n.title, url: absoluteUrl(novelPath(n.authorSlug, n.slug)) })),
        }}
      />
      {/* Phase 33: the owner's featured novels first, newest featured first (only while readers can see them). */}
      {featured.length > 0 && <SerialSection id="featured" heading="Featured" novels={featured} empty="" />}
      <SerialSection id="ongoing" heading="Still being written" novels={ongoing} empty="No serial is being written right now." />
      <SerialSection id="finished" heading="Finished" novels={complete} empty="No novel is finished yet." />
    </>
  );
}

function SerialSection({ id, heading, novels, empty }: { id: string; heading: string; novels: SerialNovel[]; empty: string }) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id} data-serials={id} className="mt-10 scroll-mt-6">
      <h2 id={`${id}-heading`} className="mb-4 flex items-baseline gap-2.5 font-serif text-[28px] leading-tight">
        {heading}
        <span className="font-sans text-base text-muted-foreground">{novels.length}</span>
      </h2>
      {novels.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-5 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          {novels.map((n) => (
            <li key={n.id} className="grid">
              <SerialCard novel={n} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
