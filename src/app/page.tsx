import { FeatherIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Placeholder until the canvas board lands (docs/PLAN.md, Phase 3).
export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden bg-canvas p-6 text-center [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:24px_24px]">
      <FeatherIcon className="size-8 text-primary" aria-hidden />
      <h1 className="font-serif text-5xl tracking-tight">PoemHub</h1>
      <p className="max-w-md font-serif text-lg text-muted-foreground italic">
        A living board of poems, catalogued by author.
      </p>
      <p className="text-sm text-muted-foreground">The board is being set up. Check back soon.</p>
      <Button asChild variant="outline">
        <Link href="/sign-in">Editor sign in</Link>
      </Button>
    </main>
  );
}
