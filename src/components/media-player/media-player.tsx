"use client";

import { cn } from "cn";
import {
  LoaderCircleIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { useCallback, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
  CONTROLS_HIDE_MS,
  formatTime,
  pickSource,
  PLAYBACK_RATES,
  playerKeyAction,
  rateLabel,
  seekLabel,
  SKIP_SECONDS,
  skipTo,
  stepVolume,
  volumeLabel,
  type PlayerAction,
} from "@/lib/media-player";

/*
 * InkBoard's own media player (docs/PLAN.md, Phase 30). One component for any
 * video: a <video> with our controls over it (play/pause, back and forward
 * 10 s, a seek bar with the time, mute and volume, playback speed,
 * picture-in-picture where the browser has it, full screen), keyboard
 * shortcuts while it has focus, and loading, ended and error states. No
 * quality choice: the source is one file (or the browser's own HLS).
 *
 * Performance: the player never re-renders on `timeupdate`. Each piece of the
 * media element's state is read with useSyncExternalStore from the element's
 * own events, in the small component that shows it: only the seek bar and the
 * time label follow the playback position; the root re-renders on play,
 * pause, buffering, full screen and resizes. Nothing is stored in the browser
 * (no remembered volume or position).
 *
 * It is a client-only component: render it after a user action (the About
 * page's VideoDialog), never in a prerendered page, so nothing is fetched
 * from the video host before that.
 */

export type MediaSources = { hls?: string; mp4: string };

export type MediaPlayerHandle = {
  /** Stop playback (closing a dialog). */
  pause(): void;
  /** Focus the main play/pause button (a dialog's first focus). */
  focusPrimary(): void;
};

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

/*
 * Every write to the media element goes through these: the element lives in
 * React state, and the compiler's rules (rightly) refuse mutations of state
 * in components. The element is the source of truth; its events re-render
 * whatever shows the change.
 */
const media = {
  seek(v: HTMLVideoElement, t: number) {
    v.currentTime = t;
  },
  setVolume(v: HTMLVideoElement, volume: number) {
    v.volume = volume;
    v.muted = volume === 0;
  },
  toggleMute(v: HTMLVideoElement) {
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5;
  },
  setRate(v: HTMLVideoElement, rate: number) {
    v.playbackRate = rate;
  },
};

const NOOP = () => () => {};

/** A value read from the media element, re-read on the given events only. */
function useMedia<T extends string | number | boolean>(
  video: HTMLVideoElement | null,
  events: string,
  read: (v: WebkitVideo) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!video) return () => {};
      const names = events.split(" ");
      for (const e of names) video.addEventListener(e, onChange);
      return () => {
        for (const e of names) video.removeEventListener(e, onChange);
      };
    },
    [video, events],
  );
  return useSyncExternalStore(
    video ? subscribe : NOOP,
    () => (video ? read(video) : fallback),
    () => fallback,
  );
}

/** Whether script can set the volume: not on iOS, where only the hardware buttons can (mute still works). */
function canSetVolume(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const probe = document.createElement("video");
    probe.volume = 0.5;
    return probe.volume === 0.5;
  } catch {
    return false;
  }
}

function canPlayHls(): boolean {
  if (typeof document === "undefined") return false;
  return document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
}

const STATE_EVENTS = "loadstart loadedmetadata loadeddata canplay canplaythrough waiting playing play pause ended seeking seeked stalled emptied";

const controlButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white outline-none hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/70 disabled:opacity-40 [&_svg]:size-5";

function SkipIcon({ back }: { back: boolean }) {
  const Icon = back ? RotateCcwIcon : RotateCwIcon;
  return (
    <span className="relative inline-flex">
      <Icon aria-hidden />
      <span aria-hidden className="absolute inset-0 flex items-center justify-center pt-px text-[8px] font-semibold">
        {SKIP_SECONDS}
      </span>
    </span>
  );
}

