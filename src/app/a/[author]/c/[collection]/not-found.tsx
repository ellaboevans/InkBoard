import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Same treatment as "Author not found" (an unknown, empty or unpublished collection). */
export default function CollectionNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="font-serif text-3xl">Collection not found</h1>
      <p className="text-muted-foreground">There&apos;s no collection at this address.</p>
      <Button asChild>
        <Link href="/">Back to the board</Link>
      </Button>
    </main>
  );
}
