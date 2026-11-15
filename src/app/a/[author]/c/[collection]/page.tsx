import { ArrowLeftIcon, LibraryIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cardTitleClass, PoemCardFace } from "@/components/board/poem-card-face";
import { AuthorFeedLink } from "@/components/feeds/feed-link";
import { JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/components/ui/button";
import type { CollectionPage } from "@/lib/board-types";
import { CARD_H } from "@/lib/board-layout";
import { feedAlternates } from "@/lib/feed-links";
import { pluralCount } from "@/lib/plural";
import { absoluteUrl, BASE_OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { getCollectionPage } from "@/server/board-cache";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { OfflineIndicator } from "@/components/offline/offline-indicator";

/*
 * A collection's public page (docs/PLAN.md, Phase 14): its published poems in
 * reading order, numbered 1..n without drafts. Same shape as the author page:
 * a static shell, with the cached (BOARD_TAG) data behind Suspense.
 */

type Props = PageProps<"/a/[author]/c/[collection]">;

const collectionUrl = (c: Pick<CollectionPage, "authorSlug" | "slug">) => `/a/${c.authorSlug}/c/${c.slug}`;

/** The intro as one line for search snippets, else a generic line. */
function collectionDescription(c: CollectionPage) {
  const intro = c.intro?.replace(/\s+/g, " ").trim();
  if (intro) return intro.length > 160 ? `${intro.slice(0, 157).trimEnd()}…` : intro;
  return `A collection of ${pluralCount(c.poems.length, "poem")} by ${c.penName} on ${SITE_NAME}.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, collection } = await params;
  const c = await getCollectionPage(author, collection);
  if (!c) return { title: "Collection not found", robots: { index: false } };
  const url = collectionUrl(c);
  const title = `${c.title}: a collection by ${c.penName}`;
  const description = collectionDescription(c);
  return {
    title,
    description,
    alternates: { canonical: url, ...feedAlternates({ slug: c.authorSlug, penName: c.penName }) },
    authors: [{ name: c.penName, url: `/a/${c.authorSlug}` }],
    openGraph: { ...BASE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** schema.org: a CollectionPage about a CreativeWorkSeries of the poems. Titles only, never text. */
async function CollectionJsonLd({ params }: Pick<Props, "params">) {
  const { author, collection } = await params;
  const c = await getCollectionPage(author, collection);
  if (!c) return null;
  const languages = new Set(c.poems.map((p) => p.language));
  const shared = languages.size === 1 ? [...languages][0] : null;
  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    url: absoluteUrl(collectionUrl(c)),
    name: c.title,
    ...(c.intro && { description: c.intro }),
    mainEntity: {
      "@type": "CreativeWorkSeries",
      name: c.title,
      author: { "@type": "Person", name: c.penName, url: absoluteUrl(`/a/${c.authorSlug}`) },
      ...(shared && { inLanguage: shared }),
      hasPart: c.poems.map((p) => ({
        "@type": "CreativeWork",
        genre: "Poetry",
        name: p.title,
        url: absoluteUrl(`/p/${c.authorSlug}/${p.slug}`),
        position: p.part,
        isAccessibleForFree: p.visibility === "public",
        ...(p.language && { inLanguage: p.language }),
      })),
    },
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
  };
  return <JsonLd data={data} />;
}

export default function CollectionPublicPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
      {/* "You're offline · showing saved poems" (Phase 15 round 2). */}
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4 z-30" />
      <div className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-8">
          <Link href="/">
            <ArrowLeftIcon />
            Back to the board
          </Link>
        </Button>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" />}>
          <Collection params={params} />
        </Suspense>
        <Suspense>
          <CollectionJsonLd params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Collection({ params }: Pick<Props, "params">) {
  const { author, collection } = await params;
  const c = await getCollectionPage(author, collection);
  if (!c) notFound();
  const privateCount = c.poems.filter((p) => p.visibility === "private").length;

  return (
    <div className="grid gap-10">
      <OfflineMarker save kind="collection" title={c.title} author={c.penName} />
      <SaveForOffline path={`/a/${author}/c/${collection}`} />
      <header className="grid max-w-3xl gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <LibraryIcon className="size-4" aria-hidden />
          A collection by{" "}
          <Link href={`/a/${c.authorSlug}`} className="text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            {c.penName}
          </Link>
        </p>
        <h1 className="font-serif text-4xl leading-tight break-words sm:text-5xl">{c.title}</h1>
        {c.intro && <p className="text-lg leading-relaxed whitespace-pre-line text-muted-foreground">{c.intro}</p>}
        <p className="text-sm text-muted-foreground">
          {pluralCount(c.poems.length, "poem")}
          {privateCount > 0 && <> · {privateCount} password protected</>}
          {" · "}read in order
        </p>
      </header>

      <section aria-labelledby="collection-poems-heading" className="grid gap-5">
        <h2 id="collection-poems-heading" className="sr-only">
          Poems, in reading order
        </h2>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {c.poems.map((p) => (
            <li key={p.id} className="relative" data-part={p.part}>
              {/* The list's own numbering speaks the position; the chip is for the eye. */}
              <span
                aria-hidden
                className="absolute -top-2.5 left-4 z-20 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground tabular-nums"
              >
                {p.part}
              </span>
              <PoemCardFace
                className="relative"
                style={{ height: CARD_H }}
                isPrivate={p.visibility === "private"}
                excerpt={p.excerpt}
                lang={p.language}
                hasMore={p.hasMore}
                title={
                  <Link href={`/p/${c.authorSlug}/${p.slug}`} className={cardTitleClass}>
                    {p.title}
                    {p.visibility === "private" && <span className="sr-only"> (password protected)</span>}
                  </Link>
                }
              />
            </li>
          ))}
        </ol>
      </section>

      <AuthorFeedLink slug={c.authorSlug} penName={c.penName} />
    </div>
  );
}
