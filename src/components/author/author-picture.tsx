import { cn } from "cn";
import { pictureSources, type AuthorPicture as Picture } from "@/lib/author-picture";

/**
 * An author's picture: their photo, or their avatar (docs/PLAN.md, Phase 22).
 * The one component every place uses, so size, roundness and ring match.
 * Decorative by default (`alt=""`): the name is always beside it.
 *
 * A photo has the avatar as its background, so if the photo can't load
 * (offline, or removed while a page was cached) the avatar shows instead of
 * a gap. Explicit width/height: no layout shift. Server- and client-safe.
 */
export function AuthorPicture({
  picture,
  size,
  alt = "",
  className,
  loading,
}: {
  picture: Picture;
  /** The CSS size it's drawn at, in px (the attributes; a class may resize it responsively). */
  size: number;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const s = pictureSources(picture, size);
  const classes = cn("shrink-0 rounded-full bg-secondary object-cover", className);
  if (s.kind === "avatar") {
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from our own route
    return <img src={s.src} alt={alt} width={size} height={size} loading={loading} className={classes} data-author-picture="avatar" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- our own processed WebP copies, already the right sizes
    <img
      src={s.src}
      srcSet={s.srcSet}
      sizes={`${size}px`}
      alt={alt}
      width={size}
      height={size}
      loading={loading}
      decoding="async"
      className={cn(classes, "bg-cover bg-center")}
      style={{ backgroundImage: `url(${s.fallback})` }}
      data-author-picture="photo"
    />
  );
}
