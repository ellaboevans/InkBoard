import { cn } from "cn";

/**
 * The drawn cover (docs/PLAN.md, Phase 23b; docs/mockups/novels/): the title
 * and the author on a paper colour of the author's section hue, in a 2:3
 * book shape with a spine. Uploaded covers come later. Decorative: the title
 * is always also real text next to it, so the cover is hidden from screen
 * readers. Size it with a width and a font size; everything else follows.
 */
export function NovelCover({
  title,
  penName,
  hue,
  lang,
  className,
}: {
  title: string;
  penName: string;
  /** sectionHue(editorId): the same colour as the author's shelf on the board. */
  hue: number;
  lang?: string | null;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      data-novel-cover=""
      className={cn(
        "relative flex aspect-[2/3] shrink-0 flex-col justify-between overflow-hidden rounded-[4px_8px_8px_4px] py-[12%] pr-[10%] pl-[14%]",
        "bg-[oklch(0.9_0.05_var(--cover-hue))] text-[oklch(0.3_0.08_var(--cover-hue))]",
        "shadow-[inset_6px_0_0_oklch(0.82_0.06_var(--cover-hue)),0_1px_2px_oklch(0_0_0/0.12)]",
        className,
      )}
      style={{ ["--cover-hue" as string]: hue }}
    >
      <div className="min-w-0">
        <div lang={lang ?? undefined} className="line-clamp-5 font-serif leading-[1.05] [overflow-wrap:anywhere]">
          {title}
        </div>
        <div className="my-[8%] h-0.5 w-[32%] bg-current opacity-60" />
      </div>
      <div className="truncate text-[0.62em] tracking-[0.06em] uppercase opacity-85">{penName}</div>
    </div>
  );
}
