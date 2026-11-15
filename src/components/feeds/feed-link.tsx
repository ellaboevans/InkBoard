import { RssIcon } from "lucide-react";
import { cn } from "cn";
import { ATOM_TYPE, authorFeedPath } from "@/lib/feed-links";

/**
 * "Follow <pen name> in a feed reader": the visible link to an author's feed,
 * on their page and under each of their poems. A plain <a> with the Atom
 * type: the feed is XML, not a page the router can render.
 */
export function AuthorFeedLink({ slug, penName, className }: { slug: string; penName: string; className?: string }) {
  return (
    <a
      href={authorFeedPath(slug)}
      type={ATOM_TYPE}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <RssIcon className="size-3.5" aria-hidden />
      Follow {penName} in a feed reader
    </a>
  );
}
