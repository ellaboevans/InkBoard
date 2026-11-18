import { ChevronLeftIcon, LockOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProseText } from "@/components/novel/prose-text";
import { RememberChapter } from "@/components/novel/novel-reading";
import { ReadingSettingsBoot, ReadingSettingsControl } from "@/components/novel/reading-settings";
import { SharePassageButton } from "@/components/novel/share-passage-button";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { unlockNovelAction } from "@/components/poem/unlock-actions";
import { UnlockForm } from "@/components/poem/unlock-form";
import { JsonLd } from "@/components/seo/json-ld";
import { chapterPageAlternates } from "@/lib/feed-links";
import { SiteLinks } from "@/components/site-links";
import type { ReaderChapter } from "@/lib/board-types";
import { pluralCount } from "@/lib/plural";
import { chapterDescription, chapterJsonLd, chapterPath, novelPath } from "@/lib/novel-seo";
import { absoluteUrl, BASE_OPEN_GRAPH } from "@/lib/site";
import { getReaderChapter } from "@/server/board-cache";
import { getUnlockedChapterBody } from "@/server/unlock-cookie";

/*
 * A published chapter (docs/PLAN.md, Phase 23b; docs/mockups/novels/
 * chapter-phone.html): always a full page, never the poem overlay. A slim
 * sticky bar back to the novel with "Chapter n of m", the text through
 * ProseText at a reading measure (34em, about 65 characters) and size (19 px
 * on phones, 18 px under 360 px, 21 px from 768 px; line height 1.7), then
 * next / previous chapter and "All chapters". Links are plain <a>s: each
 * chapter is its own page load, starting at the top.
 *
 * "Text settings" (Phase 26) in the sticky bar: the reader's size and font
 * for the chapter text only, kept in this browser, applied by an inline
 * script in the static shell before the text paints (src/lib/reading-settings.ts).
 *
 * `lang` is the novel's language, on the chapter's title and text only (the
 * bar, kicker and links stay in the UI's English), like a poem's.
 *
 * Opening it records this chapter as where this browser stopped in the
 * novel (RememberChapter, localStorage only). Saved for offline reading
 * (kind "chapter", 60 kept); its link card (opengraph-image.tsx) shows the
 * novel's cover and the chapter's title, never its text. JSON-LD: a Chapter
 * that isPartOf the Book (src/lib/novel-seo.ts).
 *
 * A private novel (Phase 25, N1): the cached loader holds no text (body is
 * null), so the bar, title, reading time and chapter links render as usual
 * and the text's place holds the unlock form, behind its own Suspense
 * boundary (it reads the unlock cookie). The text comes only from
 * getUnlockedChapterBody after the grant check, and the page is never saved
 * for offline reading (save={false}), unlocked or not.
 */

type Props = PageProps<"/a/[author]/n/[novel]/[chapter]">;

const novelUrl = (c: ReaderChapter) => novelPath(c.authorSlug, c.novel.slug);

/** The chapter's heading: "Chapter 4" when it has no title of its own. */
const hasOwnTitle = (c: ReaderChapter) => c.title.trim() !== "";
/** A neighbour's title is the writer's (in the novel's language), not our "Chapter n". */
const ownTitle = (c: { number: number; displayTitle: string }) => c.displayTitle !== `Chapter ${c.number}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, novel, chapter } = await params;
  const c = await getReaderChapter(author, novel, chapter);
  if (!c) return { title: "Chapter not found", robots: { index: false } };
  const url = chapterPath(c.authorSlug, c.novel.slug, c.slug);
  const title = hasOwnTitle(c)
    ? `${c.displayTitle} · ${c.novel.title}, chapter ${c.number}`
    : `${c.novel.title}, chapter ${c.number}`;
  // The chapter's first lines, as plain text (stripProse).
  const description = chapterDescription(c);
  return {
    title,
    description,
    alternates: chapterPageAlternates(c),
    authors: [{ name: c.penName, url: `/a/${c.authorSlug}` }],
    openGraph: { ...BASE_OPEN_GRAPH, type: "article", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function ChapterPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
      {/* Phase 26: the reader's text size and font, applied before the text paints (src/lib/reading-settings.ts). */}
      <ReadingSettingsBoot />
      {/* "You're offline · showing saved poems", as on the other reader pages. */}
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4 z-30" />
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
  const isPrivate = c.novel.visibility === "private";

  return (
    <>
      {/* Saved for offline reading (only rendered for a published chapter: drafts and 404s never are);
          a private novel's chapter never, even once unlocked. */}
      {isPrivate ? (
        <OfflineMarker save={false} />
      ) : (
        <>
          <OfflineMarker
            save
            kind="chapter"
            title={hasOwnTitle(c) ? `${c.novel.title} · Chapter ${c.number}: ${c.displayTitle}` : `${c.novel.title} · Chapter ${c.number}`}
            author={c.penName}
          />
          <SaveForOffline path={chapterPath(c.authorSlug, c.novel.slug, c.slug)} />
          <RememberChapter novelId={c.novel.id} chapterSlug={c.slug} />
        </>
      )}
      <JsonLd data={chapterJsonLd(c)} />

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
          {/* Text size and font (Phase 26): always in reach in the sticky bar, never over the text. */}
          <ReadingSettingsControl />
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
        {isPrivate || c.body === null ? (
          // Per-reader: reads the unlock cookie, so it streams in separately.
          <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" />}>
            <PrivateChapter chapter={c} lang={lang} />
          </Suspense>
        ) : (
          <div lang={lang} data-chapter-text className="chapter-prose">
            <ProseText text={c.body} />
          </div>
        )}
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
          {/* Phase 25: a public novel's passages only, never a private one's, unlocked or not (an owner's decision). */}
          {!isPrivate && c.body !== null && (
            <SharePassageButton
              authorSlug={c.authorSlug}
              novelSlug={c.novel.slug}
              chapterSlug={c.slug}
              novelTitle={c.novel.title}
              chapterNumber={c.number}
              penName={c.penName}
              chapterUrl={absoluteUrl(chapterPath(c.authorSlug, c.novel.slug, c.slug))}
              className={linkClass}
            />
          )}
        </div>
      </nav>
    </>
  );
}

/** A private novel's chapter text after unlocking, else the unlock form (English UI: `lang` goes on the text only). */
async function PrivateChapter({ chapter: c, lang }: { chapter: ReaderChapter; lang: string | undefined }) {
  const body = await getUnlockedChapterBody(c.authorSlug, c.novel.slug, c.slug);
  if (body !== null) {
    return (
      <>
        <p className="mb-6 flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
          <LockOpenIcon className="size-3.5" aria-hidden />
          Unlocked on this device
        </p>
        <div lang={lang} data-chapter-text className="chapter-prose">
          <ProseText text={body} />
        </div>
        <RememberChapter novelId={c.novel.id} chapterSlug={c.slug} />
      </>
    );
  }
  return (
    <div data-chapter-locked className="font-sans text-base leading-normal">
      <UnlockForm
        kind="novel"
        action={unlockNovelAction.bind(null, c.authorSlug, c.novel.slug)}
        penName={c.penName}
        sharedPassword={c.novel.sharedPassword}
      />
    </div>
  );
}
