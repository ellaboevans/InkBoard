import { EyeOffIcon, StarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { pluralCount } from "@/lib/plural";
import { PRIVACY_CONTACT_EMAIL } from "@/lib/site";

/*
 * What the writer sees when InkBoard's owner has hidden something of theirs
 * (docs/PLAN.md, Phase 32 round 2): a badge on each hidden poem or novel, and
 * one notice at the top of their screens saying readers can't see it and how
 * to ask about it. Nothing about the report itself. Hooks-free, so the
 * dashboard's client table can use the badge too.
 */

/** "Hidden by InkBoard": next to a hidden poem's or novel's status. */
export function HiddenBadge() {
  return (
    <Badge variant="destructive" className="shrink-0 font-sans" data-hidden-badge>
      <EyeOffIcon aria-hidden />
      Hidden by InkBoard
    </Badge>
  );
}

/** The one plain line: readers can't see it, and where to ask. */
export function HiddenExplainer({ className }: { className?: string }) {
  return (
    <p className={className}>
      Readers can&apos;t see it: it isn&apos;t on the board, in search or in feeds, and its pages say &ldquo;not found&rdquo;.
      Nothing is deleted. To ask about it, write to{" "}
      <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="font-medium text-foreground underline underline-offset-4">
        {PRIVACY_CONTACT_EMAIL}
      </a>
      .
    </p>
  );
}

/**
 * The notice at the top of the dashboard (and the novels screens): the whole
 * account, or how many poems and novels. Renders nothing when nothing is hidden.
 */
export function HiddenNotice({ account, poems = 0, novels = 0 }: { account: boolean; poems?: number; novels?: number }) {
  if (!account && poems === 0 && novels === 0) return null;
  const items = [poems > 0 && pluralCount(poems, "poem"), novels > 0 && pluralCount(novels, "novel")].filter(Boolean).join(" and ");
  const title = account
    ? "InkBoard has hidden your author page"
    : `InkBoard has hidden ${items === "1 poem" ? "one of your poems" : items === "1 novel" ? "one of your novels" : items} from readers`;
  return (
    <section
      aria-labelledby="hidden-notice-title"
      data-hidden-notice
      className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-start"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <EyeOffIcon className="size-5" aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 id="hidden-notice-title" className="font-medium">
          {title}
        </h2>
        {account && (
          <p className="text-sm text-muted-foreground">
            Your author page and all your poems and novels are hidden, after a report. You can still see, edit, download and
            delete everything here.
          </p>
        )}
        {!account && (
          <p className="text-sm text-muted-foreground">
            {poems + novels === 1 ? "It's" : "They're"} marked &ldquo;Hidden by InkBoard&rdquo; in your lists. You can still see, edit,
            download and delete {poems + novels === 1 ? "it" : "them"}.
          </p>
        )}
        <HiddenExplainer className="text-sm text-muted-foreground" />
      </div>
    </section>
  );
}

/** "Featured" (Phase 33): on the writer's row while InkBoard's owner features it and readers can see it. */
export function FeaturedBadge() {
  return (
    <Badge variant="secondary" className="shrink-0 font-sans" data-featured-badge>
      <StarIcon aria-hidden />
      Featured
    </Badge>
  );
}
