"use client";

import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SITE_OPERATOR } from "@/lib/site";
import { MediaPlayer, type MediaCaptions, type MediaPlayerHandle, type MediaSources } from "./media-player";

/*
 * A video in a modal (docs/PLAN.md, Phase 30): the shadcn Dialog with
 * InkBoard's MediaPlayer, opened by a play button outside it. The default
 * export, so callers load it with React.lazy: none of this code (or the
 * Dialog's) is in a page's first load.
 *
 * - The <video> exists only while the dialog is open: Radix unmounts the
 *   content on close, and the player's ref cleanup drops the source, so the
 *   download stops. `onOpenChange(false)` pauses it at once, before the exit
 *   animation.
 * - First focus is the player's play/pause button; on close focus goes back
 *   to `returnFocus` (the button that opened it).
 * - Esc in full screen leaves full screen only: the browser does that, and
 *   the dialog ignores an Esc while in (or a moment after leaving) full screen.
 * - The frame keeps 16:9 and is sized so the whole dialog fits the screen in
 *   portrait and landscape (no layout shift when the video arrives).
 */

/** An Esc this soon after leaving full screen was the one that left it. */
const ESC_AFTER_FULLSCREEN_MS = 500;

export default function VideoDialog({
  open,
  onOpenChange,
  title,
  label,
  sources,
  captions,
  poster,
  credit,
  returnFocus,
  autoPlay = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's visible title, e.g. "InkBoard walkthrough". */
  title: string;
  /** The player's accessible name. */
  label: string;
  sources: MediaSources;
  /** Captions for the player's CC button (Phase 31); none, no button. */
  captions?: MediaCaptions;
  poster?: string;
  /** Shown under the player, as the dialog's description (the music credit). */
  credit?: React.ReactNode;
  returnFocus?: React.RefObject<HTMLElement | null>;
  autoPlay?: boolean;
}) {
  const player = useRef<MediaPlayerHandle>(null);
  const leftFullscreenAt = useRef(0);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) leftFullscreenAt.current = performance.now();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) player.current?.pause();
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-video-dialog=""
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          player.current?.focusPrimary();
        }}
        onCloseAutoFocus={(e) => {
          if (!returnFocus?.current) return;
          e.preventDefault();
          returnFocus.current.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (document.fullscreenElement || performance.now() - leftFullscreenAt.current < ESC_AFTER_FULLSCREEN_MS) e.preventDefault();
        }}
        className="w-[min(calc(100vw-1.5rem),calc((100dvh-8rem)*16/9),68rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none motion-reduce:animate-none"
      >
        <div className="flex min-h-12 items-center gap-2 py-1 pr-1 pl-4">
          <DialogTitle className="min-w-0 flex-1 truncate font-serif text-lg leading-tight">{title}</DialogTitle>
          <DialogClose className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <XIcon className="size-5" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
        <MediaPlayer ref={player} sources={sources} captions={captions} poster={poster} label={label} autoPlay={autoPlay} />
        {/* The credit (the dialog's description) and the site's attribution: one row on wide screens, stacked on phones. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-muted-foreground">
          {credit ? (
            <DialogDescription className="text-xs">{credit}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{label}</DialogDescription>
          )}
          <p data-attribution="">Designed &amp; Built by {SITE_OPERATOR}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
