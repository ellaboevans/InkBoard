import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PoemNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="font-serif text-2xl">Poem not found</h1>
      <p className="text-muted-foreground">It may have been deleted, or it belongs to another editor.</p>
      <Button asChild variant="outline">
        <Link href="/admin">Back to your poems</Link>
      </Button>
    </div>
  );
}
