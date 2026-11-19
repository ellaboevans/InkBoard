"use client";

import { cn } from "cn";
import {
  CaptionsIcon,
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
import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
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
  AUTO_RETRY_DELAY_MS,
  captionFontSize,
  captionLift,
  captionMode,
  captionText,
  CONTROLS_HIDE_MS,
  cueText,
  formatTime,
  pickSource,
  PLAYBACK_RATES,
  playerKeyAction,
  rateLabel,
  resumePosition,
  retriesAfterProgress,
  seekLabel,
  shouldAutoRetry,
  SKIP_SECONDS,
  skipTo,
  stepVolume,
  volumeLabel,
  type PlaybackEnvironment,
  type PlayerAction,
  type PlayerSources,
} from "@/lib/media-player";

/*
 * InkBoard's own media player (docs/PLAN.md, Phase 30). One component for any
 * video: a <video> with our controls over it (play/pause, back and forward
 * 10 s, a seek bar with the time, mute and volume, playback speed,
 * picture-in-picture where the browser has it, full screen), keyboard
 * shortcuts while it has focus, and loading, ended and error states. No
 * quality choice: the source is one file (or the browser's own HLS), chosen
 * once when it opens: a lighter copy on phones (Phase 31, `pickSource`).
 *
 * Captions (Phase 31): a CC button (and C), off by default, never
 * remembered. The player draws the active cue itself (the track's mode
 * "hidden", read on `cuechange`) so it can sit above the control bar while
 * the controls show and drop back when they hide, at a size that follows the
 * frame, on a dark backing; the browser's own rendering can't be moved like
 * that. Where our overlay isn't what's on screen (iPhone's own full screen,
 * picture-in-picture) the track is "showing", so the system draws them. The
 * .vtt is ours (same origin: no CORS, `media-src 'self'`) and is fetched only
 * once captions are first turned on (a disabled track loads nothing).
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

export type MediaSources = PlayerSources;

/** A captions file on our own origin (WebVTT). */
export type MediaCaptions = { src: string; lang: string; label: string };

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
  setTrackMode(t: TextTrack, mode: TextTrackMode) {
    if (t.mode !== mode) t.mode = mode;
  },
  /**
   * Load the source again from scratch: setting `src` (even to the same URL) restarts the load, and restores an
   * element whose source was dropped; `load()` alone would not. Back to `at` once the length is known, then play
   * if the reader was watching (from a tap, that's their gesture, so iOS allows sound).
   */
  reload(v: HTMLVideoElement, url: string, at: number, resume: boolean) {
    v.src = url;
    if (at > 0) v.addEventListener("loadedmetadata", () => (v.currentTime = at), { once: true });
    if (resume) v.play().catch(() => {});
  },
};

const NOOP = () => () => {};

/*
 * Snapshots of the media element's state, one per element and value name,
 * taken when one of the value's events fires (and once on first read).
 *
 * Never hand useSyncExternalStore a live read: React calls getSnapshot more
 * than once per render and requires the same answer each time until the
 * store says it changed. WebKit's `currentTime` advances between two reads
 * in the same task (Chrome's doesn't), so a live read made every playing
 * render look torn: React re-rendered until it threw "Maximum update depth
 * exceeded" (#185), which took the About page down on every iPhone and in
 * desktop Safari a moment into playback (Phase 30 fix-up).
 */
const snapshots = new WeakMap<HTMLMediaElement, Map<string, unknown>>();

function snapshotOf<T>(video: WebkitVideo, name: string, read: (v: WebkitVideo) => T): T {
  let values = snapshots.get(video);
  if (!values) snapshots.set(video, (values = new Map()));
  if (!values.has(name)) values.set(name, read(video));
  return values.get(name) as T;
}

