import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_RETRY_LIMIT,
  AUTO_RETRY_RESET_SECONDS,
  CAPTION_BOTTOM,
  CAPTION_GAP,
  captionFontSize,
  captionLift,
  captionMode,
  captionText,
  cueText,
  formatTime,
  isSmallScreen,
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
  SMALL_SCREEN_MAX_CSS_PX,
  stepVolume,
  VOLUME_STEP,
  volumeLabel,
} from "@/lib/media-player";
import { WALKTHROUGH_VIDEO, WHATS_NEW_VIDEO } from "@/lib/site";

/* The media player's rules (src/lib/media-player.ts; docs/PLAN.md Phases 30 and 31). */

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
    expect(["c", "C"].map(map)).toEqual(["captions", "captions"]);
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
    expect(playerKeyAction("c", "button")).toBe("captions");
    expect(playerKeyAction("c", "slider")).toBe("captions");
  });

  it("leaves an open menu every key, and the browser's own combinations alone", () => {
    for (const key of [" ", "ArrowDown", "k", "Enter"]) expect(playerKeyAction(key, "menu"), key).toBeNull();
    expect(playerKeyAction("f", "other", { ctrl: true })).toBeNull();
    expect(playerKeyAction("l", "other", { meta: true })).toBeNull();
    expect(playerKeyAction("ArrowLeft", "other", { alt: true })).toBeNull();
    expect(playerKeyAction("c", "other", { meta: true })).toBeNull(); // ⌘C copies
    expect(playerKeyAction("c", "menu")).toBeNull();
  });
});

describe("the source (Phase 31: a lighter copy for phones)", () => {
  const all = { hls: "https://h/x.m3u8", mp4: "https://h/x-1080p.mp4", mp4Small: "https://h/x-720p.mp4" };
  const desktop = { screen: { width: 1440, height: 900 }, viewport: { width: 1280, height: 800 } };
  const phone = { screen: { width: 393, height: 852 }, viewport: { width: 393, height: 659 } };

  it("plays HLS first, wherever the browser can, even on a phone or with the data saver", () => {
    expect(pickSource(all, { canPlayHls: true, ...desktop })).toBe(all.hls);
    expect(pickSource(all, { canPlayHls: true, ...phone, saveData: true })).toBe(all.hls);
    expect(pickSource({ ...all, hls: undefined }, { canPlayHls: true, ...phone })).toBe(all.mp4Small);
  });

  it("gives phone-sized screens the small copy, in portrait and landscape, and bigger screens the 1080p file", () => {
    expect(pickSource(all, { canPlayHls: false, ...phone })).toBe(all.mp4Small);
    expect(pickSource(all, { canPlayHls: false, screen: { width: 852, height: 393 }, viewport: { width: 852, height: 361 } })).toBe(all.mp4Small);
    expect(pickSource(all, { canPlayHls: false, screen: { width: 320, height: 568 }, viewport: { width: 320, height: 454 } })).toBe(all.mp4Small);
    expect(pickSource(all, { canPlayHls: false, ...desktop })).toBe(all.mp4);
    // A tablet (iPad mini) and a 1280×800 laptop.
    expect(pickSource(all, { canPlayHls: false, screen: { width: 744, height: 1133 }, viewport: { width: 744, height: 1062 } })).toBe(all.mp4);
    expect(pickSource(all, { canPlayHls: false, screen: { width: 1280, height: 800 }, viewport: { width: 1280, height: 720 } })).toBe(all.mp4);
  });

  it("decides by the screen, not the window: a small window on a big monitor still gets 1080p", () => {
    expect(isSmallScreen({ screen: { width: 2560, height: 1440 }, viewport: { width: 400, height: 500 } })).toBe(false);
    // No usable screen size: the viewport decides.
    expect(isSmallScreen({ screen: { width: 0, height: 0 }, viewport: { width: 375, height: 667 } })).toBe(true);
    expect(isSmallScreen({ viewport: { width: 1280, height: 800 } })).toBe(false);
    // Nothing known: not small (the file everyone got before).
    expect(isSmallScreen({})).toBe(false);
    expect(isSmallScreen({ screen: { width: NaN, height: 800 } })).toBe(false);
    expect(isSmallScreen({ screen: { width: SMALL_SCREEN_MAX_CSS_PX - 1, height: 1000 } })).toBe(true);
    expect(isSmallScreen({ screen: { width: SMALL_SCREEN_MAX_CSS_PX, height: 1000 } })).toBe(false);
  });

  it("gives the small copy to any screen when the data saver is on", () => {
    expect(pickSource(all, { canPlayHls: false, ...desktop, saveData: true })).toBe(all.mp4Small);
    expect(pickSource(all, { canPlayHls: false, ...desktop, saveData: false })).toBe(all.mp4);
  });

  it("works as before without a small copy", () => {
    const mp4Only = { mp4: all.mp4 };
    expect(pickSource(mp4Only, { canPlayHls: false, ...phone })).toBe(all.mp4);
    expect(pickSource(mp4Only, { canPlayHls: false, ...phone, saveData: true })).toBe(all.mp4);
    expect(pickSource(mp4Only, { canPlayHls: true })).toBe(all.mp4);
    expect(pickSource({ hls: all.hls, mp4: all.mp4 }, { canPlayHls: false, ...desktop })).toBe(all.mp4);
  });

  it("is set for both About videos, on the same host as their 1080p files", () => {
    for (const video of [WALKTHROUGH_VIDEO, WHATS_NEW_VIDEO]) {
      if (!video) continue;
      expect(video.mp4Small).toMatch(/-720p\.mp4$/);
      expect(new URL(video.mp4Small!).origin).toBe(new URL(video.mp4).origin);
      expect(video.mp4Small).not.toBe(video.mp4);
    }
  });
});

