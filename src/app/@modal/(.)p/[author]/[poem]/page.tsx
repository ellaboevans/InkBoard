import { ExpandIcon } from "lucide-react";
import { Suspense } from "react";
import { PoemModal } from "@/components/poem/poem-modal";
import { PoemReader, PoemReaderSkeleton } from "@/components/poem/poem-reader";
import { Button } from "@/components/ui/button";

/**
 * Intercepted /p/[author]/[poem]: clicking a poem on the board opens it in an
 * overlay, keeping the board (and its pan/zoom position) underneath. The URL
 * still changes, so it can be shared; opening that URL directly, or
 * refreshing, renders the full page instead.
 */
export default function PoemOverlay({ params }: PageProps<"/p/[author]/[poem]">) {
  return (
    <PoemModal
      toolbar={
        <Suspense fallback={<span className="h-8" />}>
          <FullPageLink params={params} />
        </Suspense>
      }
    >
      <Suspense fallback={<PoemReaderSkeleton />}>
        <PoemReader params={params} headingId="poem-overlay-title" />
      </Suspense>
    </PoemModal>
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
