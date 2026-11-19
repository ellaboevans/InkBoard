"use client";

import { PlayIcon } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { WALKTHROUGH_MUSIC_CREDIT as MUSIC, type WalkthroughSource } from "@/lib/site";
import type { StaticImageData } from "next/image";
import cover1920 from "@/assets/about/walkthrough-cover-1920.webp";
import cover960 from "@/assets/about/walkthrough-cover-960.webp";
import whatsNew1920 from "@/assets/about/whats-new-cover-1920.webp";
import whatsNew960 from "@/assets/about/whats-new-cover-960.webp";

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
 *
 * `WhatsNewVideo` is the second video ("What's new in InkBoard",
 * WHATS_NEW_VIDEO) below it: the same card with its own cover, labels and
 * `data-whats-new` state, and nothing at all while it's null. A source without
 * `hls` plays its MP4 everywhere.
 */

export const COVER_ALT =
  "How InkBoard works: read, write and share poems in Ewe, Akan, Ga and English. A preview of the board, showing two Ewe poems by Selorm Agbɔ.";

/** What differs between the About page's two videos. */
type VideoCopy = {
  cover: { small: StaticImageData; large: StaticImageData };
  /** The play button's visible text, which names it. */
  play: string;
  /** The player's accessible name. */
  player: string;
  /** The figure's state attribute, so each video can be found on its own. */
  state: "data-walkthrough" | "data-whats-new";
  /** The caption before play. */
  ready: string;
};

const WALKTHROUGH_COPY: VideoCopy = {
  cover: { small: cover960, large: cover1920 },
  play: "Play the walkthrough",
  player: "InkBoard walkthrough video",
  state: "data-walkthrough",
  ready:
    "Six minutes, with narration. It streams from our video host, ImageKit, once you press play; nothing is loaded from it before that.",
};

export const WHATS_NEW_COPY: VideoCopy = {
  cover: { small: whatsNew960, large: whatsNew1920 },
  play: "Play what’s new",
  player: "What’s new in InkBoard video",
  state: "data-whats-new",
  ready:
    "What’s new since the walkthrough above, in three minutes: pictures of poems and passages, profile photos, following writers, novels and stats. It streams from ImageKit once you press play.",
};

function Cover({ alt, cover = WALKTHROUGH_COPY.cover }: { alt: string; cover?: VideoCopy["cover"] }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP files, kept under /_next/static for offline copies
    <img
      src={cover.small.src}
      srcSet={`${cover.small.src} 960w, ${cover.large.src} 1920w`}
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
  copy = WALKTHROUGH_COPY,
}: {
  video: WalkthroughSource;
  videoRef?: React.Ref<HTMLVideoElement>;
  onError?: () => void;
  copy?: VideoCopy;
}) {
  return (
    <video
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      poster={copy.cover.large.src}
      aria-label={copy.player}
      onError={onError}
      className="size-full bg-black"
    >
      {video.hls && <source src={video.hls} type="application/vnd.apple.mpegurl" />}
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

const FRAME = "relative aspect-video w-full overflow-hidden rounded-2xl border bg-muted shadow-sm";

export function WalkthroughVideo({ video }: { video: WalkthroughSource | null }) {
  const frame = FRAME;
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
  return <VideoCard video={video} copy={WALKTHROUGH_COPY} />;
}

/** "What's new in InkBoard", below the walkthrough; nothing while WHATS_NEW_VIDEO is null. */
export function WhatsNewVideo({ video }: { video: WalkthroughSource | null }) {
  if (!video) return null;
  return <VideoCard video={video} copy={WHATS_NEW_COPY} />;
}

function VideoCard({ video, copy }: { video: WalkthroughSource; copy: VideoCopy }) {
  const [state, setState] = useState<"ready" | "playing" | "error">("ready");
  const player = useRef<HTMLVideoElement>(null);
  const frame = FRAME;

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
    <figure className="grid gap-2" {...{ [copy.state]: state }}>
      <div className={frame}>
        {/* After an error the button is back, so pressing play again is the retry. */}
        {state !== "playing" ? (
          <button
            type="button"
            onClick={play}
            className="group absolute inset-0 size-full cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {/* The button is named by its visible text; the cover is decoration here. */}
            <Cover alt="" cover={copy.cover} />
            {/* Bottom right, over the screenshot half of the cover, so it never hides the cover's title. */}
            <span className="absolute inset-0 flex items-end justify-end p-3 sm:p-4">
              <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-transform group-hover:scale-105 sm:px-5 sm:py-3 sm:text-base">
                <PlayIcon className="size-4 fill-current sm:size-5" aria-hidden />
                {copy.play}
              </span>
            </span>
          </button>
        ) : (
          <WalkthroughPlayer video={video} videoRef={player} copy={copy} onError={() => setState("error")} />
        )}
      </div>
      <figcaption className="grid gap-1 text-sm text-muted-foreground">
        {state === "error" ? (
          <p role="alert" className="text-destructive">
            The video couldn’t load. Check your connection and press play to try again.
          </p>
        ) : (
          <p>
            {state === "ready" ? copy.ready : "Streaming from our video host, ImageKit."}
          </p>
        )}
        <p>
          <MusicCredit />
        </p>
      </figcaption>
    </figure>
  );
}