describe("captions (Phase 31)", () => {
  it("are drawn by us while CC is on, by the system's player where that's on screen, and not loaded while off", () => {
    expect(captionMode(false, false)).toBe("disabled");
    expect(captionMode(false, true)).toBe("disabled");
    expect(captionMode(true, false)).toBe("hidden");
    expect(captionMode(true, true)).toBe("showing");
  });

  it("show a cue's text as plain text, keeping its line breaks", () => {
    expect(cueText("Drag to wander. Hold ⌘ or\nCtrl and scroll to zoom.")).toBe("Drag to wander. Hold ⌘ or\nCtrl and scroll to zoom.");
    expect(cueText("<v Narrator><i>Ŋdi</i>, good morning</v>")).toBe("Ŋdi, good morning");
    expect(cueText("Fish &amp; chips &lt;3")).toBe("Fish & chips <3");
    expect(cueText("  \n ")).toBe("");
  });

  it("keep the cue's own lines on a wide player and wrap evenly on a narrow one", () => {
    expect(captionText("one\ntwo", false)).toBe("one\ntwo");
    expect(captionText("one \n two", true)).toBe("one two");
  });

  it("are readable on a phone and grow with the frame", () => {
    expect(captionFontSize(351)).toBe(15);
    expect(captionFontSize(0)).toBe(15);
    expect(captionFontSize(NaN)).toBe(15);
    expect(captionFontSize(1088)).toBe(26);
    expect(captionFontSize(3840)).toBe(36);
  });

  it("sit above the controls while they show, and drop back when they hide", () => {
    expect(captionLift(true, 76.4)).toBe(77 + CAPTION_GAP);
    expect(captionLift(false, 76.4)).toBe(CAPTION_BOTTOM);
    expect(captionLift(true, 0)).toBe(CAPTION_BOTTOM);
  });
});

/*
 * The committed captions (public/captions/), checked with WebVTT's own rules
 * for what we use: the header, cue blocks separated by blank lines, an
 * optional id, a timing line, text with no "-->" and no raw "<" or "&".
 */
type Cue = { id: string | null; start: number; end: number; text: string };

function seconds(stamp: string): number {
  const m = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(stamp);
  if (!m) throw new Error(`bad timestamp ${stamp}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function parseVtt(file: string): Cue[] {
  expect(file.charCodeAt(0)).not.toBe(0xfeff);
  expect(file).not.toContain("\r");
  const [header, ...blocks] = file.replace(/\n$/, "").split(/\n{2,}/);
  expect(header).toBe("WEBVTT");
  expect(file.endsWith("\n")).toBe(true);
  return blocks
    .filter((b) => b.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const timingAt = lines[0].includes("-->") ? 0 : 1;
      const timing = /^(\S+) --> (\S+)$/.exec(lines[timingAt]);
      if (!timing) throw new Error(`no timing line in ${JSON.stringify(block)}`);
      const text = lines.slice(timingAt + 1);
      expect(text.length, block).toBeGreaterThan(0);
      for (const line of text) {
        expect(line, block).not.toContain("-->");
        expect(line.trim(), block).not.toBe("");
        expect(line, block).not.toMatch(/[<&]/);
      }
      if (timingAt === 1) expect(lines[0]).not.toContain("-->");
      return { id: timingAt ? lines[0] : null, start: seconds(timing[1]), end: seconds(timing[2]), text: text.join("\n") };
    });
}

describe("the committed captions", () => {
  const files = [
    { video: WALKTHROUGH_VIDEO, file: "inkboard-walkthrough.en.vtt", cues: 77, length: 6 * 60 + 1 },
    { video: WHATS_NEW_VIDEO, file: "whats-new-walkthrough.en.vtt", cues: 65, length: 2 * 60 + 53 },
  ];

  for (const { video, file, cues: count, length } of files) {
    describe(file, () => {
      const cues = parseVtt(readFileSync(path.resolve("public/captions", file), "utf8"));

      it("parses as WebVTT, every cue in order, the last one ending before the video does", () => {
        expect(cues).toHaveLength(count);
        let previousStart = -1;
        let previousEnd = 0;
        for (const cue of cues) {
          expect(cue.end, cue.text).toBeGreaterThan(cue.start);
          expect(cue.start, cue.text).toBeGreaterThan(previousStart);
          expect(cue.start, cue.text).toBeGreaterThanOrEqual(previousEnd);
          previousStart = cue.start;
          previousEnd = cue.end;
        }
        expect(cues.at(-1)!.end).toBeLessThan(length);
        expect(cues.map((c) => c.id)).toEqual(cues.map((_, i) => String(i + 1)));
      });

      it("writes InkBoard and the Ghanaian letters as they are written, not as the voice said them", () => {
        const text = cues.map((c) => c.text).join("\n");
        expect(text).toContain("InkBoard");
        expect(text).not.toMatch(/Ink Board|Inkboard\b/);
        expect(text.normalize("NFC")).toBe(text);
      });

      it("is the video's captions file in its settings, on our own origin", () => {
        expect(video?.captions).toEqual({ src: `/captions/${file}`, lang: "en", label: "English" });
      });
    });
  }

  it("spells the walkthrough's Ewe words properly", () => {
    const text = readFileSync(path.resolve("public/captions/inkboard-walkthrough.en.vtt"), "utf8");
    for (const word of ["Agbɔ", "Ŋdi", "ɛ, ɔ, ɖ and ŋ"]) expect(text).toContain(word);
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
