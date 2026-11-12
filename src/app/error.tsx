"use client";

import { RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/**
 * Friendly fallback when a page fails to render (e.g. the database is
 * unreachable). The technical details stay in the server log; in production
 * Next only sends the browser an opaque `digest` to quote in bug reports.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    notify.error("This page couldn't load", "Please try again in a moment.");
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-serif text-3xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        We couldn&apos;t load this page. It&apos;s usually temporary, so please try again.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => unstable_retry()}>
          <RotateCcwIcon />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to the board</Link>
        </Button>
      </div>
    </main>
  );
}
