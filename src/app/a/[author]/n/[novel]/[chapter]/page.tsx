import { ChevronLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProseText } from "@/components/novel/prose-text";
import { RememberChapter } from "@/components/novel/novel-reading";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SiteLinks } from "@/components/site-links";
import type { ReaderChapter } from "@/lib/board-types";
import { pluralCount } from "@/lib/plural";
import { BASE_OPEN_GRAPH } from "@/lib/site";
import { getReaderChapter } from "@/server/board-cache";

/*
 * A published chapter (docs/PLAN.md, Phase 23b; docs/mockups/novels/
 * chapter-phone.html): always a full page, never the poem overlay. A slim
 * sticky bar back to the novel with "Chapter n of m", the text through
 * ProseText at a reading measure (34em, about 65 characters) and size (19 px
 * on phones, 18 px under 360 px, 21 px from 768 px; line height 1.7), then
 * next / previous chapter and "All chapters". Links are plain <a>s: each
 * chapter is its own page load, starting at the top.
 *
 * `lang` is the novel's language, on the chapter's title and text only (the
 * bar, kicker and links stay in the UI's English), like a poem's.
 *
 * Opening it records this chapter as where this browser stopped in the
 * novel (RememberChapter, localStorage only). Not saved offline yet.
 */

type Props = PageProps<"/a/[author]/n/[novel]/[chapter]">;

const novelUrl = (c: ReaderChapter) => `/a/${c.authorSlug}/n/${c.novel.slug}`;

/** The chapter's heading: "Chapter 4" when it has no title of its own. */
const hasOwnTitle = (c: ReaderChapter) => c.title.trim() !== "";
/** A neighbour's title is the writer's (in the novel's language), not our "Chapter n". */
const ownTitle = (c: { number: number; displayTitle: string }) => c.displayTitle !== `Chapter ${c.number}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, novel, chapter } = await params;
  const c = await getReaderChapter(author, novel, chapter);
  if (!c) return { title: "Chapter not found", robots: { index: false } };
  const url = `${novelUrl(c)}/${c.slug}`;
  const title = hasOwnTitle(c)
    ? `${c.displayTitle} · ${c.novel.title}, chapter ${c.number}`
    : `${c.novel.title}, chapter ${c.number}`;
  const description = `Chapter ${c.number} of ${c.novel.title}, a novel by ${c.penName}.`;
  return {
    title,
    description,
    alternates: { canonical: url },
    authors: [{ name: c.penName, url: `/a/${c.authorSlug}` }],
    openGraph: { ...BASE_OPEN_GRAPH, type: "article", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function ChapterPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
      <Suspense fallback={<ChapterSkeleton />}>
        <Chapter params={params} />
      </Suspense>
      <div className="mx-auto max-w-[calc(34*21px)] px-5 pb-10 sm:px-6">
        <SiteLinks className="border-t pt-6" />
      </div>
    </main>
  );
}

function ChapterSkeleton() {
  return (
    <div aria-hidden className="mx-auto max-w-[34em] px-5 py-10 sm:px-6">
      <div className="h-10 w-2/3 animate-pulse rounded-lg bg-muted" />
      <div className="mt-8 h-96 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

const linkClass =
  "inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

async function Chapter({ params }: Pick<Props, "params">) {
  const { author, novel, chapter } = await params;
  const c = await getReaderChapter(author, novel, chapter);
  if (!c) notFound();
  const base = novelUrl(c);
  const lang = c.novel.language ?? undefined;

  return (
    <>
      {/* Not saved for offline reading yet (Phase 23b): the next round adds the chapter kind. */}
      <OfflineMarker save={false} />
      <RememberChapter novelId={c.novel.id} chapterSlug={c.slug} />

      <div className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b bg-background/92 backdrop-blur-md">
        <nav aria-label="Novel" className="mx-auto flex min-h-[52px] max-w-[calc(34*21px)] items-center gap-2.5 px-4 py-1">
          <a
            href={base}
            className="-ml-1 flex min-h-11 min-w-0 items-center gap-1.5 rounded-md pr-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeftIcon className="size-4 shrink-0" aria-hidden />
            <span lang={lang} className="truncate font-serif text-base">
              {c.novel.title}
            </span>
          </a>
          <span data-chapter-of className="ml-auto shrink-0 text-[13px] whitespace-nowrap text-muted-foreground">
            Chapter {c.number} of {c.of}
          </span>
        </nav>
        {/* How far through the chapter: scroll-driven where supported (globals.css), nothing elsewhere. */}
        <div aria-hidden className="chapter-progress h-[3px] bg-secondary">
          <span className="block h-full origin-left bg-primary" />
        </div>
      </div>

      <article className="mx-auto max-w-[34em] px-5 pt-7 pb-4 font-serif text-[19px] leading-[1.7] max-[359px]:text-lg sm:px-6 sm:pt-10 md:text-[21px]">
        <header className="mb-7 font-sans sm:mb-9">
          {hasOwnTitle(c) && (
            <p className="text-[13px] font-semibold tracking-[0.06em] text-primary uppercase">Chapter {c.number}</p>
          )}
          <h1 lang={hasOwnTitle(c) ? lang : undefined} className="mt-2 mb-2.5 font-serif text-[32px] leading-[1.12] break-words sm:text-[40px]">
            {c.displayTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {c.penName} · about {pluralCount(Math.max(1, c.readingMinutes), "minute")}
          </p>
        </header>
        <div lang={lang} data-chapter-text className="chapter-prose">
          <ProseText text={c.body} />
        </div>
      </article>

      <nav aria-label="Chapters" className="mx-auto max-w-[calc(34*21px)] px-5 pt-2 pb-12 sm:px-6 sm:pb-16">
        {c.next ? (
          <a
            href={`${base}/${c.next.slug}`}
            rel="next"
            className="grid min-h-16 gap-0.5 rounded-xl bg-primary px-[18px] py-4 text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="text-xs tracking-[0.06em] uppercase opacity-85">Next chapter</span>
            <span className="font-serif text-[22px] leading-tight">
              <span className="tabular-nums">{c.next.number}</span> ·{" "}
              <span lang={ownTitle(c.next) ? lang : undefined}>{c.next.displayTitle}</span>
            </span>
          </a>
        ) : (
          <p className="rounded-xl border bg-card px-[18px] py-4 text-muted-foreground">
            {c.novel.status === "complete" ? "The end." : "That’s the latest chapter. More are on the way."}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm">
          {c.prev ? (
            <a href={`${base}/${c.prev.slug}`} rel="prev" className={linkClass}>
              {/* One span: a flex container would trim the spaces around "·". */}
              <span>
                <span aria-hidden>←&nbsp;</span>
                <span className="sr-only">Previous chapter: </span>
                {c.prev.number} · <span lang={ownTitle(c.prev) ? lang : undefined}>{c.prev.displayTitle}</span>
              </span>
            </a>
          ) : (
            <span />
          )}
          <a href={`${base}#chapters`} className={linkClass}>
            All chapters
          </a>
        </div>
      </nav>
    </>
  );
}
