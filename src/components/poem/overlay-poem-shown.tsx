"use client";

import { useId, useLayoutEffect } from "react";
import { OVERLAY_LOADING_ID } from "@/lib/poem-overlay";

/*
 * Board overlay (src/app/@modal/(.)p): the dialog shell stays mounted while
 * you step between poems, and Next keeps the previous poems mounted but
 * hidden (<Activity>). Under <Activity> a hidden poem's effects are cleaned
 * up and re-run when it's shown again, so a layout effect here runs exactly
 * when this poem (or its skeleton) becomes the one on screen, and never for
 * a hidden one. It syncs the DOM, not React state.
 */

const dialogOf = (el: Element | null) => el?.closest<HTMLElement>('[role="dialog"]') ?? null;

/**
 * When this poem is shown (the first open, or a step to it): name the dialog
 * by its title, scroll the dialog back to the top, and focus the title so
 * screen readers announce it (with its "Part n of m", via aria-describedby).
 */
export function OverlayPoemShown({ titleId }: { titleId: string }) {
  useLayoutEffect(() => {
    const title = document.getElementById(titleId);
    if (!title) return;
    dialogOf(title)?.setAttribute("aria-labelledby", titleId);
    title.closest("[data-poem-scroll]")?.scrollTo({ top: 0 });
    title.focus({ preventScroll: true });
  }, [titleId]);
  return null;
}

/** While a stepped-to poem loads: "Loading poem" names the dialog, never the hidden previous poem. */
export function OverlayPoemLoading() {
  useLayoutEffect(() => {
    dialogOf(document.getElementById(OVERLAY_LOADING_ID))?.setAttribute("aria-labelledby", OVERLAY_LOADING_ID);
  }, []);
  return null;
}

/**
 * "Poem not found" inside the overlay (@modal/(.)p/[author]/[poem]/not-found.tsx):
 * names the dialog and takes focus like a poem's title. The id comes from
 * useId, never a fixed string, so a hidden <Activity> copy can't answer for it.
 */
export function OverlayNotFoundTitle({ children }: { children: React.ReactNode }) {
  const id = useId();
  return (
    <>
      <h1 id={id} tabIndex={-1} className="font-serif text-3xl leading-tight outline-none">
        {children}
      </h1>
      <OverlayPoemShown titleId={id} />
    </>
  );
}
