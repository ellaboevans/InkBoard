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
    <nav
      aria-label={`${collection.title}, part ${collection.part} of ${collection.parts}`}
      className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2"
    >
      {collection.prev && <NeighbourLink poem={collection.prev} authorSlug={authorSlug} inDialog={inDialog} rel="prev" />}
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
  const className = `grid gap-1 rounded-xl border bg-card p-4 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${next ? "text-right sm:col-start-2" : ""}`;
  const content = (
    <>
      <span className={`flex items-center gap-1 text-xs text-muted-foreground ${next ? "justify-end" : ""}`}>
        {!next && <ArrowLeftIcon className="size-3.5" aria-hidden />}
        {next ? "Next:" : "Previous:"}
        {next && <ArrowRightIcon className="size-3.5" aria-hidden />}
      </span>
      <span lang={poem.language ?? undefined} className="font-serif text-lg leading-snug">
        {poem.title}
        {poem.visibility === "private" && (
          <>
            {" "}
            <LockIcon className="inline size-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only"> (password protected)</span>
          </>
        )}
      </span>
    </>
  );
  if (!inDialog) {
    return (
      <a href={href} rel={rel} className={className}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} rel={rel} replace className={className}>
      {content}
    </Link>
  );
}
