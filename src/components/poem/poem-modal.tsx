"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Overlay for a poem opened from the board. Closing (Esc, the X, a click
 * outside) goes back in history, so the browser Back button and the close
 * button behave the same and the board is exactly as it was left.
 */
export function PoemModal({
  children,
  toolbar,
}: {
  children: React.ReactNode;
  /** Rendered by the server (it needs the URL params), e.g. "Open full page". */
  toolbar: React.ReactNode;
}) {
  const router = useRouter();

  return (
    // Controlled and always open while mounted: the URL decides visibility.
    // (Uncontrolled `defaultOpen` would remember "closed" when Next re-shows
    // this route from <Activity> on browser Forward.)
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent
        // Named by the poem's title once it has loaded (PoemReader headingId).
        aria-labelledby="poem-overlay-title"
        aria-describedby={undefined}
        className="flex max-h-[min(88dvh,56rem)] w-full flex-col gap-0 overflow-hidden p-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-2xl"
      >
        {/* Radix requires a Title; the visible poem heading names the dialog. */}
        <DialogTitle className="sr-only">Poem</DialogTitle>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5 pr-12">
          {toolbar}
        </div>
        <div className="overflow-y-auto overscroll-contain px-6 py-8 sm:px-10 sm:py-10">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
