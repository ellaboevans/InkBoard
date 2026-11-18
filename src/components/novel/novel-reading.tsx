"use client";

import { cn } from "cn";
import { useEffect } from "react";
import { rememberChapter, useReadingPlace } from "@/hooks/use-reading-place";
import { useSavedPages } from "@/lib/offline/saved-store";
import { continueIndex } from "@/lib/reading-place";

/*
 * "Where you stopped" on the novel and chapter pages (docs/PLAN.md, Phase
 * 23b). The store is only in this browser (src/lib/reading-place.ts). On the
 * server and while hydrating, useReadingPlace is null, so the HTML is the
 * same for every reader ("Start reading", no chapter marked) and the page
 * stays prerenderable; the saved place appears right after hydration.
 *
 * Chapter links are plain <a>s: every chapter is a full page load, starting
 * at its top (docs/research/novels.md §3).
 */

export type ChapterLink = {
  number: number;
  displayTitle: string;
  slug: string;
  /** "16 min" */
  time: string;
  /** "2 Oct", preformatted on the server (no time-zone mismatch); null if unknown. */
  date: string | null;
};

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-[18px] text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** "Start reading", or "Continue: Chapter n · Title" with a quiet "Start from the beginning". */
export function ContinueReading({ novelId, base, chapters }: { novelId: string; base: string; chapters: ChapterLink[] }) {
  const i = continueIndex(useReadingPlace(novelId), chapters);
  const first = chapters[0];
  const at = i === null ? null : chapters[i];
  return (
    <div data-continue-reading className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <a
        href={`${base}/${(at ?? first).slug}`}
        className={cn(buttonBase, "bg-primary text-primary-foreground hover:bg-primary/90 max-sm:flex-[1_1_100%]")}
      >
        {at ? (
          <span className="min-w-0 truncate">
            Continue: Chapter {at.number}
            {at.displayTitle !== `Chapter ${at.number}` && <> · {at.displayTitle}</>}
          </span>
        ) : (
          "Start reading"
        )}
      </a>
      {at && at !== first && (
        <a
          href={`${base}/${first.slug}`}
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Start from the beginning
        </a>
      )}
    </div>
  );
}

/**
 * The published chapters; the one this browser stopped at is marked, the ones
 * before it dimmed, and (Phase 24) the ones saved on this device for offline
 * reading say so.
 */
export function ChapterList({ novelId, base, chapters }: { novelId: string; base: string; chapters: ChapterLink[] }) {
  const at = continueIndex(useReadingPlace(novelId), chapters);
  const savedPages = useSavedPages();
  return (
    <ol className="border-t">
      {chapters.map((c, i) => {
        const here = i === at;
        const read = at !== null && i < at;
        const saved = savedPages.has(`${base}/${c.slug}`);
        return (
          <li key={c.slug}>
            <a
              href={`${base}/${c.slug}`}
              aria-current={here ? "step" : undefined}
              data-chapter-number={c.number}
              className={cn(
                "group grid min-h-11 grid-cols-[2.6rem_minmax(0,1fr)] items-baseline gap-x-3 border-b px-1 py-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]",
                here && "rounded-lg border-b-transparent bg-accent",
              )}
            >
              <span className={cn("text-[13px] text-muted-foreground tabular-nums", here && "font-semibold text-primary")}>
                {c.number}
              </span>
              <span className={cn("truncate font-serif text-[19px] leading-snug group-hover:underline", read && "text-muted-foreground")}>
                {c.displayTitle}
              </span>
              <span className="col-start-2 -mt-1 text-[13px] whitespace-nowrap text-muted-foreground sm:col-start-auto sm:mt-0">
                {here ? `You stopped here · ${c.time}` : [c.time, c.date].filter(Boolean).join(" · ")}
                {saved && <span data-saved-offline> · Saved offline</span>}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** Rendered by the chapter page: this browser now stops at this chapter of this novel. */
export function RememberChapter({ novelId, chapterSlug }: { novelId: string; chapterSlug: string }) {
  useEffect(() => rememberChapter(novelId, chapterSlug), [novelId, chapterSlug]);
  return null;
}
