import { describe, expect, it } from "vitest";
import {
  autoCard,
  detectPlatform,
  emptyMemory,
  FIRST_VISIT_GRACE_MS,
  installMethod,
  isDismissed,
  isPhoneLike,
  isRunningInstalled,
  NOT_NOW_MS,
  parseMemory,
  readerReady,
  recordPoem,
  recordVisit,
  VISIT_GAP_MS,
  WRITER_WINDOW_MS,
  type InstallMemory,
} from "@/lib/install-nudge";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.0.0 Mobile/15E148 Safari/604.1",
  // iPadOS asks for the desktop site by default and says "Macintosh".
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macSafari17:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari16:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:140.0) Gecko/20100101 Firefox/140.0",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
};

describe("detectPlatform and installMethod", () => {
  it("knows iPhones and iPads, and which browser", () => {
    expect(detectPlatform(UA.iphoneSafari)).toEqual({ kind: "ios", device: "iphone", safari: true });
    expect(detectPlatform(UA.iphoneChrome)).toEqual({ kind: "ios", device: "iphone", safari: false });
    expect(detectPlatform(UA.ipad, 5)).toEqual({ kind: "ios", device: "ipad", safari: true });
  });

  it("tells Mac Safari 17+ from older Safari and other Mac browsers", () => {
    expect(detectPlatform(UA.macSafari17, 0)).toEqual({ kind: "mac-safari" });
    expect(detectPlatform(UA.macSafari16, 0)).toEqual({ kind: "desktop" });
    expect(detectPlatform(UA.macChrome)).toEqual({ kind: "desktop" });
    expect(detectPlatform(UA.macFirefox)).toEqual({ kind: "desktop" });
  });

  it("treats Android as a phone", () => {
    expect(detectPlatform(UA.android)).toEqual({ kind: "mobile" });
    expect(isPhoneLike(detectPlatform(UA.android))).toBe(true);
    expect(isPhoneLike(detectPlatform(UA.ipad, 5))).toBe(false);
  });

  it("uses the browser's prompt whenever there is one, else instructions, else nothing", () => {
    expect(installMethod(detectPlatform(UA.windowsEdge), true)).toBe("prompt");
    expect(installMethod(detectPlatform(UA.windowsEdge), false)).toBeNull();
    expect(installMethod(detectPlatform(UA.iphoneSafari), false)).toBe("ios");
    expect(installMethod(detectPlatform(UA.macSafari17), false)).toBe("mac");
    // Firefox desktop never fires beforeinstallprompt: nothing to offer.
    expect(installMethod(detectPlatform(UA.macFirefox), false)).toBeNull();
  });

  it("sees an installed app from the display mode or iOS's navigator.standalone", () => {
    expect(isRunningInstalled(true, undefined)).toBe(true);
    expect(isRunningInstalled(false, true)).toBe(true);
    expect(isRunningInstalled(false, false)).toBe(false);
    expect(isRunningInstalled(false, undefined)).toBe(false);
  });
});

describe("visits and poems", () => {
  const t0 = 1_700_000_000_000;

  it("counts a new visit only after 30 minutes away", () => {
    let m = recordVisit(emptyMemory(), t0);
    expect(m.visits).toBe(1);
    m = recordVisit(m, t0 + 60_000); // a reload
    expect(m.visits).toBe(1);
    m = recordVisit(m, t0 + 60_000 + VISIT_GAP_MS + 1);
    expect(m).toMatchObject({ visits: 2, visitStart: t0 + 60_000 + VISIT_GAP_MS + 1 });
  });

  it("counts each poem once", () => {
    let m = recordPoem(emptyMemory(), "ada/ode");
    expect(recordPoem(m, "ada/ode")).toBe(m);
    m = recordPoem(m, "eve/elegy");
    expect(m.poems).toEqual(["ada/ode", "eve/elegy"]);
  });

  it("survives junk in storage", () => {
    expect(parseMemory("{not json")).toEqual(emptyMemory());
    expect(parseMemory(JSON.stringify({ visits: "lots", poems: [1, "a"], gotIt: "yes" }))).toEqual({
      ...emptyMemory(),
      poems: ["a"],
    });
  });
});

describe("when the card shows", () => {
  const t0 = 1_700_000_000_000;
  const firstVisit: InstallMemory = { ...emptyMemory(), visits: 1, visitStart: t0, lastSeen: t0 };
  const base = { now: t0, method: "prompt" as const, installed: false, onBoard: true, inEditor: false };

  it("readers: on a second visit, at once", () => {
    expect(readerReady({ ...firstVisit, visits: 2 }, t0)).toBe(true);
  });

  it("readers: after two poems, but never in the first seconds of a first visit", () => {
    const twoPoems = { ...firstVisit, poems: ["a/1", "a/2"] };
    expect(readerReady({ ...firstVisit, poems: ["a/1"] }, t0 + 60_000)).toBe(false);
    expect(readerReady(twoPoems, t0 + 5_000)).toEqual({ at: t0 + FIRST_VISIT_GRACE_MS });
    expect(readerReady(twoPoems, t0 + FIRST_VISIT_GRACE_MS)).toBe(true);
    expect(readerReady(firstVisit, t0 + 3_600_000)).toBe(false); // one long first visit alone isn't enough
  });

  it("writers: right after their first publish, in the editor only", () => {
    const m = { ...firstVisit, writerAt: t0 };
    expect(autoCard({ ...base, memory: m, onBoard: false, inEditor: true })).toBe("writer");
    expect(autoCard({ ...base, memory: m, now: t0 + WRITER_WINDOW_MS, onBoard: false, inEditor: true })).toBeNull();
    // A first-visit reader on the board doesn't get it.
    expect(autoCard({ ...base, memory: m })).toBeNull();
  });

  it("never when installing isn't possible, or InkBoard is already installed", () => {
    const m = { ...firstVisit, visits: 3 };
    expect(autoCard({ ...base, memory: m })).toBe("reader");
    expect(autoCard({ ...base, memory: m, method: null })).toBeNull();
    expect(autoCard({ ...base, memory: m, installed: true })).toBeNull();
    expect(autoCard({ ...base, memory: { ...m, installed: true } })).toBeNull();
    expect(autoCard({ ...base, memory: m, onBoard: false })).toBeNull(); // readers: on the board
  });

  it("'Not now' hides it for 30 days; 'Got it' for good", () => {
    const later = { ...firstVisit, visits: 3, notNowUntil: t0 + NOT_NOW_MS };
    expect(isDismissed(later, t0 + NOT_NOW_MS - 1)).toBe(true);
    expect(isDismissed(later, t0 + NOT_NOW_MS)).toBe(false);
    expect(autoCard({ ...base, memory: later, now: t0 + 1 })).toBeNull();
    expect(autoCard({ ...base, memory: later, now: t0 + NOT_NOW_MS })).toBe("reader");
    expect(isDismissed({ ...later, notNowUntil: undefined, gotIt: true }, t0 + 10 * NOT_NOW_MS)).toBe(true);
  });
});
