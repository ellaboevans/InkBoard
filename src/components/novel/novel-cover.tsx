import { cn } from "cn";
import { coverCss } from "@/lib/novel-cover";

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
        className,
      )}
      // The same tones as the link cards' cover (src/lib/novel-cover.ts).
      style={{
        background: coverCss("paper", hue),
        color: coverCss("ink", hue),
        boxShadow: `inset 6px 0 0 ${coverCss("spine", hue)}, 0 1px 2px oklch(0 0 0 / 0.12)`,
      }}
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
