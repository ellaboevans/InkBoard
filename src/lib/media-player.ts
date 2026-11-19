/*
 * The rules of InkBoard's media player (src/components/media-player/), pure
 * so they can be tested without a browser: time labels, skips, volume steps,
 * the keyboard map, which source a browser plays (Phase 31: the lighter copy
 * for phones) and how captions are shown.
 */

/** How far back or forward the skip buttons and J/L/←/→ move. */
export const SKIP_SECONDS = 10;
/** One volume step (↑/↓ and the slider's arrow keys): 5%. */
export const VOLUME_STEP = 0.05;
/** Playback speeds offered in the speed menu. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
/** How long the controls stay after the last tap, mouse movement or key while playing. */
export const CONTROLS_HIDE_MS = 3000;

const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** "0:07", "1:23", "12:05", "1:02:03". Anything unknown (NaN, Infinity, negative) is 0:00. */
export function formatTime(seconds: number, longest = seconds): string {
  const s = Math.floor(finite(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  // Hours appear when the video is an hour or longer, so "0:05:00" and "1:00:00" line up.
  if (h > 0 || finite(longest) >= 3600) return `${h}:${String(m).padStart(2, "0")}:${sec}`;
  return `${m}:${sec}`;
}

/** The seek slider's spoken value: "1:23 of 6:01". */
export function seekLabel(current: number, duration: number): string {
  return `${formatTime(current, duration)} of ${formatTime(duration)}`;
}

/** Where a skip of `delta` seconds lands: never before 0 or after the end (when the length is known). */
export function skipTo(current: number, delta: number, duration: number): number {
  const target = finite(current) + delta;
  const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(Math.max(target, 0), end);
}

/** The volume after one step up (+1) or down (−1): 0 to 1, in whole percents. */
export function stepVolume(volume: number, direction: 1 | -1, step = VOLUME_STEP): number {
  const v = Number.isFinite(volume) ? volume : 1;
  return Math.min(1, Math.max(0, Math.round((v + direction * step) * 100) / 100));
}

/** The volume slider's spoken value: "Volume 60%", or "Volume 60%, muted". */
export function volumeLabel(volume: number, muted: boolean): string {
  const pct = `Volume ${Math.round(Math.min(1, Math.max(0, volume)) * 100)}%`;
  return muted ? `${pct}, muted` : pct;
}

/** "1×", "1.25×", "0.5×". */
export function rateLabel(rate: number): string {
  return `${rate}×`;
}

export type PlayerAction =
  | "toggle"
  | "back"
  | "forward"
  | "volume-up"
  | "volume-down"
  | "mute"
  | "fullscreen"
  | "captions"
  | "start"
  | "end";

/**
 * What a key pressed inside the player does, or null to leave it alone.
 *
 * `target` is what has focus: a slider keeps its own arrows, Home, End and
 * Page keys (the seek bar seeks, the volume slider changes the volume); a
 * button keeps Space and Enter (it presses itself); an open menu keeps every
 * key. Keys with Ctrl, Alt or ⌘ are the browser's and the system's.
 */
export function playerKeyAction(
  key: string,
  target: "slider" | "button" | "menu" | "other",
  modifiers: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {},
): PlayerAction | null {
  if (modifiers.ctrl || modifiers.alt || modifiers.meta) return null;
  if (target === "menu") return null;
  const sliderKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
  if (target === "slider" && sliderKeys.includes(key)) return null;
  if (target === "button" && (key === " " || key === "Enter")) return null;
  switch (key) {
    case " ":
    case "k":
    case "K":
      return "toggle";
    case "ArrowLeft":
    case "j":
    case "J":
      return "back";
    case "ArrowRight":
    case "l":
    case "L":
      return "forward";
    case "ArrowUp":
      return "volume-up";
    case "ArrowDown":
      return "volume-down";
    case "m":
    case "M":
      return "mute";
    case "f":
    case "F":
      return "fullscreen";
    case "c":
    case "C":
      return "captions";
    case "Home":
      return "start";
    case "End":
      return "end";
    default:
      return null;
  }
}

/** A video's files: the 1080p MP4, optionally a lighter (720p) MP4 for phones and HLS. */
export type PlayerSources = { hls?: string; mp4: string; mp4Small?: string };

/** A width and height in CSS pixels (`screen.width`/`height`, `innerWidth`/`innerHeight`). */
export type CssSize = { width: number; height: number };

/**
 * Screens whose short side is below this many CSS pixels get the small copy: phones (320–480 in portrait,
 * the largest about 440–480) and folded foldables; small tablets start around 600 (iPad mini 744).
 */
export const SMALL_SCREEN_MAX_CSS_PX = 600;

const shortSide = (size: CssSize | undefined) =>
  size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? Math.min(size.width, size.height)
    : 0;

/**
 * Whether this is a phone-sized screen, in CSS pixels. The short side, so rotating changes nothing. The screen
 * bounds the largest the video can ever be shown (full screen), so a small window on a big monitor still counts
 * as big; the viewport stands in where `screen` is missing or reports nonsense. The larger of the two decides,
 * so anyone who could see the difference gets the 1080p file. CSS pixels, not device pixels: they follow the
 * screen's physical size, and on a phone-sized screen 720p and 1080p look the same at arm's length, while a
 * 3× phone counted in device pixels (1179 across) would always look like it needed 1080p.
 */
export function isSmallScreen({ screen, viewport }: { screen?: CssSize; viewport?: CssSize }): boolean {
  const side = Math.max(shortSide(screen), shortSide(viewport));
  return side > 0 && side < SMALL_SCREEN_MAX_CSS_PX;
}

/** What the browser tells us when the player opens. */
export type PlaybackEnvironment = {
  canPlayHls: boolean;
  screen?: CssSize;
  viewport?: CssSize;
  /** `navigator.connection.saveData` (the browser's or system's data saver). */
  saveData?: boolean;
};

/**
 * The one URL the player loads, chosen once when it opens (never switched during playback or on rotation; Try
 * again and the automatic retry reload the same file): HLS where it's set and the browser plays it natively;
 * else the small copy, when there is one, on a phone-sized screen or with the data saver on; else the 1080p MP4.
 */
export function pickSource(sources: PlayerSources, env: PlaybackEnvironment): string {
  if (sources.hls && env.canPlayHls) return sources.hls;
  if (sources.mp4Small && (env.saveData === true || isSmallScreen(env))) return sources.mp4Small;
  return sources.mp4;
}

/*
 * Captions (Phase 31). The player draws the active cue itself (the track's
 * mode "hidden", read on `cuechange`), so it can sit above the control bar
 * while the controls show and drop back when they hide, with our own size and
 * backing; the browser's own rendering can't be moved like that (`::cue` has
 * no position, and a cue's `line` is reflowed differently by every engine).
 * Where our overlay can't be seen, the system's own player draws them
 * (iPhone's full screen, picture-in-picture): the track is "showing" there.
 */

/** The text track's mode for whether captions are on and whether the system's player is what's on screen. */
export function captionMode(on: boolean, systemPlayer: boolean): TextTrackMode {
  if (!on) return "disabled";
  return systemPlayer ? "showing" : "hidden";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: "\u00a0", lrm: "\u200e", rlm: "\u200f" };

/** A cue's text as plain text: WebVTT's tags (<i>, <b>, <v Name>, timestamps) dropped, its entities decoded, its line breaks kept. */
export function cueText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name: string) => ENTITIES[name])
    .trim();
}

