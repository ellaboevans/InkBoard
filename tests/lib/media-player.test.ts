import { describe, expect, it } from "vitest";
import {
  AUTO_RETRY_LIMIT,
  AUTO_RETRY_RESET_SECONDS,
  formatTime,
  MEDIA_ERR_NETWORK,
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
  VOLUME_STEP,
  volumeLabel,
} from "@/lib/media-player";

/* The media player's rules (src/lib/media-player.ts; docs/PLAN.md Phase 30). */

describe("time labels", () => {
  it("formats minutes and seconds, and hours from an hour", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(7.9)).toBe("0:07");
    expect(formatTime(83)).toBe("1:23");
    expect(formatTime(361)).toBe("6:01");
    expect(formatTime(725)).toBe("12:05");
    expect(formatTime(3723)).toBe("1:02:03");
  });

  it("lines up with a long video's length", () => {
    expect(formatTime(300, 3600)).toBe("0:05:00");
    expect(formatTime(300, 361)).toBe("5:00");
  });

  it("treats unknown times as 0:00", () => {
    for (const t of [NaN, Infinity, -Infinity, -5]) expect(formatTime(t)).toBe("0:00");
  });

  it("speaks the seek bar's value", () => {
    expect(seekLabel(83, 361)).toBe("1:23 of 6:01");
    expect(seekLabel(0, NaN)).toBe("0:00 of 0:00");
  });
});

describe("skipping", () => {
  it("moves ten seconds", () => {
    expect(SKIP_SECONDS).toBe(10);
    expect(skipTo(30, -SKIP_SECONDS, 361)).toBe(20);
    expect(skipTo(30, SKIP_SECONDS, 361)).toBe(40);
  });

  it("never goes before the start or past the end", () => {
    expect(skipTo(4, -10, 361)).toBe(0);
    expect(skipTo(355, 10, 361)).toBe(361);
    expect(skipTo(NaN, -10, 361)).toBe(0);
  });

  it("only clamps the start while the length is unknown", () => {
    expect(skipTo(5, 10, NaN)).toBe(15);
    expect(skipTo(5, 10, Infinity)).toBe(15);
    expect(skipTo(5, -10, NaN)).toBe(0);
  });
});

describe("volume", () => {
  it("steps by 5%, within 0 and 1, in whole percents", () => {
    expect(VOLUME_STEP).toBe(0.05);
    expect(stepVolume(0.6, 1)).toBe(0.65);
    expect(stepVolume(0.6, -1)).toBe(0.55);
    expect(stepVolume(0.98, 1)).toBe(1);
    expect(stepVolume(0.02, -1)).toBe(0);
    expect(stepVolume(0.1 + 0.2, 1)).toBe(0.35);
  });

  it("speaks the slider's value", () => {
    expect(volumeLabel(0.6, false)).toBe("Volume 60%");
    expect(volumeLabel(0.6, true)).toBe("Volume 60%, muted");
    expect(volumeLabel(1.2, false)).toBe("Volume 100%");
  });
});

describe("speeds", () => {
  it("offers normal speed and labels each", () => {
    expect(PLAYBACK_RATES).toContain(1);
    expect(rateLabel(1)).toBe("1×");
    expect(rateLabel(1.25)).toBe("1.25×");
  });
});

