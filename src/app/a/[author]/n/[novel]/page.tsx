import { ArrowLeftIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthorPicture } from "@/components/author/author-picture";
import { NovelCover } from "@/components/novel/novel-cover";
import { ChapterList, ContinueReading, type ChapterLink } from "@/components/novel/novel-reading";
import { SaveNovelOffline } from "@/components/novel/save-novel-offline";
import { FollowAuthorToggle } from "@/components/notifications/notifications-setting";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { JsonLd } from "@/components/seo/json-ld";
import { AuthorFeedLink, NovelFeedLink } from "@/components/feeds/feed-link";
import { feedAlternates } from "@/lib/feed-links";
import { SiteLinks } from "@/components/site-links";
import { Button } from "@/components/ui/button";
import { sectionHue } from "@/lib/board-layout";
import type { NovelPage } from "@/lib/board-types";
import { shortDuration } from "@/lib/novel-limits";
import { pluralCount } from "@/lib/plural";
import { languageName } from "@/lib/poem-languages";
import { novelDescription, novelJsonLd, novelPath } from "@/lib/novel-seo";
import { BASE_OPEN_GRAPH } from "@/lib/site";
import { getNovelPage } from "@/server/board-cache";

/*
 * A novel's public page (docs/PLAN.md, Phase 23b; docs/mockups/novels/
 * novel-page.html): the drawn cover, title, author, blurb, status, the
 * published chapters with their reading times, and "Start reading" /
 * "Continue: Chapter n" from this browser's saved place. A static shell with
 * the cached (BOARD_TAG) data behind Suspense; nothing here reads cookies,
 * and the saved place is read in the browser only (ContinueReading), so the
 * page is the same for everyone and is saved for offline reading (kind
 * "novel"). Its link card is opengraph-image.tsx; JSON-LD is a Book with its
 * published chapters (src/lib/novel-seo.ts).
 *
 * A private novel (Phase 25) shows all of this too (the owner's decision:
 * title, cover, blurb and chapter list are public), marked "Password
 * protected"; its chapter pages ask for the password. "Save this novel for
 * offline" is hidden for it (its chapters are never saved).
 */

type Props = PageProps<"/a/[author]/n/[novel]">;

