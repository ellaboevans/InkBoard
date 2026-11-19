import { LockIcon } from "lucide-react";
import Link from "next/link";
import { AuthorPicture } from "@/components/author/author-picture";
import { cardTitleClass } from "@/components/board/poem-card-face";
import { sectionHue } from "@/lib/board-layout";
import type { SerialNovel } from "@/lib/board-types";
import { shortDuration } from "@/lib/novel-limits";
import { novelPath } from "@/lib/novel-seo";
import { pluralCount } from "@/lib/plural";
import { languageName } from "@/lib/poem-languages";
import { novelLinkSuffix } from "./book-card-face";
import { NovelCover } from "./novel-cover";
import { SerialContinue } from "./novel-reading";

/*
 * A novel on /novels (docs/PLAN.md, Phase 29). Like the book cards, the title
 * link stretches over the whole card (cardTitleClass) and names it, with
 * novelLinkSuffix; "Continue: Chapter n" (after hydration) sits above it.
 *
 * Dates are absolute ("17 November 2026", UTC) and formatted on the server:
 * the page is cached and prerendered, so "3 days ago" would go stale in the
 * cache and differ between server and browser.
 */
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function serialDate(iso: string | null) {
  return iso ? dateFormat.format(new Date(iso)) : null;
}

export function SerialCard({ novel: n }: { novel: SerialNovel }) {
  const lang = n.language ?? undefined;
  const base = novelPath(n.authorSlug, n.slug);
  const language = languageName(n.language);
  const date = serialDate(n.latest.publishedAt);
  const ownTitle = n.latest.title.trim() !== "";
  return (
    <article
      data-card=""
      data-serial={n.slug}
      className="relative grid grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-2xl border bg-card p-4 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_16px_-8px_oklch(0_0_0/0.12)] transition-[box-shadow,translate] duration-200 hover:-translate-y-0.5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring sm:grid-cols-[96px_minmax(0,1fr)]"
    >
      <NovelCover
        title={n.title}
        penName={n.penName}
        hue={sectionHue(n.editorId)}
        lang={lang}
        coverKey={n.coverKey}
        width={96}
        sizes="(min-width: 640px) 96px, 72px"
        loading="lazy"
        className="w-[72px] self-start text-[12px] sm:w-[96px] sm:text-[14px]"
      />
      <div className="flex min-w-0 flex-col">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">
          Novel
          {language && (
            <span className="rounded-full border px-2 py-0.5 font-normal tracking-normal text-muted-foreground normal-case">{language}</span>
          )}
          {n.visibility === "private" && (
            <span
              data-lock-badge=""
              title="Password protected"
              className="flex size-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
              aria-hidden
            >
              <LockIcon className="size-3" />
            </span>
          )}
        </p>
        <h3 lang={lang} className="mt-0.5 font-serif text-xl leading-snug break-words">
          <Link href={base} className={cardTitleClass}>
            {n.title}
            <span className="sr-only">{novelLinkSuffix(n)}</span>
          </Link>
        </h3>
        <p className="mt-1 flex min-w-0 items-center gap-2 text-sm">
          <AuthorPicture picture={n.picture} size={20} className="size-5 shrink-0" />
          <span className="truncate">by {n.penName}</span>
        </p>
        <p data-serial-latest className="mt-2 text-sm">
          <span className="text-muted-foreground">Latest: </span>
          Chapter {n.latest.number}
          {ownTitle && (
            <>
              {" · "}
              <span lang={lang}>{n.latest.title}</span>
            </>
          )}
          {date && <span className="text-muted-foreground"> · {date}</span>}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {pluralCount(n.chapterCount, "chapter")} · about {shortDuration(n.readingMinutes)}
        </p>
        {n.blurb && (
          <p lang={lang} className="mt-2 line-clamp-2 font-serif text-sm leading-[1.45] text-muted-foreground">
            {n.blurb}
          </p>
        )}
        <SerialContinue novelId={n.id} base={base} chapterSlugs={n.chapterSlugs} />
      </div>
    </article>
  );
}