/** The lines to draw: the cue's own line breaks on a wide player; one line to wrap evenly on a narrow one. */
export function captionText(text: string, compact: boolean): string {
  return compact ? text.replace(/\s*\n\s*/g, " ") : text;
}

/** The captions' font size in CSS px for a player this wide: 15 on phones, growing with the frame, at most 36. */
export function captionFontSize(playerWidth: number): number {
  const w = Number.isFinite(playerWidth) && playerWidth > 0 ? playerWidth : 0;
  return Math.min(36, Math.max(15, Math.round(w * 0.024)));
}

/** The gap in CSS px between the captions and the top of the controls, or the frame's bottom when they hide. */
export const CAPTION_GAP = 8;
export const CAPTION_BOTTOM = 12;

/** How far above the player's bottom edge the captions sit: above the controls while they show. */
export function captionLift(controlsShown: boolean, controlsHeight: number): number {
  return controlsShown && controlsHeight > 0 ? Math.ceil(controlsHeight) + CAPTION_GAP : CAPTION_BOTTOM;
}

/*
 * Recovering from errors (Phase 30 fix-up). What the engines raise, measured
 * against R2 and a local fixture (docs/PLAN.md Phase 30): a host that refuses
 * from the start is code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED) in Chrome and
 * WebKit; a connection lost mid-play is code 2 (MEDIA_ERR_NETWORK) in Chrome
 * once its own retries give up, while WebKit just stalls (the spinner) and
 * resumes by itself.
 */

/** MediaError.MEDIA_ERR_NETWORK: the download failed after it had started. */
export const MEDIA_ERR_NETWORK = 2;
/** Automatic retries per error episode: one, never a loop. */
export const AUTO_RETRY_LIMIT = 1;
/** The automatic retry waits this long first, so a short drop is over by then (the spinner shows meanwhile). */
export const AUTO_RETRY_DELAY_MS = 2000;
/** Playback this far past the retry point ends the episode: a later drop gets its own retry. */
export const AUTO_RETRY_RESET_SECONDS = 10;

/** Whether an error should be retried by itself: a network error, the episode's first, while the player is still open. */
export function shouldAutoRetry({ code, autoRetries, closed }: { code: number | null | undefined; autoRetries: number; closed: boolean }): boolean {
  return !closed && code === MEDIA_ERR_NETWORK && autoRetries < AUTO_RETRY_LIMIT;
}

/** The retry count once playback has reached `now` after a retry at `retryAt` (null: no retry pending). */
export function retriesAfterProgress(autoRetries: number, retryAt: number | null, now: number): number {
  if (retryAt === null || !Number.isFinite(now)) return autoRetries;
  return now - retryAt >= AUTO_RETRY_RESET_SECONDS ? 0 : autoRetries;
}

/** Where to resume after an error: the last position known before it, never negative or unknown. */
export function resumePosition(lastKnown: number): number {
  return Number.isFinite(lastKnown) && lastKnown > 0 ? lastKnown : 0;
}
