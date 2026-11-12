import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PoemReader, PoemReaderSkeleton } from "@/components/poem/poem-reader";
import { Button } from "@/components/ui/button";
import { getReaderPoem } from "@/server/board-cache";

type Props = PageProps<"/p/[author]/[poem]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, poem } = await params;
  const p = await getReaderPoem(author, poem);
  if (!p) return { title: "Poem not found" };
  return { title: `${p.title} by ${p.penName}` };
}

/** Full page: direct links, refreshes and shared URLs land here. */
export default function PoemPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-10">
          <Link href="/">
            <ArrowLeftIcon />
            Back to the board
          </Link>
        </Button>
        <Suspense fallback={<PoemReaderSkeleton />}>
          <PoemReader params={params} />
        </Suspense>
      </div>
    </main>
  );
}