/** A value read from the media element, re-read (and cached under `name`) on the given events only. */
function useMedia<T extends string | number | boolean>(
  video: HTMLVideoElement | null,
  name: string,
  events: string,
  read: (v: WebkitVideo) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!video) return () => {};
      const names = events.split(" ");
      const handler = () => {
        let values = snapshots.get(video);
        if (!values) snapshots.set(video, (values = new Map()));
        values.set(name, read(video as WebkitVideo));
        onChange();
      };
      for (const e of names) video.addEventListener(e, handler);
      return () => {
        for (const e of names) video.removeEventListener(e, handler);
      };
    },
    // `read` is a fresh closure every render but always reads the same property for a given `name`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [video, name, events],
  );
  return useSyncExternalStore(
    video ? subscribe : NOOP,
    () => (video ? snapshotOf(video as WebkitVideo, name, read) : fallback),
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

/** What `pickSource` needs to know, read once when the player opens. */
function playbackEnvironment(): PlaybackEnvironment {
  if (typeof window === "undefined") return { canPlayHls: false };
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return {
    canPlayHls: canPlayHls(),
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    saveData: connection?.saveData === true,
  };
}

const STATE_EVENTS = "loadstart loadedmetadata loadeddata canplay canplaythrough waiting playing play pause ended seeking seeked stalled emptied error";

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
  const current = useMedia(video, "currentTime", "timeupdate seeking seeked loadedmetadata durationchange emptied", (v) => v.currentTime, 0);
  const duration = useMedia(video, "duration", "loadedmetadata durationchange emptied", (v) => (Number.isFinite(v.duration) ? v.duration : 0), 0);
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
  const current = useMedia(video, "currentTime", "timeupdate seeking seeked loadedmetadata durationchange emptied", (v) => v.currentTime, 0);
  const duration = useMedia(video, "duration", "loadedmetadata durationchange emptied", (v) => (Number.isFinite(v.duration) ? v.duration : 0), 0);
  return (
    <span data-time className="px-1 text-xs whitespace-nowrap tabular-nums sm:text-sm">
      {formatTime(current, duration)} <span className="text-white/70">/ {formatTime(duration)}</span>
    </span>
  );
}

function VolumeControls({ video, slider }: { video: HTMLVideoElement | null; slider: boolean }) {
  const muted = useMedia(video, "muted", "volumechange", (v) => v.muted, false);
  const volume = useMedia(video, "volume", "volumechange", (v) => v.volume, 1);
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
  const rate = useMedia(video, "rate", "ratechange", (v) => v.playbackRate, 1);
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

/** The active cues' text per track, taken when the track or the video says it may have changed (never a live read). */
const cueSnapshots = new WeakMap<TextTrack, string>();

function activeCueText(track: TextTrack): string {
  const cues = track.activeCues;
  if (!cues) return "";
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const text = cueText((cues[i] as VTTCue).text ?? "");
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

/**
 * The active cue, drawn by us. Re-renders only when its text changes: `cuechange`, the track's `load` and the
 * video's time events re-read the cues, and the snapshot is a string, so an unchanged cue is no render.
 */
function Captions({
  trackEl,
  video,
  lang,
  compact,
  width,
  lift,
  safeArea,
}: {
  trackEl: HTMLTrackElement;
  video: HTMLVideoElement;
  lang: string;
  compact: boolean;
  width: number;
  /** CSS px above the frame's bottom edge. */
  lift: number;
  /** Add the bottom safe area (full screen with the controls hidden: the bar isn't there to add it). */
  safeArea: boolean;
}) {
  const track = trackEl.track;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const update = () => {
        cueSnapshots.set(track, activeCueText(track));
        onChange();
      };
      // Mounting is turning them on: forget a cue left from the last time.
      cueSnapshots.set(track, activeCueText(track));
      track.addEventListener("cuechange", update);
      trackEl.addEventListener("load", update);
      for (const e of ["timeupdate", "seeked"]) video.addEventListener(e, update);
      return () => {
        track.removeEventListener("cuechange", update);
        trackEl.removeEventListener("load", update);
        for (const e of ["timeupdate", "seeked"]) video.removeEventListener(e, update);
      };
    },
    [track, trackEl, video],
  );
  const text = useSyncExternalStore(
    subscribe,
    () => {
      if (!cueSnapshots.has(track)) cueSnapshots.set(track, activeCueText(track));
      return cueSnapshots.get(track)!;
    },
    () => "",
  );
  if (!text) return null;
  return (
    // Visual only: screen reader users hear the same words in the narration, and a live region would talk over it.
    <div
      aria-hidden
      data-captions=""
      lang={lang}
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-[4%] motion-safe:transition-transform motion-safe:duration-200"
      style={{
        fontSize: captionFontSize(width),
        transform: safeArea ? `translateY(calc(-${lift}px - env(safe-area-inset-bottom, 0px)))` : `translateY(-${lift}px)`,
      }}
    >
      <p className="max-w-full text-center leading-[1.4] font-medium text-balance whitespace-pre-line">
        <span data-cue="" className="rounded-[0.2em] bg-black/80 px-[0.45em] py-[0.12em] text-white box-decoration-clone">
          {captionText(text, compact)}
        </span>
      </p>
    </div>
  );
}

