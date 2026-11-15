import { CloudOffIcon } from "lucide-react";
import type { Metadata } from "next";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { SavedPoems } from "@/components/offline/saved-poems";

// Shown by the service worker for pages that aren't saved (docs/PLAN.md, Phase 15 round 2).
export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false, follow: false },
};

/**
 * The offline page. Static; the worker stores it (and its assets) when it
 * installs and answers with it for anything not saved while there's no
 * connection. Everything it shows comes from this device's caches.
 */
export default function OfflinePage() {
  return (
    <main className="flex-1 bg-background">
      <div className="mx-auto grid max-w-2xl gap-8 px-6 py-12 sm:py-16">
        <header className="grid gap-3">
          <CloudOffIcon className="size-8 text-primary" aria-hidden />
          <h1 className="font-serif text-4xl leading-tight">You&apos;re offline</h1>
          <p className="text-muted-foreground">
            This page isn&apos;t saved on this device. The poems you&apos;ve read here are below; everything else
            will be back when your connection returns.
          </p>
        </header>
        <SavedPoems />
      </div>
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4" />
    </main>
  );
}
