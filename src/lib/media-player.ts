/*
 * The rules of InkBoard's media player (src/components/media-player/), pure
 * so they can be tested without a browser: time labels, skips, volume steps,
 * the keyboard map and which source a browser plays.
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
    case "Home":
      return "start";
    case "End":
      return "end";
    default:
      return null;
  }
}

/** The one URL the player loads: HLS where the browser plays it natively (Safari, iOS, Android), else the MP4. */
export function pickSource(sources: { hls?: string; mp4: string }, canPlayHls: boolean): string {
  return sources.hls && canPlayHls ? sources.hls : sources.mp4;
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
