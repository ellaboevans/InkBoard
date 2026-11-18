import { cn } from "cn";
import type { BoardNovel } from "@/lib/board-types";
import { languageName } from "@/lib/poem-languages";
import { pluralCount } from "@/lib/plural";
import { NovelCover } from "./novel-cover";

/** "12 chapters · ongoing": published chapters only. */
export function novelFacts(novel: Pick<BoardNovel, "chapterCount" | "status">) {
  return `${pluralCount(novel.chapterCount, "chapter")} · ${novel.status}`;
}

/**
 * A novel as a card (docs/PLAN.md, Phase 23b; docs/mockups/novels/board.html):
 * one ordinary card slot (CARD_W × CARD_H) on the board, the same on the
 * author page. Like PoemCardFace, `title` is the interactive element: give it
 * `cardTitleClass` so it stretches over the whole card and names it.
 */
export function BookCardFace({
  novel,
  title,
  penName,
  hue,
  className,
  style,
}: {
  novel: BoardNovel;
  title: React.ReactNode;
  penName: string;
  hue: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const lang = novel.language ?? undefined;
  return (
    <div
      data-card=""
      data-book-card=""
      className={cn(
        "grid grid-cols-[84px_minmax(0,1fr)] gap-3.5 overflow-hidden rounded-2xl border bg-card p-3.5 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_16px_-8px_oklch(0_0_0/0.12)] transition-[opacity,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_oklch(0_0_0/0.08),0_12px_28px_-12px_oklch(0_0_0/0.25)] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring",
        className,
      )}
      style={style}
    >
      <NovelCover title={novel.title} penName={penName} hue={hue} lang={lang} className="w-[84px] self-start text-[13px]" />
      <div className="flex min-w-0 flex-col">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">
          Novel
          {languageName(lang) && (
            <span className="rounded-full border px-2 py-0.5 font-normal tracking-normal text-muted-foreground normal-case">
              {languageName(lang)}
            </span>
          )}
        </p>
        <h3 lang={lang} className="mt-0.5 min-w-0 font-serif text-[19px] leading-snug">
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{novelFacts(novel)}</p>
        {novel.blurb && (
          <p lang={lang} className="mt-2 line-clamp-3 font-serif text-sm leading-[1.45] text-muted-foreground">
            {novel.blurb}
          </p>
        )}
      </div>
    </div>
  );
}
