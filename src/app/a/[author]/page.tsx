import { ArrowLeftIcon, ExternalLinkIcon, LibraryIcon, PinIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cardTitleClass, PoemCardFace } from "@/components/board/poem-card-face";
import { Button } from "@/components/ui/button";
import { SiteLinks } from "@/components/site-links";
import { ReportLink } from "@/components/report/report-link";
import { AuthorPicture } from "@/components/author/author-picture";
import { CARD_H, sectionHue } from "@/lib/board-layout";
import { BookCardFace, novelLinkSuffix } from "@/components/novel/book-card-face";
import { JsonLd } from "@/components/seo/json-ld";
import { AuthorFeedLink } from "@/components/feeds/feed-link";
import { FollowAuthorToggle } from "@/components/notifications/notifications-setting";
import { authorPageAlternates } from "@/lib/feed-links";
import { absoluteUrl, BASE_OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { getAuthorPage } from "@/server/board-cache";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { pluralCount } from "@/lib/plural";

type Props = PageProps<"/a/[author]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author } = await params;
  const a = await getAuthorPage(author);
  if (!a) return { title: "Author not found", robots: { index: false } };
  const url = `/a/${a.slug}`;
  const title = `${a.penName}: poems`;
  const description = a.tagline ?? `Poems by ${a.penName} on ${SITE_NAME}.`;
  return {
    title,
    description,
    alternates: authorPageAlternates(a),
    openGraph: { ...BASE_OPEN_GRAPH, type: "profile", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** schema.org Person for the author; profile fields only, never the email. */
async function AuthorJsonLd({ params }: Pick<Props, "params">) {
  const { author } = await params;
  const a = await getAuthorPage(author);
  if (!a) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(`/a/${a.slug}`),
    mainEntity: {
      "@type": "Person",
      name: a.penName,
      ...(a.tagline && { description: a.tagline }),
      ...(a.links.length > 0 && { sameAs: a.links }),
    },
  };
  return <JsonLd data={data} />;
}

/** An author's public page: who they are, their links, and their poems. */
export default function AuthorPublicPage({ params }: Props) {
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
          <Author params={params} />
        </Suspense>
        <Suspense>
          <AuthorJsonLd params={params} />
        </Suspense>
        {/* Static, in the shell: what InkBoard is, for readers arriving from a shared link. */}
        <SiteLinks className="mt-16 border-t pt-6" />
      </div>
    </main>
  );
}

const yearFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

/** "example.com/me" for display; the href stays the full validated URL. */
function linkLabel(href: string) {
  const u = new URL(href);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.hostname.replace(/^www\./, "")}${path}`;
}

async function Author({ params }: Pick<Props, "params">) {
  const { author } = await params;
  const a = await getAuthorPage(author);
  if (!a) notFound();
  const first = a.poems.reduce<string | null>(
    (min, p) => (p.publishedAt && (!min || p.publishedAt < min) ? p.publishedAt : min),
    null,
  );
  const privateCount = a.poems.filter((p) => p.visibility === "private").length;

  return (
    <div className="grid gap-12">
      <OfflineMarker save kind="author" title={a.penName} />
      <SaveForOffline path={`/a/${author}`} />
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <AuthorPicture picture={a.picture} size={112} loading="eager" className="size-24 sm:size-28" />
        <div className="grid min-w-0 gap-3">
          <div>
            <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{a.penName}</h1>
            {a.tagline && <p className="mt-2 text-lg text-muted-foreground">{a.tagline}</p>}
          </div>
          <p className="text-sm text-muted-foreground">
            {/* "1 novel · 3 poems", "1 novel", "3 poems": no "0 poems" for a novelist. */}
            {[
              a.novels.length > 0 && pluralCount(a.novels.length, "novel"),
              (a.poems.length > 0 || a.novels.length === 0) && pluralCount(a.poems.length, "poem"),
            ]
              .filter(Boolean)
              .join(" · ")}
            {privateCount > 0 && <> · {privateCount} password protected</>}
            {first && <> · on InkBoard since {yearFormat.format(new Date(first))}</>}
          </p>
          <div className="grid justify-items-start gap-2">
            <AuthorFeedLink slug={a.slug} penName={a.penName} />
            {/* Phase 18 round 2: renders nothing where notifications aren't possible. */}
            <FollowAuthorToggle slug={a.slug} penName={a.penName} writesNovels={a.novels.length > 0} />
          </div>
          {a.bio && <p className="max-w-2xl leading-relaxed whitespace-pre-line">{a.bio}</p>}
          {a.links.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={`${a.penName}'s links`}>
              {a.links.map((href) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    // Editor-supplied: no referrer, no ranking credit, no window.opener.
                    rel="me nofollow ugc noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {linkLabel(href)}
                    <ExternalLinkIcon className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {a.novels.length > 0 && (
        <section aria-labelledby="novels-heading" className="grid gap-5">
          <h2 id="novels-heading" className="font-serif text-2xl">
            Novels
          </h2>
          {/* minmax(0,1fr): a long title must truncate, not widen the page on phones. */}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {a.novels.map((n) => (
              <li key={n.id} className="relative">
                <BookCardFace
                  className="relative"
                  style={{ height: CARD_H }}
                  novel={n}
                  penName={a.penName}
                  hue={sectionHue(a.editorId)}
                  title={
                    <Link href={`/a/${a.slug}/n/${n.slug}`} className={cardTitleClass}>
                      {n.title}
                      <span className="sr-only">{novelLinkSuffix(n)}</span>
                    </Link>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {a.collections.length > 0 && (
        <section aria-labelledby="collections-heading" className="grid gap-4">
          <h2 id="collections-heading" className="font-serif text-2xl">
            Collections
          </h2>
          {/* minmax(0,1fr): grid items default to their content's width, so a long title widened the page. */}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            {a.collections.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/a/${a.slug}/c/${c.slug}`}
                  className="flex h-full items-start gap-3 rounded-xl border bg-card p-4 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <LibraryIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate font-serif text-lg">{c.title}</span>
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{pluralCount(c.poemCount, "poem")}</span>
                    </span>
                    {c.intro && <span className="line-clamp-2 text-sm text-muted-foreground">{c.intro}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A novelist with no poems yet gets no empty "Poems" section. */}
      {(a.poems.length > 0 || a.novels.length === 0) && (
        <section aria-labelledby="poems-heading" className="grid gap-5">
          <h2 id="poems-heading" className="font-serif text-2xl">
            Poems
          </h2>
          {a.poems.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-muted-foreground">
              No published poems yet.
            </p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {a.poems.map((p) => (
                <li key={p.id} className="relative">
                  {p.pinned && (
                    <span className="absolute -top-2.5 left-4 z-20 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                      <PinIcon className="size-3" aria-hidden />
                      Pinned
                    </span>
                  )}
                  <PoemCardFace
                    className="relative"
                    style={{ height: CARD_H }}
                    isPrivate={p.visibility === "private"}
                    excerpt={p.excerpt}
                    lang={p.language}
                    collection={p.collection}
                    hasMore={p.hasMore}
                    title={
                      <Link href={`/p/${a.slug}/${p.slug}`} className={cardTitleClass}>
                        {p.title}
                        {p.pinned && <span className="sr-only"> (pinned)</span>}
                        {p.visibility === "private" && <span className="sr-only"> (password protected)</span>}
                      </Link>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <footer className="-mb-8 border-t pt-4">
        <ReportLink target={{ kind: "author", author: a.slug }} />
      </footer>
    </div>
  );
}
