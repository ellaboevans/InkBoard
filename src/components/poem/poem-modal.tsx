"use client";

import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { OVERLAY_LOADING_ID } from "@/lib/poem-overlay";

/**
 * The board overlay's dialog shell, rendered once by the intercepted route's
 * layout (src/app/@modal/(.)p/layout.tsx). Stepping between poems with
 * Next/Previous only swaps the page inside it: the dialog, backdrop and
 * scroll container stay mounted and still (no replayed opening animation).
 *
 * Closing (Esc, the X, a click outside) goes back in history, so the browser
 * Back button and the close button behave the same and the board is exactly
 * as it was left. Collection links replace the history entry, so that's one
 * step back to the board from any poem.
 *
 * The page must stay renderable on the server, or Next drops it from
 * instant-navigation validation ("Could not validate that a segment… has
 * instant navigation"). So: no portal (a portal renders only in the browser;
 * the @modal slot already sits at the top of <body>, so fixed positioning
 * works in place), and no URL hooks (usePathname would need a Suspense
 * boundary around the page). The poem on screen names the dialog itself
 * (OverlayPoemShown in overlay-poem-shown.tsx).
 *
 * Radix primitives directly, styled like components/ui/dialog.tsx, because
 * that DialogContent always portals.
 */
export function PoemModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    // Controlled and always open while mounted: the URL decides visibility.
    // (Uncontrolled `defaultOpen` would remember "closed" when Next re-shows
    // this route from <Activity> on browser Forward.)
    <DialogPrimitive.Root open onOpenChange={(open) => !open && router.back()}>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // Replaced by the shown poem's title id (OverlayPoemShown). React never
        // re-applies this unchanged value, so the poem's choice sticks.
        aria-labelledby={OVERLAY_LOADING_ID}
        aria-describedby={undefined}
        // Each poem focuses its own title when shown, on the first open as on
        // every step; Radix's own auto-focus would override it.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(88dvh,56rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-2xl"
      >
        {/* Radix requires a DialogTitle in the tree; the real name is the shown poem's h1. */}
        <DialogPrimitive.Title className="sr-only" aria-hidden>
          Poem
        </DialogPrimitive.Title>
        {/* data-poem-scroll: collection links and OverlayPoemShown scroll this back to the top. */}
        <div data-poem-scroll className="overflow-y-auto overscroll-contain px-6 pb-8 sm:px-10 sm:pb-10">
          {children}
        </div>
        <DialogPrimitive.Close data-slot="dialog-close" asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2 z-20">
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