/** The position slider: re-renders on `timeupdate`, alone. */
function SeekBar({ video, onDragChange }: { video: HTMLVideoElement | null; onDragChange: (dragging: boolean) => void }) {
  const current = useMedia(video, "timeupdate seeking seeked loadedmetadata durationchange emptied", (v) => v.currentTime, 0);
  const duration = useMedia(video, "loadedmetadata durationchange emptied", (v) => (Number.isFinite(v.duration) ? v.duration : 0), 0);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? current;
  return (
    <Slider
      data-seek-bar=""
      min={0}
      max={duration > 0 ? duration : 1}
      step={1}
      value={[Math.min(value, duration || 1)]}
      disabled={duration <= 0}
      onValueChange={([v]) => {
        if (drag === null) onDragChange(true);
        setDrag(v);
        if (video) media.seek(video, v);
      }}
      onValueCommit={() => {
        setDrag(null);
        onDragChange(false);
      }}
      className="h-6 cursor-pointer"
      trackClassName="bg-white/30 data-horizontal:h-1.5"
      rangeClassName="bg-primary"
      thumbClassName="size-3.5 border-white"
      thumbProps={{ "aria-label": "Seek", "aria-valuetext": seekLabel(value, duration) }}
    />
  );
}

/** "1:23 / 6:01": re-renders on `timeupdate`, alone. */
function TimeLabel({ video }: { video: HTMLVideoElement | null }) {
  const current = useMedia(video, "timeupdate seeking seeked loadedmetadata durationchange emptied", (v) => v.currentTime, 0);
  const duration = useMedia(video, "loadedmetadata durationchange emptied", (v) => (Number.isFinite(v.duration) ? v.duration : 0), 0);
  return (
    <span data-time className="px-1 text-xs whitespace-nowrap tabular-nums sm:text-sm">
      {formatTime(current, duration)} <span className="text-white/70">/ {formatTime(duration)}</span>
    </span>
  );
}

function VolumeControls({ video, slider }: { video: HTMLVideoElement | null; slider: boolean }) {
  const muted = useMedia(video, "volumechange", (v) => v.muted, false);
  const volume = useMedia(video, "volumechange", (v) => v.volume, 1);
  const Icon = muted || volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon;
  return (
    <div className="flex items-center">
      <button
        type="button"
        className={controlButton}
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={() => {
          if (!video) return;
          media.toggleMute(video);
        }}
      >
        <Icon aria-hidden />
      </button>
      {slider && (
        <Slider
          data-volume=""
          min={0}
          max={100}
          step={5}
          value={[Math.round(volume * 100)]}
          onValueChange={([v]) => {
            if (!video) return;
            media.setVolume(video, v / 100);
          }}
          className={cn("h-11 w-20 cursor-pointer px-1", muted && "opacity-60")}
          trackClassName="bg-white/30"
          rangeClassName="bg-white"
          thumbClassName="border-white"
          thumbProps={{ "aria-label": "Volume", "aria-valuetext": volumeLabel(volume, muted) }}
        />
      )}
    </div>
  );
}

