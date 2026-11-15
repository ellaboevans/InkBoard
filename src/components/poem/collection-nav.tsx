"use client";

import { ArrowLeftIcon, ArrowRightIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import type { ReaderCollection, ReaderCollectionPoem } from "@/lib/board-types";

/*
 * "Part 3 of 7 · <collection>" with links to the neighbouring published poems
 * (docs/PLAN.md, Phase 14). Private neighbours show their title and lock,
 * never text (N1). The numbers count published poems only.
 *
 * In the board overlay, the links are router links that *replace* the history
 * entry: closing the overlay goes back in history (PoemModal), so stepping
 * through a collection must not stack entries between the reader and the
 * board. On the full page they're plain <a>s, like "Open full page": a soft
 * navigation to /p/… from anywhere is intercepted by @modal/(.)p and would
 * open the overlay on top of the full page.
 */

/** "Part 3 of 7 · <collection>", above the poem's title. */
export function CollectionPart({ collection }: { collection: ReaderCollection }) {
  return (
    <p className="mb-3 text-sm text-muted-foreground">
      Part {collection.part} of {collection.parts} · <span className="text-foreground">{collection.title}</span>
    </p>
  );
}

export function CollectionNav({
  collection,
  authorSlug,
  inDialog,
}: {
  collection: ReaderCollection;
  authorSlug: string;
  inDialog: boolean;
}) {
  if (!collection.prev && !collection.next) return null;
  return (
    // One quiet, text-sized row: it belongs to the poem, it shouldn't compete with it.
    <nav
      aria-label={`${collection.title}, part ${collection.part} of ${collection.parts}`}
      className="mt-10 flex items-center justify-between gap-4 border-t pt-4 text-sm text-muted-foreground"
    >
      {collection.prev ? (
        <NeighbourLink poem={collection.prev} authorSlug={authorSlug} inDialog={inDialog} rel="prev" />
      ) : (
        <span />
      )}
      {collection.next && <NeighbourLink poem={collection.next} authorSlug={authorSlug} inDialog={inDialog} rel="next" />}
    </nav>
  );
}

function NeighbourLink({
  poem,
  authorSlug,
  inDialog,
  rel,
}: {
  poem: ReaderCollectionPoem;
  authorSlug: string;
  inDialog: boolean;
  rel: "prev" | "next";
}) {
  const next = rel === "next";
  const href = `/p/${authorSlug}/${poem.slug}`;
  // Long titles are cut with an ellipsis by CSS only: screen readers still get
  // the whole title, and hovering shows it.
  const className = `flex min-w-0 max-w-[48%] items-center gap-1 rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${next ? "ml-auto" : ""}`;
  const content = (
    <>
      {!next && <ArrowLeftIcon className="size-3.5 shrink-0" aria-hidden />}
      <span className="shrink-0">{next ? "Next:" : "Previous:"}</span>
      <span lang={poem.language ?? undefined} className="min-w-0 truncate text-foreground">
        {poem.title}
      </span>
      {poem.visibility === "private" && (
        <>
          <LockIcon className="size-3 shrink-0" aria-hidden />
          <span className="sr-only"> (password protected)</span>
        </>
      )}
      {next && <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden />}
    </>
  );
  if (!inDialog) {
    return (
      <a href={href} rel={rel} title={poem.title} className={className}>
        {content}
      </a>
    );
  }
  return (
    <Link
      href={href}
      rel={rel}
      title={poem.title}
      replace
      className={className}
    >
      {content}
    </Link>
  );
}
