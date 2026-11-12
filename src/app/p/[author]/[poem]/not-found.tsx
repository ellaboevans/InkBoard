import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PoemNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-serif text-3xl">Poem not found</h1>
      <p className="text-muted-foreground">It may have been unpublished or moved.</p>
      <Button asChild variant="outline">
        <Link href="/">Back to the board</Link>
      </Button>
    </main>
  );
}
