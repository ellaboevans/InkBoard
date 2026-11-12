import { ArrowLeftIcon, ExternalLinkIcon, PinIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cardTitleClass, PoemCardFace } from "@/components/board/poem-card-face";
import { Button } from "@/components/ui/button";
import { avatarIdFor, avatarUrl } from "@/lib/avatars";
import { CARD_H } from "@/lib/board-layout";
import { getAuthorPage } from "@/server/board-cache";

type Props = PageProps<"/a/[author]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author } = await params;
  const a = await getAuthorPage(author);
  if (!a) return { title: "Author not found" };
  return { title: a.penName, description: a.tagline ?? `Poems by ${a.penName} on PoemHub.` };
}

/** An author's public page: who they are, their links, and their poems. */
export default function AuthorPublicPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
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
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from our own route */}
        <img
          src={avatarUrl(avatarIdFor({ id: a.editorId, avatar: a.avatar }))}
          alt=""
          width={112}
          height={112}
          className="size-24 shrink-0 rounded-full bg-secondary sm:size-28"
        />
        <div className="grid min-w-0 gap-3">
          <div>
            <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{a.penName}</h1>
            {a.tagline && <p className="mt-2 text-lg text-muted-foreground">{a.tagline}</p>}
          </div>
          <p className="text-sm text-muted-foreground">
            {a.poems.length} {a.poems.length === 1 ? "poem" : "poems"}
            {privateCount > 0 && <> · {privateCount} password protected</>}
            {first && <> · on PoemHub since {yearFormat.format(new Date(first))}</>}
          </p>
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
    </div>
  );
}