function SpeedMenu({
  video,
  container,
  onOpenChange,
}: {
  video: HTMLVideoElement | null;
  container: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}) {
  const rate = useMedia(video, "ratechange", (v) => v.playbackRate, 1);
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        className={cn(controlButton, "w-auto min-w-11 px-2 text-sm font-medium tabular-nums")}
        aria-label={`Playback speed ${rateLabel(rate)}`}
      >
        {rateLabel(rate)}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" container={container} className="w-auto min-w-36">
        <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(rate)}
          onValueChange={(v) => {
            if (video) media.setRate(video, Number(v));
          }}
        >
          {PLAYBACK_RATES.map((r) => (
            <DropdownMenuRadioItem key={r} value={String(r)} className="min-h-11 sm:min-h-8">
              {r === 1 ? "Normal" : rateLabel(r)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Below this width the player puts back, play and forward in the middle (phones), not in the bar. */
const COMPACT_WIDTH = 480;
/** Below this width there's no room for the volume slider: mute stays, and ↑/↓ still change the volume. */
const NARROW_WIDTH = 420;

export function MediaPlayer({
  sources,
  poster,
  label,
  autoPlay = false,
  ref,
  className,
}: {
  sources: MediaSources;
  /** Our own image (e.g. from /_next/static), shown until the first frame. */
  poster?: string;
  /** The player's accessible name, e.g. "InkBoard walkthrough video". */
  label: string;
  /** Try to start at once (after the reader pressed a play button); if the browser refuses, it waits, ready. */
  autoPlay?: boolean;
  ref?: React.Ref<MediaPlayerHandle>;
  className?: string;
}) {
  const [src] = useState(() => pickSource(sources, canPlayHls()));
  const [volumeSettable] = useState(canSetVolume);
  const [video, setVideo] = useState<WebkitVideo | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(COMPACT_WIDTH);
  const [error, setError] = useState(false);
  const [awake, setAwake] = useState(true);
  const [focusHeld, setFocusHeld] = useState(false);
  const [hoverHeld, setHoverHeld] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const autoStarted = useRef(false);
  const primary = useRef<HTMLButtonElement>(null);

  const paused = useMedia(video, STATE_EVENTS, (v) => v.paused, true);
  const ended = useMedia(video, STATE_EVENTS, (v) => v.ended, false);
  // Buffering while it should be playing; before any metadata while paused. iOS loads no data until play, so a
  // paused video with metadata isn't "loading".
  const loading = useMedia(
    video,
    STATE_EVENTS,
    (v) => !v.error && (v.paused ? v.readyState < HTMLMediaElement.HAVE_METADATA : v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
    true,
  );

  const fullscreenSubscribe = useCallback(
    (onChange: () => void) => {
      const docEvents = ["fullscreenchange", "webkitfullscreenchange"];
      const videoEvents = ["webkitbeginfullscreen", "webkitendfullscreen"];
      for (const e of docEvents) document.addEventListener(e, onChange);
      for (const e of videoEvents) video?.addEventListener(e, onChange);
      return () => {
        for (const e of docEvents) document.removeEventListener(e, onChange);
        for (const e of videoEvents) video?.removeEventListener(e, onChange);
      };
    },
    [video],
  );
  const fullscreen = useSyncExternalStore(
    fullscreenSubscribe,
    () => {
      const d = document as WebkitDocument;
      const el = d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
      return (root !== null && el === root) || video?.webkitDisplayingFullscreen === true;
    },
    () => false,
  );
  const pip = useMedia(
    video,
    "enterpictureinpicture leavepictureinpicture webkitpresentationmodechanged",
    (v) => document.pictureInPictureElement === v || v.webkitPresentationMode === "picture-in-picture",
    false,
  );

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setAwake(false), CONTROLS_HIDE_MS);
  }, []);

  const playing = !paused && !ended;
  const held = !playing || error || focusHeld || hoverHeld || menuOpen || dragging;
  const shown = awake || held;
  const compact = width < COMPACT_WIDTH;
  const narrow = width < NARROW_WIDTH;
  const state = error ? "error" : ended ? "ended" : loading ? "loading" : paused ? "paused" : "playing";

  const play = useCallback(() => {
    // A refusal (autoplay rules) leaves the player paused and ready; nothing else to do.
    video?.play().catch(() => {});
  }, [video]);

  const toggle = () => {
    if (!video) return;
    if (video.paused || video.ended) play();
    else video.pause();
    wake();
  };
  const skip = (delta: number) => {
    if (video) media.seek(video, skipTo(video.currentTime, delta, video.duration));
  };

  const elementFullscreen = () => {
    const el = root as WebkitElement | null;
    if (!el) return null;
    const d = document as WebkitDocument;
    if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled) return "standard" as const;
    if (el.webkitRequestFullscreen && d.webkitFullscreenEnabled) return "webkit" as const;
    return null;
  };
  // iPhone Safari has no element full screen: the video itself goes full screen there, with the system's controls.
  const canFullscreen = elementFullscreen() !== null || video?.webkitSupportsFullscreen === true;
  const toggleFullscreen = () => {
    const d = document as WebkitDocument;
    if (fullscreen) {
      if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
      else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.();
      else video?.webkitExitFullscreen?.();
      screen.orientation?.unlock?.();
      return;
    }
    const kind = elementFullscreen();
    if (kind === "standard") {
      root!
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          // Phones: turn a 16:9 video sideways where the browser allows it (Android); ignored elsewhere.
          if (window.matchMedia("(pointer: coarse)").matches) {
            (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
          }
        })
        .catch(() => {});
    } else if (kind === "webkit") (root as WebkitElement).webkitRequestFullscreen!();
    else video?.webkitEnterFullscreen?.();
  };

  const canPip =
    typeof document !== "undefined" &&
    ((document.pictureInPictureEnabled && !video?.disablePictureInPicture) || video?.webkitSupportsPresentationMode?.("picture-in-picture") === true);
  const togglePip = () => {
    if (!video) return;
    if (document.pictureInPictureEnabled) {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      else video.requestPictureInPicture().catch(() => {});
    } else {
      video.webkitSetPresentationMode?.(pip ? "inline" : "picture-in-picture");
    }
  };

  const run = (action: PlayerAction) => {
    if (!video) return;
    switch (action) {
      case "toggle":
        return toggle();
      case "back":
        return skip(-SKIP_SECONDS);
      case "forward":
        return skip(SKIP_SECONDS);
      case "volume-up":
      case "volume-down":
        media.setVolume(video, stepVolume(video.volume, action === "volume-up" ? 1 : -1));
        return;
      case "mute":
        media.toggleMute(video);
        return;
      case "fullscreen":
        if (canFullscreen) toggleFullscreen();
        return;
      case "start":
        media.seek(video, 0);
        return;
      case "end":
        if (Number.isFinite(video.duration)) media.seek(video, video.duration);
        return;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const target = t.closest('[role="menu"]')
      ? "menu"
      : t.getAttribute("role") === "slider"
        ? "slider"
        : t.closest("button, a")
          ? "button"
          : "other";
    const action = playerKeyAction(e.key, target, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
    if (!action) return;
    e.preventDefault();
    wake();
    run(action);
  };

  useImperativeHandle(ref, () => ({ pause: () => video?.pause(), focusPrimary: () => primary.current?.focus() }), [video]);

  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;
      setVideo(el);
      // Once per player: React re-runs ref callbacks (StrictMode, Fast Refresh) on the same element, and a second
      // start would undo the reader's pause.
      if (autoPlay && !autoStarted.current) {
        autoStarted.current = true;
        el.play().catch(() => {});
      }
      return () => {
        // Closing frees the video: stop it and drop its source, so the download ends too. Only once it has really
        // left the page: React's StrictMode (development) detaches and re-attaches refs on the same, still-mounted
        // element, and a dropped src would never come back.
        queueMicrotask(() => {
          if (el.isConnected) return;
          el.pause();
          el.removeAttribute("src");
          el.load();
        });
      };
    },
    [autoPlay],
  );
  const rootRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setRoot(el);
    const ro = new ResizeObserver(([entry]) => {
      // Crossing COMPACT_WIDTH moves the main button between the bar and the middle: keep focus on it.
      const hadFocus = document.activeElement !== null && document.activeElement === primary.current;
      flushSync(() => setWidth(Math.round(entry.contentRect.width)));
      if (hadFocus && document.activeElement !== primary.current) primary.current?.focus();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  const primaryLabel = ended ? "Replay" : playing ? "Pause" : "Play";
  const PrimaryIcon = ended ? RotateCcwIcon : playing ? PauseIcon : PlayIcon;
  const primaryButton = (big: boolean) => (
    <button
      ref={primary}
      type="button"
      className={cn(controlButton, big && "size-16 bg-black/45 backdrop-blur-sm [&_svg]:size-8")}
      aria-label={primaryLabel}
      data-primary=""
      onClick={toggle}
    >
      {big && loading ? (
        <LoaderCircleIcon aria-hidden data-loading="" className="motion-safe:animate-spin" />
      ) : (
        <PrimaryIcon aria-hidden className={cn(!ended && "fill-current")} />
      )}
    </button>
  );
  const skipButton = (back: boolean, big: boolean) => (
    <button
      type="button"
      className={cn(controlButton, big && "size-12 bg-black/35 backdrop-blur-sm")}
      aria-label={back ? `Back ${SKIP_SECONDS} seconds` : `Forward ${SKIP_SECONDS} seconds`}
      onClick={() => skip(back ? -SKIP_SECONDS : SKIP_SECONDS)}
    >
      <SkipIcon back={back} />
    </button>
  );

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={label}
      tabIndex={-1}
      data-media-player=""
      data-state={state}
      data-controls={shown ? "shown" : "hidden"}
      data-fullscreen={fullscreen ? "true" : undefined}
      onKeyDown={onKeyDown}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") wake();
      }}
      onFocus={wake}
      className={cn(
        "relative isolate w-full overflow-hidden bg-black text-white outline-none select-none",
        fullscreen ? "h-full" : "aspect-video",
        !shown && "cursor-none",
        className,
      )}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="auto"
        aria-hidden
        onError={() => setError(true)}
        className="absolute inset-0 size-full bg-black object-contain"
      />

      {/* The surface: a click plays or pauses (mouse); a tap shows or hides the controls (touch); a double click is full screen. */}
      <div
        className="absolute inset-0"
        onPointerUp={(e) => {
          if (error) return;
          if (e.pointerType === "mouse") {
            if (e.button === 0) toggle();
          } else if (shown && playing) {
            window.clearTimeout(hideTimer.current);
            setAwake(false);
          } else wake();
        }}
        onDoubleClick={() => {
          if (canFullscreen) toggleFullscreen();
        }}
      />

      {/* The middle: loading, the error, or (phones) back · play · forward; wide players show a big play sign when paused. */}
      {/* On phones the middle stops above the bar, so its buttons and the bar never overlap in a short frame. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center",
          compact && !error ? "bottom-[4.25rem]" : "bottom-0",
        )}
      >
        {error ? (
          <div className="pointer-events-auto mx-4 grid max-w-sm justify-items-center gap-3 rounded-xl bg-black/75 p-4 text-center">
            <p role="alert" className="text-sm">
              The video couldn’t load. Check your connection and try again.
            </p>
            <button
              type="button"
              className="min-h-11 rounded-full bg-white px-5 text-sm font-medium text-black outline-none focus-visible:ring-3 focus-visible:ring-white/70"
              onClick={() => {
                setError(false);
                if (!video) return;
                video.load();
                play();
              }}
            >
              Try again
            </button>
          </div>
        ) : compact ? (
          <div
            className={cn(
              "flex items-center gap-6 motion-safe:transition-opacity motion-safe:duration-200",
              shown ? "pointer-events-auto opacity-100" : "opacity-0",
            )}
            onFocus={(e) => setFocusHeld((e.target as HTMLElement).matches(":focus-visible"))}
            onBlur={() => setFocusHeld(false)}
          >
            {skipButton(true, true)}
            {primaryButton(true)}
            {skipButton(false, true)}
          </div>
        ) : loading ? (
          <LoaderCircleIcon aria-hidden data-loading="" className="size-10 motion-safe:animate-spin" />
        ) : (
          !playing && (
            <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
              <PrimaryIcon className={cn("size-8", !ended && "fill-current")} />
            </span>
          )
        )}
      </div>

      {/* The bar: seek, then the buttons. Safe areas apply in full screen (notches, home indicator). */}
      <div
        data-controls-bar=""
        className={cn(
          // The gradient itself takes no pointer events (only its rows do), so it never covers the middle's buttons.
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-[max(0.5rem,env(safe-area-inset-left))] pb-[max(0.25rem,env(safe-area-inset-bottom))] motion-safe:transition-opacity motion-safe:duration-200",
          compact ? "pt-4" : "pt-8",
          fullscreen && "pr-[max(0.5rem,env(safe-area-inset-right))]",
          shown ? "opacity-100 *:pointer-events-auto" : "opacity-0",
        )}
        hidden={error}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHoverHeld(true)}
        onPointerLeave={() => setHoverHeld(false)}
        onFocus={(e) => setFocusHeld((e.target as HTMLElement).matches(":focus-visible"))}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusHeld(false);
        }}
      >
        <div className="px-1.5">
          <SeekBar video={video} onDragChange={setDragging} />
        </div>
        <div className="flex items-center">
          {!compact && (
            <>
              {primaryButton(false)}
              {skipButton(true, false)}
              {skipButton(false, false)}
            </>
          )}
          <VolumeControls video={video} slider={volumeSettable && !narrow} />
          <TimeLabel video={video} />
          <span className="flex-1" />
          <SpeedMenu video={video} container={fullscreen ? root : null} onOpenChange={setMenuOpen} />
          {canPip && (
            <button
              type="button"
              className={controlButton}
              aria-label={pip ? "Exit picture in picture" : "Picture in picture"}
              onClick={togglePip}
            >
              <PictureInPicture2Icon aria-hidden />
            </button>
          )}
          {canFullscreen && (
            <button
              type="button"
              className={controlButton}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <MinimizeIcon aria-hidden /> : <MaximizeIcon aria-hidden />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
