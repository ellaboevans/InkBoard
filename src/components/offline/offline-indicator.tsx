"use client";

import { cn } from "cn";
import { CloudOffIcon } from "lucide-react";
import { useOffline } from "next/offline";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * "You're offline · showing saved poems" on reader pages. Offline means Next's
 * useOffline() (a failed navigation/prefetch, or the browser's offline event)
 * or navigator.onLine being false, which covers a page loaded from the
 * worker's saved copy before any fetch has failed. Both are false on the
 * server and during hydration. The status region is always rendered, so screen
 * readers announce the change.
 */
export function OfflineIndicator({ className }: { className?: string }) {
  const nextOffline = useOffline();
  const browserOffline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  const offline = nextOffline || browserOffline;
  return (
    <div role="status" data-offline-indicator={offline ? "" : undefined} className={cn(offline ? "flex justify-center" : "sr-only", className)}>
      {offline && (
        <p className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur">
          <CloudOffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            You&apos;re offline <span aria-hidden>·</span> <span className="text-muted-foreground">showing saved poems</span>
          </span>
        </p>
      )}
    </div>
  );
}
