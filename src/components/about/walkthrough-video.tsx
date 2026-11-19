"use client";

import { PlayIcon } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { VIDEO_HOST_NAME, WALKTHROUGH_MUSIC_CREDIT as MUSIC, type WalkthroughSource } from "@/lib/site";

const loadVideoDialog = () => import("@/components/media-player/video-dialog");
const VideoDialog = lazy(loadVideoDialog);
import type { StaticImageData } from "next/image";
import cover1920 from "@/assets/about/walkthrough-cover-1920.webp";
import cover960 from "@/assets/about/walkthrough-cover-960.webp";
import whatsNew1920 from "@/assets/about/whats-new-cover-1920.webp";
import whatsNew960 from "@/assets/about/whats-new-cover-960.webp";

/*
 * The About page's videos (docs/PLAN.md, Phases 19 and 30). The sources come
 * from WALKTHROUGH_VIDEO and WHATS_NEW_VIDEO (src/lib/site.ts), passed in as
 * props so tests can render every state.
 *
 * - No video: our own cover image with "Video coming soon" (the walkthrough),
 *   or nothing (What's new).
 * - A video: the same cover as a play button. Pressing it opens VideoDialog,
 *   InkBoard's own player in a modal, which starts the video (or waits,
 *   ready, if the browser refuses to start it). There is no <video> element
 *   until then, so nothing is fetched from the video host before the press,
 *   and the dialog's code is loaded only then too (React.lazy; fetched from
 *   our own origin a moment early when the button is hovered, focused or
 *   touched), so the prerendered page stays light.
 *
 * The cover is a static import, so it's served from /_next/static/, which the
 * offline worker keeps with a saved copy of the page; it is also the player's
 * poster. Offline, the video fails to load and the player says so.
 */

export const COVER_ALT =
  "How InkBoard works: read, write and share poems in Ewe, Akan, Ga and English. A preview of the board, showing two Ewe poems by Selorm Agbɔ.";

/** What differs between the About page's two videos. */
type VideoCopy = {
  cover: { small: StaticImageData; large: StaticImageData };
  /** The play button's visible text, which names it. */
  play: string;
  /** The player dialog's visible title. */
  title: string;
  /** The player's accessible name. */
  player: string;
  /** The figure's state attribute, so each video can be found on its own. */
  state: "data-walkthrough" | "data-whats-new";
  /** The caption before play. */
  ready: string;
};

export const WALKTHROUGH_COPY: VideoCopy = {
  cover: { small: cover960, large: cover1920 },
  play: "Play the walkthrough",
  title: "InkBoard walkthrough",
  player: "InkBoard walkthrough video",
  state: "data-walkthrough",
  ready:
    `Six minutes, with narration. It plays here, streaming from our video host, ${VIDEO_HOST_NAME}, once you press play; nothing is loaded from it before that.`,
};

export const WHATS_NEW_COPY: VideoCopy = {
  cover: { small: whatsNew960, large: whatsNew1920 },
  play: "Play what’s new",
  title: "What’s new in InkBoard",
  player: "What’s new in InkBoard video",
  state: "data-whats-new",
  ready:
    `What’s new since the walkthrough above, in three minutes: pictures of poems and passages, profile photos, following writers, novels and stats. It streams from ${VIDEO_HOST_NAME} once you press play.`,
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
  // `mounted` stays true after the first press, so reopening needs no new load; the dialog itself
  // unmounts its <video> whenever it closes.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const frame = FRAME;

  const press = () => {
    // Synchronously, while this press still counts as the reader's gesture, so the player may start with sound.
    flushSync(() => {
      setMounted(true);
      setOpen(true);
    });
  };
  const prefetch = () => {
    loadVideoDialog().catch(() => {});
  };

  return (
    <figure className="grid gap-2" {...{ [copy.state]: open ? "open" : "ready" }}>
      <div className={frame}>
        <button
          ref={button}
          type="button"
          onClick={press}
          onPointerEnter={prefetch}
          onPointerDown={prefetch}
          onFocus={prefetch}
          aria-haspopup="dialog"
          className="group absolute inset-0 size-full cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {/* The button is named by its visible text; the cover is decoration here. */}
          <Cover alt="" cover={copy.cover} />
          {/* Bottom right, over the screenshot half of the cover, so it never hides the cover's title. */}
          <span className="absolute inset-0 flex items-end justify-end p-3 sm:p-4">
            <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-transform group-hover:scale-105 motion-reduce:transition-none sm:px-5 sm:py-3 sm:text-base">
              <PlayIcon className="size-4 fill-current sm:size-5" aria-hidden />
              {copy.play}
            </span>
          </span>
        </button>
      </div>
      <figcaption className="grid gap-1 text-sm text-muted-foreground">
        <p>{copy.ready}</p>
        <p>
          <MusicCredit />
        </p>
      </figcaption>
      {mounted && (
        <Suspense fallback={null}>
          <VideoDialog
            open={open}
            onOpenChange={setOpen}
            title={copy.title}
            label={copy.player}
            sources={video}
            captions={video.captions}
            poster={copy.cover.large.src}
            credit={<MusicCredit />}
            returnFocus={button}
          />
        </Suspense>
      )}
    </figure>
  );
}
