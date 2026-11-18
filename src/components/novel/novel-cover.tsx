import { cn } from "cn";
import { coverCss, coverSources } from "@/lib/novel-cover";
import { coverHeight } from "@/lib/photo-limits";

/**
 * A novel's cover, the one component every place draws it with (the book
 * card on the board and the author page, the novel page, the list view), so
 * "drawn or uploaded" is decided here only, like AuthorPicture for authors.
 *
 * The drawn cover (Phase 23b; docs/mockups/novels/): the title and the
 * author on a paper colour of the author's section hue, in a 2:3 book shape
 * with a spine. It's always rendered, and an uploaded cover (Phase 25,
 * `coverKey`) lies over it: so while the upload loads, or if it can't be read
 * (offline, removed while a page was cached), the drawn cover shows, never a
 * gap. Our own WebP copies with every width in `srcSet`, explicit width and
 * height (no layout shift). Decorative: the title is always also real text
 * next to it, so the cover is hidden from screen readers. Size it with a
 * width class and a font size; `width` is the CSS width it's drawn at (for
 * the attributes; `sizes` when that changes with the screen).
 */
export function NovelCover({
  title,
  penName,
  hue,
  lang,
  coverKey = null,
  width,
  sizes,
  loading,
  className,
}: {
  title: string;
  penName: string;
  /** sectionHue(editorId): the same colour as the author's shelf on the board. */
  hue: number;
  lang?: string | null;
  /** The uploaded cover's key, or null: the drawn cover alone. */
  coverKey?: string | null;
  /** CSS px wide (the largest it's drawn at when `sizes` is given). */
  width: number;
  sizes?: string;
  loading?: "lazy" | "eager";
  className?: string;
}) {
  const upload = coverKey ? coverSources(coverKey, width) : null;
  return (
    <div
      aria-hidden
      data-novel-cover={upload ? "uploaded" : "drawn"}
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
      {upload && (
        // eslint-disable-next-line @next/next/no-img-element -- our own processed WebP copies, already the right sizes
        <img
          src={upload.src}
          srcSet={upload.srcSet}
          sizes={sizes ?? `${width}px`}
          alt=""
          width={width}
          height={coverHeight(width)}
          loading={loading}
          decoding="async"
          draggable={false}
          data-cover-image=""
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </div>
  );
}
