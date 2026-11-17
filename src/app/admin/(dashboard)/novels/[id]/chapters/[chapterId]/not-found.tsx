import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ChapterNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="font-serif text-2xl">Chapter not found</h1>
      <p className="text-muted-foreground">It may have been deleted, or it belongs to another editor.</p>
      <Button asChild variant="outline">
        <Link href="/admin/novels">Back to your novels</Link>
      </Button>
    </div>
  );
}
