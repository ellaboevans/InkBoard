"use client";

import { PlayIcon } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { WALKTHROUGH_MUSIC_CREDIT as MUSIC, type WalkthroughSource } from "@/lib/site";
import cover1920 from "@/assets/about/walkthrough-cover-1920.webp";
import cover960 from "@/assets/about/walkthrough-cover-960.webp";

/*
 * The About page's walkthrough video (docs/PLAN.md, Phase 19). The source
 * comes from WALKTHROUGH_VIDEO (src/lib/site.ts), passed in as a prop so tests
 * can render both states.
 *
 * - No video: our own cover image with "Video coming soon".
 * - A video: the same cover as a play button. There is no <video> element
 *   until the reader presses it, so nothing is fetched from ImageKit before
 *   that. The press mounts the browser's own player (flushSync) and calls
 *   play() in the same click handler, so it starts with sound everywhere
 *   (ImageKit's iframe player autoplays muted, and loads video.js from two
 *   CDNs). HLS first (adaptive, native on Safari, iOS and Android), then a
 *   720p MP4 for the rest.
 *
 * The cover is a static import, so it's served from /_next/static/, which the
 * offline worker keeps with a saved copy of the page. Offline, the video
 * fails to load and says so.
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

/** The browser's own player, mounted once the reader presses play. */
export function WalkthroughPlayer({
  video,
  videoRef,
  onError,
}: {
  video: WalkthroughSource;
  videoRef?: React.Ref<HTMLVideoElement>;
  onError?: () => void;
}) {
  return (
    <video
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      poster={cover1920.src}
      aria-label="InkBoard walkthrough video"
      onError={onError}
      className="size-full bg-black"
    >
      <source src={video.hls} type="application/vnd.apple.mpegurl" />
      {/* The last source failing means none could play: an error fires here, not on the <video>. */}
      <source src={video.mp4} type="video/mp4" onError={onError} />
    </video>
  );
}

function MusicCredit() {
  return (
    <>
      Music: “{MUSIC.title}” by{" "}
      <a href={MUSIC.artistUrl} className="underline underline-offset-2 hover:text-foreground" rel="noopener">
        {MUSIC.artist}
      </a>
      , licensed under{" "}
      <a href={MUSIC.licenceUrl} className="underline underline-offset-2 hover:text-foreground" rel="noopener license">
        {MUSIC.licence}
      </a>
      .
    </>
  );
}

export function WalkthroughVideo({ video }: { video: WalkthroughSource | null }) {
  const [state, setState] = useState<"ready" | "playing" | "error">("ready");
  const player = useRef<HTMLVideoElement>(null);
  const frame = "relative aspect-video w-full overflow-hidden rounded-2xl border bg-muted shadow-sm";

  if (!video) {
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

  const play = () => {
    // Mount the player now, then start it while this click still counts as the reader's gesture.
    flushSync(() => setState("playing"));
    const el = player.current;
    if (!el) return;
    // The button that had focus is gone: hand focus to the player's controls.
    el.focus();
    // A refusal (rare) leaves the player's own controls to start it.
    el.play().catch(() => {});
  };

  return (
    <figure className="grid gap-2" data-walkthrough={state}>
      <div className={frame}>
        {/* After an error the button is back, so pressing play again is the retry. */}
        {state !== "playing" ? (
          <button
            type="button"
            onClick={play}
            className="group absolute inset-0 size-full cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {/* The button is named by its visible text; the cover is decoration here. */}
            <Cover alt="" />
            {/* Bottom right, over the screenshot half of the cover, so it never hides the cover's title. */}
            <span className="absolute inset-0 flex items-end justify-end p-3 sm:p-4">
              <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-transform group-hover:scale-105 sm:px-5 sm:py-3 sm:text-base">
                <PlayIcon className="size-4 fill-current sm:size-5" aria-hidden />
                Play the walkthrough
              </span>
            </span>
          </button>
        ) : (
          <WalkthroughPlayer video={video} videoRef={player} onError={() => setState("error")} />
        )}
      </div>
      <figcaption className="grid gap-1 text-sm text-muted-foreground">
        {state === "error" ? (
          <p role="alert" className="text-destructive">
            The video couldn’t load. Check your connection and press play to try again.
          </p>
        ) : (
          <p>
            {state === "ready"
              ? "Six minutes, with narration. It streams from our video host, ImageKit, once you press play; nothing is loaded from it before that."
              : "Streaming from our video host, ImageKit."}
          </p>
        )}
        <p>
          <MusicCredit />
        </p>
      </figcaption>
    </figure>
  );
}