/** Below this width the player puts back, play and forward in the middle (phones), not in the bar. */
const COMPACT_WIDTH = 480;
/** Below this width there's no room for the volume slider: mute stays, and ↑/↓ still change the volume. */
const NARROW_WIDTH = 420;
/** Below this width (the smallest phones) the bar has no room for picture-in-picture next to captions. */
const TINY_WIDTH = 340;

export function MediaPlayer({
  sources,
  captions,
  poster,
  label,
  autoPlay = false,
  ref,
  className,
}: {
  sources: MediaSources;
  /** Captions for the CC button; without them there's no button. */
  captions?: MediaCaptions;
  /** Our own image (e.g. from /_next/static), shown until the first frame. */
  poster?: string;
  /** The player's accessible name, e.g. "InkBoard walkthrough video". */
  label: string;
  /** Try to start at once (after the reader pressed a play button); if the browser refuses, it waits, ready. */
  autoPlay?: boolean;
  ref?: React.Ref<MediaPlayerHandle>;
  className?: string;
}) {
  // Chosen once, here: never switched during playback or on rotation, and Try again reloads this same file.
  const [src] = useState(() => pickSource(sources, playbackEnvironment()));
  const [volumeSettable] = useState(canSetVolume);
  const [video, setVideo] = useState<WebkitVideo | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(COMPACT_WIDTH);
  const [error, setError] = useState(false);
  /** The last MediaError code, kept after recovering: `data-media-error`, for the browser's dev tools only. */
  const [errorCode, setErrorCode] = useState<number | null>(null);
  /** Waiting to retry by itself after a network error: the spinner, not the error. */
  const [retrying, setRetrying] = useState(false);
  const [awake, setAwake] = useState(true);
  const [focusHeld, setFocusHeld] = useState(false);
  const [hoverHeld, setHoverHeld] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [trackEl, setTrackEl] = useState<HTMLTrackElement | null>(null);
  /** From the bar's bottom to the top of its visible controls (the seek row), in CSS px. */
  const [controlsHeight, setControlsHeight] = useState(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const autoStarted = useRef(false);
  // Recovery bookkeeping, never state: the last position the reader reached (before any error), whether they
  // meant it to play, the automatic retries in this error episode, where the last one resumed, and whether the
  // player has left the page (then nothing is retried).
  const lastTime = useRef(0);
  const wantsPlay = useRef(autoPlay);
  const autoRetries = useRef(0);
  const retryAt = useRef<number | null>(null);
  const retryTimer = useRef<number | undefined>(undefined);
  const closed = useRef(false);
  /** A reload is on its way back to the saved position: its timeupdates at 0 aren't the reader's. */
  const resuming = useRef(false);
  const primary = useRef<HTMLButtonElement>(null);

  const paused = useMedia(video, "paused", STATE_EVENTS, (v) => v.paused, true);
  const ended = useMedia(video, "ended", STATE_EVENTS, (v) => v.ended, false);
  // Buffering while it should be playing; before any metadata while paused. iOS loads no data until play, so a
  // paused video with metadata isn't "loading".
  const loading = useMedia(
    video,
    "loading",
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
  // "element": our player in full screen, with our controls; "native": the video in the system's (iPhone).
  const fullscreenKind = useSyncExternalStore(
    fullscreenSubscribe,
    () => {
      const d = document as WebkitDocument;
      const el = d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
      if (root !== null && el === root) return "element";
      return video?.webkitDisplayingFullscreen === true ? "native" : "none";
    },
    () => "none",
  );
  const fullscreen = fullscreenKind !== "none";
  const pip = useMedia(
    video,
    "pip",
    "enterpictureinpicture leavepictureinpicture webkitpresentationmodechanged",
    (v) => document.pictureInPictureElement === v || v.webkitPresentationMode === "picture-in-picture",
    false,
  );
  /** The system's player is what's on screen (iPhone full screen, picture-in-picture): it draws the captions there. */
  const systemPlayer = fullscreenKind === "native" || pip;

  // The track's mode follows the CC button; browsers that turn captions on by themselves (Safari, from the system's
  // caption setting) are put back, except inside the system's full screen, where its own menu is the reader's.
  useEffect(() => {
    const track = trackEl?.track;
    if (!track || !video) return;
    const want = captionMode(captionsOn, systemPlayer);
    media.setTrackMode(track, want);
    const tracks = video.textTracks;
    const onChange = () => {
      if (!video.webkitDisplayingFullscreen) media.setTrackMode(track, want);
    };
    // Leaving the system's full screen: keep what the reader chose in its menu.
    const onEndNative = () => setCaptionsOn(track.mode === "showing");
    tracks.addEventListener("change", onChange);
    video.addEventListener("webkitendfullscreen", onEndNative);
    return () => {
      tracks.removeEventListener("change", onChange);
      video.removeEventListener("webkitendfullscreen", onEndNative);
    };
  }, [trackEl, video, captionsOn, systemPlayer]);

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setAwake(false), CONTROLS_HIDE_MS);
  }, []);

  const playing = !paused && !ended;
  const busy = loading || retrying;
  const held = !playing || error || focusHeld || hoverHeld || menuOpen || dragging;
  const shown = awake || held;
  const compact = width < COMPACT_WIDTH;
  const narrow = width < NARROW_WIDTH;
  const tiny = width < TINY_WIDTH;
  /** Our own captions are on screen (not the system player's). */
  const captionsShown = captions !== undefined && captionsOn && !systemPlayer && !error;
  const state = error ? "error" : ended ? "ended" : busy ? "loading" : paused ? "paused" : "playing";

  const play = useCallback(() => {
    wantsPlay.current = true;
    // A refusal (autoplay rules) leaves the player paused and ready; nothing else to do.
    video?.play().catch(() => {});
  }, [video]);

  const toggle = () => {
    if (!video) return;
    if (video.paused || video.ended) play();
    else {
      wantsPlay.current = false;
      video.pause();
    }
    wake();
  };

  /** Try again: the same file afresh, back where the reader was, playing from this tap. */
  const retry = () => {
    window.clearTimeout(retryTimer.current);
    autoRetries.current = 0;
    retryAt.current = null;
    setError(false);
    setRetrying(false);
    if (!video) return;
    wantsPlay.current = true;
    const at = resumePosition(lastTime.current);
    resuming.current = at > 0;
    media.reload(video, src, at, true);
  };

  const toggleCaptions = () => {
    const next = !captionsOn;
    // At once, from the press: the first time, this is what fetches the .vtt.
    const track = trackEl?.track;
    if (track) media.setTrackMode(track, captionMode(next, systemPlayer));
    setCaptionsOn(next);
    wake();
  };

  const onMediaError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (closed.current) return;
    const code = v.error?.code ?? 0;
    setErrorCode(code);
    if (shouldAutoRetry({ code, autoRetries: autoRetries.current, closed: closed.current })) {
      // Once, after a moment, from the same position; a second failure shows the error.
      autoRetries.current += 1;
      const at = resumePosition(lastTime.current);
      retryAt.current = at;
      setRetrying(true);
      window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => {
        setRetrying(false);
        if (closed.current) return;
        resuming.current = at > 0;
        media.reload(v, src, at, wantsPlay.current);
      }, AUTO_RETRY_DELAY_MS);
      return;
    }
    setError(true);
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
    else {
      // The system's player shows a track only while it's "showing": set it before going there.
      const track = trackEl?.track;
      if (track && captionsOn) media.setTrackMode(track, captionMode(true, true));
      video?.webkitEnterFullscreen?.();
    }
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
      case "captions":
        if (captions) toggleCaptions();
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

  useImperativeHandle(
    ref,
    () => ({
      pause: () => {
        wantsPlay.current = false;
        window.clearTimeout(retryTimer.current);
        video?.pause();
      },
      focusPrimary: () => primary.current?.focus(),
    }),
    [video],
  );

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
      // The position to come back to after an error: only real progress, never the 0 an emptied element reports.
      const onTime = (e: Event) => {
        if (e.type === "seeked") resuming.current = false;
        if (resuming.current || el.error || el.readyState === 0) return;
        lastTime.current = el.currentTime;
        autoRetries.current = retriesAfterProgress(autoRetries.current, retryAt.current, el.currentTime);
        if (autoRetries.current === 0) retryAt.current = null;
      };
      el.addEventListener("timeupdate", onTime);
      el.addEventListener("seeked", onTime);
      const onEnded = () => (wantsPlay.current = false);
      el.addEventListener("ended", onEnded);
      return () => {
        el.removeEventListener("timeupdate", onTime);
        el.removeEventListener("seeked", onTime);
        el.removeEventListener("ended", onEnded);
        // Closing frees the video: stop it and drop its source, so the download ends too. Only once it has really
        // left the page: React's StrictMode (development) detaches and re-attaches refs on the same, still-mounted
        // element, and a dropped src would never come back.
        queueMicrotask(() => {
          if (el.isConnected) return;
          closed.current = true;
          window.clearTimeout(retryTimer.current);
          el.pause();
          el.removeAttribute("src");
          el.load();
        });
      };
    },
    [autoPlay],
  );
  const barRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const row = el.firstElementChild as HTMLElement | null;
      setControlsHeight(el.offsetHeight - (row?.offsetTop ?? 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
      className={cn(
        controlButton,
        big && "bg-black/45 backdrop-blur-sm",
        big && (captionsShown ? "size-13 [&_svg]:size-6" : "size-16 [&_svg]:size-8"),
      )}
      aria-label={primaryLabel}
      data-primary=""
      onClick={toggle}
    >
      {big && busy ? (
        <LoaderCircleIcon aria-hidden data-loading="" className="motion-safe:animate-spin" />
      ) : (
        <PrimaryIcon aria-hidden className={cn(!ended && "fill-current")} />
      )}
    </button>
  );
  const skipButton = (back: boolean, big: boolean) => (
    <button
      type="button"
      className={cn(controlButton, big && "bg-black/35 backdrop-blur-sm", big && !captionsShown && "size-12")}
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
      data-media-error={errorCode ?? undefined}
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
        onError={onMediaError}
        className="absolute inset-0 size-full bg-black object-contain"
      >
        {captions && <track ref={setTrackEl} kind="captions" src={captions.src} srcLang={captions.lang} label={captions.label} />}
      </video>

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

      {/* Captions: under the middle's buttons and the bar, above the controls while they show. */}
      {captionsShown && trackEl && video && (
        <Captions
          trackEl={trackEl}
          video={video}
          lang={captions.lang}
          compact={compact}
          width={width}
          lift={captionLift(shown, controlsHeight)}
          safeArea={fullscreen && !shown}
        />
      )}

      {/* The middle: loading, the error, or (phones) back · play · forward; wide players show a big play sign when paused. */}
      {/* On phones the middle stops above the bar, so its buttons and the bar never overlap in a short frame. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex justify-center",
          compact && !error ? "bottom-[4.25rem]" : "bottom-0",
          // Phones with captions on: the buttons go to the top, so the cue between them and the bar can be read.
          compact && captionsShown && !error ? "items-start pt-2" : "items-center",
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
              onClick={retry}
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
        ) : busy ? (
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
        ref={barRef}
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
          {captions && (
            <button
              type="button"
              className={cn(
                controlButton,
                "relative after:absolute after:bottom-2 after:h-0.5 after:w-5 after:rounded-full after:bg-white after:opacity-0 aria-pressed:after:opacity-100",
              )}
              aria-label="Captions"
              aria-pressed={captionsOn}
              data-captions-toggle=""
              onClick={toggleCaptions}
            >
              <CaptionsIcon aria-hidden />
            </button>
          )}
          <SpeedMenu video={video} container={fullscreen ? root : null} onOpenChange={setMenuOpen} />
          {canPip && !(tiny && captions) && (
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