describe("the keyboard map", () => {
  it("maps the shortcuts while the player has focus", () => {
    const map = (key: string) => playerKeyAction(key, "other");
    expect([" ", "k", "K"].map(map)).toEqual(["toggle", "toggle", "toggle"]);
    expect(["ArrowLeft", "j", "J"].map(map)).toEqual(["back", "back", "back"]);
    expect(["ArrowRight", "l", "L"].map(map)).toEqual(["forward", "forward", "forward"]);
    expect(["ArrowUp", "ArrowDown"].map(map)).toEqual(["volume-up", "volume-down"]);
    expect(["m", "M", "f", "F"].map(map)).toEqual(["mute", "mute", "fullscreen", "fullscreen"]);
    expect(["Home", "End"].map(map)).toEqual(["start", "end"]);
    expect(["Escape", "Tab", "Enter", "x", "1"].map(map)).toEqual([null, null, null, null, null]);
  });

  it("leaves a focused slider its own keys, and takes the letters there", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
      expect(playerKeyAction(key, "slider"), key).toBeNull();
    }
    expect(playerKeyAction("k", "slider")).toBe("toggle");
    expect(playerKeyAction(" ", "slider")).toBe("toggle");
    expect(playerKeyAction("m", "slider")).toBe("mute");
  });

  it("lets a focused button take Space and Enter, but not the other shortcuts", () => {
    expect(playerKeyAction(" ", "button")).toBeNull();
    expect(playerKeyAction("Enter", "button")).toBeNull();
    expect(playerKeyAction("ArrowRight", "button")).toBe("forward");
    expect(playerKeyAction("k", "button")).toBe("toggle");
  });

  it("leaves an open menu every key, and the browser's own combinations alone", () => {
    for (const key of [" ", "ArrowDown", "k", "Enter"]) expect(playerKeyAction(key, "menu"), key).toBeNull();
    expect(playerKeyAction("f", "other", { ctrl: true })).toBeNull();
    expect(playerKeyAction("l", "other", { meta: true })).toBeNull();
    expect(playerKeyAction("ArrowLeft", "other", { alt: true })).toBeNull();
  });
});

describe("the source", () => {
  it("plays HLS only where the browser can, else the MP4", () => {
    const both = { hls: "https://h/x.m3u8", mp4: "https://h/x.mp4" };
    expect(pickSource(both, true)).toBe(both.hls);
    expect(pickSource(both, false)).toBe(both.mp4);
    expect(pickSource({ mp4: both.mp4 }, true)).toBe(both.mp4);
  });
});

describe("recovering from errors (Phase 30 fix-up)", () => {
  it("retries a network error by itself, once per episode", () => {
    expect(MEDIA_ERR_NETWORK).toBe(2);
    expect(AUTO_RETRY_LIMIT).toBe(1);
    expect(shouldAutoRetry({ code: 2, autoRetries: 0, closed: false })).toBe(true);
    expect(shouldAutoRetry({ code: 2, autoRetries: 1, closed: false })).toBe(false);
    expect(shouldAutoRetry({ code: 2, autoRetries: 5, closed: false })).toBe(false);
  });

  it("never retries other errors by itself: aborted, decode, unsupported (a host refusing from the start), unknown", () => {
    for (const code of [1, 3, 4, 0, null, undefined]) expect(shouldAutoRetry({ code, autoRetries: 0, closed: false }), String(code)).toBe(false);
  });

  it("never retries once the reader has closed the player", () => {
    expect(shouldAutoRetry({ code: 2, autoRetries: 0, closed: true })).toBe(false);
  });

  it("starts a new episode only after real progress past the retry point", () => {
    expect(retriesAfterProgress(1, 13.5, 13.5)).toBe(1);
    expect(retriesAfterProgress(1, 13.5, 13.5 + AUTO_RETRY_RESET_SECONDS - 0.1)).toBe(1);
    expect(retriesAfterProgress(1, 13.5, 13.5 + AUTO_RETRY_RESET_SECONDS)).toBe(0);
    // No retry pending, or an unknown time: unchanged.
    expect(retriesAfterProgress(0, null, 100)).toBe(0);
    expect(retriesAfterProgress(1, 13.5, NaN)).toBe(1);
    // A seek back before the retry point isn't progress.
    expect(retriesAfterProgress(1, 13.5, 2)).toBe(1);
  });

  it("resumes where the reader was, never at a negative or unknown time", () => {
    expect(resumePosition(83.4)).toBe(83.4);
    for (const t of [0, -1, NaN, Infinity]) expect(resumePosition(t), String(t)).toBe(0);
  });
});
