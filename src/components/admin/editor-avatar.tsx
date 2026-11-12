import { cn } from "cn";
import { avatarIdFor, avatarUrl } from "@/lib/avatars";

/** An editor's avatar (chosen, or their stable default). Decorative by default. */
export function EditorAvatar({
  editor,
  size = 32,
  alt = "",
  className,
}: {
  editor: { id: string; avatar: string | null };
  size?: number;
  alt?: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from our own route
    <img
      src={avatarUrl(avatarIdFor(editor))}
      alt={alt}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full bg-secondary", className)}
    />
  );
}
