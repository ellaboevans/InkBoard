import { cn } from "cn";
import { LockIcon } from "lucide-react";
import { PoemText } from "@/components/poem/poem-text";
import { languageName } from "@/lib/poem-languages";

/**
 * How a poem looks as a card on the board. Shared by the board canvas and the
 * editor's live preview, so the preview can't drift from the real thing.
 *
 * `title` is the interactive element (a link on the board, a button in the
 * preview). Give it `cardTitleClass` so it stretches over the whole card:
 * its ::after covers the card with z-10, because the excerpt's mask and the
 * redacted lines' opacity create stacking contexts that would otherwise paint
 * over it and swallow clicks. The accessible name stays the visible title
 * (WCAG 2.5.3), and the excerpt is plain text screen readers can read.
 */
export const cardTitleClass =
  "line-clamp-2 text-left outline-none after:absolute after:inset-0 after:z-10 after:rounded-2xl after:content-['']";

export function PoemCardFace({
  title,
  isPrivate,
  excerpt,
  hasMore,
  lang,
  className,
  style,
  ...rest
}: {
  title: React.ReactNode;
  isPrivate: boolean;
  excerpt: string | null;
  hasMore: boolean;
  /** The poem's language tag (src/lib/poem-languages.ts): `lang` on its title and text, plus a label. */
  lang?: string | null;
} & Omit<React.ComponentProps<"div">, "title" | "lang">) {
  return (
    <div
      data-card=""
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card p-4 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_16px_-8px_oklch(0_0_0/0.12)] transition-[opacity,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_oklch(0_0_0/0.08),0_12px_28px_-12px_oklch(0_0_0/0.25)] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring",
        className,
      )}
      style={style}
      {...rest}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 lang={lang ?? undefined} className="min-w-0 font-serif text-[19px] leading-snug">
          {title}
        </h3>
        {(languageName(lang) || isPrivate) && (
          <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
            {languageName(lang) && (
              <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                {languageName(lang)}
              </span>
            )}
            {isPrivate && (
              // Icon only, to leave the title more room. Screen readers get
              // "(password protected)" from the title and "Enter the password"
              // below, so the pill stays hidden from them.
              <span
                data-lock-badge=""
                title="Password protected"
                className="flex size-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
                aria-hidden
              >
                <LockIcon className="size-3" />
              </span>
            )}
          </div>
        )}
      </div>
      {isPrivate ? (
        <div className="mt-3 flex flex-1 flex-col justify-between">
          {/* Decorative "redacted" lines: there is no text behind them. */}
          <div className="grid gap-2 opacity-60" aria-hidden>
            {[88, 72, 80, 54].map((w, i) => (
              <span key={i} className="h-2 rounded-full bg-muted-foreground/20" style={{ width: `${w}%` }} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Enter the password to read</p>
        </div>
      ) : (
        <p lang={lang ?? undefined} className="mt-2 flex-1 overflow-hidden font-serif text-[14.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
          {excerpt !== null && <PoemText text={excerpt} truncated={hasMore} />}
          {hasMore && "\n…"}
        </p>
      )}
    </div>
  );
}
