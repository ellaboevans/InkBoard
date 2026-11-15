import { ExpandIcon } from "lucide-react";
import { Suspense } from "react";
import { PoemReader, PoemReaderSkeleton } from "@/components/poem/poem-reader";
import { Button } from "@/components/ui/button";

/**
 * Intercepted /p/[author]/[poem]: clicking a poem on the board opens it in an
 * overlay, keeping the board (and its pan/zoom position) underneath. The URL
 * still changes, so it can be shared; opening that URL directly, or
 * refreshing, renders the full page instead.
 *
 * Only the poem lives here; the dialog shell is in ../../layout.tsx, so
 * stepping to another poem swaps this page and nothing else.
 */
export default function PoemOverlay({ params }: PageProps<"/p/[author]/[poem]">) {
  return (
    <>
      {/* Sticky at the top of the dialog's scroll area; per poem, since it needs the URL. */}
      <div className="sticky top-0 z-10 -mx-6 mb-8 flex items-center justify-between gap-2 border-b bg-popover px-4 py-2.5 pr-12 sm:-mx-10 sm:mb-10">
        <Suspense fallback={<span className="h-8" />}>
          <FullPageLink params={params} />
        </Suspense>
      </div>
      <Suspense fallback={<PoemReaderSkeleton inDialog />}>
        <PoemReader params={params} inDialog />
      </Suspense>
    </>
  );
}

async function FullPageLink({ params }: Pick<PageProps<"/p/[author]/[poem]">, "params">) {
  const { author, poem } = await params;
  const href = `/p/${encodeURIComponent(author)}/${encodeURIComponent(poem)}`;
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
      {/* A plain <a>: a full navigation renders the page, not the overlay. */}
      <a href={href}>
        <ExpandIcon />
        Open full page
      </a>
    </Button>
  );
}