const novelUrl = (n: Pick<NovelPage, "authorSlug" | "slug">) => novelPath(n.authorSlug, n.slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, novel } = await params;
  const n = await getNovelPage(author, novel);
  if (!n) return { title: "Novel not found", robots: { index: false } };
  const url = novelUrl(n);
  const title = `${n.title}: a novel by ${n.penName}`;
  const description = novelDescription(n);
  return {
    title,
    description,
    alternates: { canonical: url, ...feedAlternates({ slug: n.authorSlug, penName: n.penName }, { slug: n.slug, title: n.title }) },
    authors: [{ name: n.penName, url: `/a/${n.authorSlug}` }],
    openGraph: { ...BASE_OPEN_GRAPH, type: "book", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function NovelPublicPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
      {/* "You're offline · showing saved poems", as on the other reader pages. */}
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4 z-30" />
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/">
            <ArrowLeftIcon />
            Back to the board
          </Link>
        </Button>
        <Suspense fallback={<div className="mt-7 h-80 animate-pulse rounded-2xl bg-muted" />}>
          <Novel params={params} />
        </Suspense>
        {/* Static, in the shell: what InkBoard is, for readers arriving from a shared link. */}
        <SiteLinks className="mt-16 border-t pt-6" />
      </div>
    </main>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

async function Novel({ params }: Pick<Props, "params">) {
  const { author, novel } = await params;
  const n = await getNovelPage(author, novel);
  if (!n) notFound();
  const base = novelUrl(n);
  const lang = n.language ?? undefined;
  const chapters: ChapterLink[] = n.chapters.map((c) => ({
    number: c.number,
    displayTitle: c.displayTitle,
    slug: c.slug,
    time: shortDuration(c.readingMinutes),
    date: c.publishedAt ? dayFormat.format(new Date(c.publishedAt)) : null,
  }));
  // [lead-in, the part that stays on one line]: "updated" may wrap, "17 November 2026" doesn't.
  const language = languageName(n.language);
  const facts: [string, string][] = [
    ["", pluralCount(n.chapterCount, "chapter")],
    ["about ", shortDuration(n.readingMinutes)],
  ];
  if (language) facts.push(["in ", language]);
  if (n.updatedAt) facts.push(["updated ", longFormat.format(new Date(n.updatedAt))]);

  return (
    <>
      {/* Saved for offline reading, like the other reader pages (only rendered when the novel exists). */}
      <OfflineMarker save kind="novel" title={n.title} author={n.penName} />
      <SaveForOffline path={base} />
      <JsonLd data={novelJsonLd(n)} />
      <div className="mt-6 grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-[18px] gap-y-5 sm:mt-7 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-x-10">
        <NovelCover
          title={n.title}
          penName={n.penName}
          hue={sectionHue(n.editorId)}
          lang={n.language}
          coverKey={n.coverKey}
          width={220}
          sizes="(min-width: 640px) 220px, 112px"
          loading="eager"
          className="w-[112px] text-base sm:row-span-3 sm:w-[220px] sm:text-[30px]"
        />
        <div className="min-w-0">
          <p className="inline-flex items-center rounded-full border border-current px-2 py-px text-[11px] text-primary">
            Novel · {n.status}
          </p>
          <h1 lang={lang} className="mt-1.5 mb-3 font-serif text-[30px] leading-[1.08] tracking-[-0.01em] break-words sm:text-5xl">
            {n.title}
          </h1>
          <p className="flex items-center gap-2.5">
            <AuthorPicture picture={n.picture} size={32} loading="eager" className="size-8" />
            <span className="min-w-0">
              by{" "}
              <Link
                href={`/a/${n.authorSlug}`}
                className="underline underline-offset-4 focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {n.penName}
              </Link>
            </span>
          </p>
          <p data-novel-facts className="mt-2.5 text-sm text-muted-foreground">
            {facts.map(([lead, value], i) => (
              <span key={i}>
                {i > 0 && " · "}
                {lead}
                <span className="whitespace-nowrap">{value}</span>
              </span>
            ))}
          </p>
          {n.visibility === "private" && (
            <p data-novel-private className="mt-2.5 flex items-start gap-1.5 text-sm">
              <LockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="font-medium">Password protected.</span>{" "}
                <span className="text-muted-foreground">
                  {n.sharedPassword
                    ? `${n.penName}’s one password opens every chapter.`
                    : "One password opens every chapter."}
                </span>
              </span>
            </p>
          )}
        </div>
        {n.fullBlurb && (
          <p
            lang={lang}
            className="col-span-2 max-w-[34em] font-serif text-lg leading-relaxed whitespace-pre-line sm:col-span-1 sm:col-start-2 sm:text-[19px]"
          >
            {n.fullBlurb}
          </p>
        )}
        <div className="col-span-2 sm:col-span-1 sm:col-start-2">
          <ContinueReading novelId={n.id} base={base} chapters={chapters} />
        </div>
      </div>

      <section aria-labelledby="chapters-heading" id="chapters" className="mt-10 scroll-mt-6 sm:mt-14">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="chapters-heading" className="font-serif text-[28px] leading-tight">
            Chapters
          </h2>
          {/* Phase 24: the whole novel for a journey without data. Never a private novel's (Phase 25). */}
          {n.visibility === "public" && (
            <SaveNovelOffline novelId={n.id} novelPath={base} chapters={n.chapters.map((c) => ({ number: c.number, slug: c.slug }))} />
          )}
        </div>
        <ChapterList novelId={n.id} base={base} chapters={chapters} />
      </section>

      {/* Phase 24: every new chapter in a feed reader; the author's feed has their poems too. */}
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-1">
        <NovelFeedLink authorSlug={n.authorSlug} novelSlug={n.slug} />
        <AuthorFeedLink slug={n.authorSlug} penName={n.penName} className="min-h-11" />
      </div>
      {/* New chapters reach followers only (Phase 24); renders nothing where notifications aren't possible. */}
      <div className="mt-3">
        <FollowAuthorToggle slug={n.authorSlug} penName={n.penName} writesNovels />
      </div>
    </>
  );
}
