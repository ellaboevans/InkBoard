"use client";

import { PlayIcon } from "lucide-react";
import { useState } from "react";
import { walkthroughEmbedUrl } from "@/lib/csp";
import cover1920 from "@/assets/about/walkthrough-cover-1920.webp";
import cover960 from "@/assets/about/walkthrough-cover-960.webp";

/*
 * The About page's walkthrough video (docs/PLAN.md, Phase 19). The id comes
 * from WALKTHROUGH_YOUTUBE_ID (src/lib/site.ts), passed in as a prop so tests
 * can render both states.
 *
 * - No id yet: our own cover image with "Video coming soon".
 * - An id: the same cover as a play button. Nothing is fetched from YouTube
 *   until the reader presses it (no iframe, no thumbnail, no preconnect);
 *   then the youtube-nocookie.com player replaces the cover and starts.
 *
 * The cover is a static import, so it's served from /_next/static/, which the
 * offline worker keeps with a saved copy of the page.
 */

export const COVER_ALT =
  "How InkBoard works: read, write and share poems in Ewe, Akan, Ga and English. A preview of the board, showing two Ewe poems by Selorm Agbɔ.";

function Cover({ alt }: { alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP files, kept under /_next/static for offline copies
    <img
      src={cover960.src}
      srcSet={`${cover960.src} 960w, ${cover1920.src} 1920w`}
      sizes="(min-width: 768px) 42rem, 100vw"
      width={1920}
      height={1080}
      alt={alt}
      className="size-full object-cover"
    />
  );
}

export function WalkthroughEmbed({ youtubeId, autoFocus = false }: { youtubeId: string; autoFocus?: boolean }) {
  return (
    <iframe
      // Pressing play removed the button that had focus: hand it to the player.
      ref={autoFocus ? (el) => el?.focus() : undefined}
      src={walkthroughEmbedUrl(youtubeId)}
      title="InkBoard walkthrough video"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      // YouTube needs at least our origin to play an embed.
      referrerPolicy="strict-origin-when-cross-origin"
      className="size-full border-0"
    />
  );
}

export function WalkthroughVideo({ youtubeId }: { youtubeId: string | null }) {
  const [playing, setPlaying] = useState(false);
  const frame = "relative aspect-video w-full overflow-hidden rounded-2xl border bg-muted shadow-sm";

  if (!youtubeId) {
    return (
      <figure className="grid gap-2" data-walkthrough="coming-soon">
        <div className={frame}>
          <Cover alt={COVER_ALT} />
          <span className="absolute right-3 bottom-3 rounded-full border bg-background/90 px-3 py-1 text-sm font-medium shadow-sm backdrop-blur">
            Video coming soon
          </span>
        </div>
        <figcaption className="text-sm text-muted-foreground">
          A short walkthrough of the board and the editor is on its way.
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="grid gap-2" data-walkthrough={playing ? "playing" : "ready"}>
      <div className={frame}>
        {playing ? (
          <WalkthroughEmbed youtubeId={youtubeId} autoFocus />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 size-full cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {/* The button is named by its visible text; the cover is decoration here. */}
            <Cover alt="" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-medium text-primary-foreground shadow-md transition-transform group-hover:scale-105">
                <PlayIcon className="size-5 fill-current" aria-hidden />
                Play the walkthrough
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="text-sm text-muted-foreground">
        {playing
          ? "Playing from YouTube (youtube-nocookie.com)."
          : "Plays from YouTube (youtube-nocookie.com); nothing is loaded from YouTube until you press play."}
      </figcaption>
    </figure>
  );
}
