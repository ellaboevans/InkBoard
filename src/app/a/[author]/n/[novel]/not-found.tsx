import Link from "next/link";
import { SiteLinks } from "@/components/site-links";
import { Button } from "@/components/ui/button";

/** An unknown novel, or one with no published chapter yet (Phase 23b): the same answer. */
export default function NovelNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="font-serif text-3xl">Novel not found</h1>
      <p className="text-muted-foreground">There&apos;s no novel at this address.</p>
      <Button asChild>
        <Link href="/">Back to the board</Link>
      </Button>
      <SiteLinks className="mt-8" />
    </main>
  );
}
