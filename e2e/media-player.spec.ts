import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { SITE_OPERATOR, VIDEO_HOST_ORIGIN, WALKTHROUGH_VIDEO, WHATS_NEW_VIDEO } from "../src/lib/site";

/*
 * InkBoard's own media player on the About page (docs/PLAN.md, Phase 30), on
 * a desktop and a phone. The video host is never really reached: its URLs are
 * answered with a 24-second silent fixture (e2e/fixtures/player-test.mp4,
 * ~5 KB, every frame a keyframe), with range requests like R2's.
 *
 * Recovery (Phase 30 fix-up): the stub can also cut the connection part way
 * through (`cut`: every range is served only up to CUT_AT and anything
 * beyond it is refused), which is how a dropped connection looks to the
 * player: Chrome gives up after its own ~30 retries (about 30 s) with
 * MEDIA_ERR_NETWORK (2) at ~13.5 s of media, and the player retries once by
 * itself. That needs e2e/fixtures/player-drop-test.mp4 (24 s, 52 KB): with
 * the 5 KB fixture Chrome reads past any cut while opening the file, which
 * fails with code 4 instead. WebKit never
 * raises an error for that (it stalls and resumes), so its project
 * (`webkit-iphone`, tests tagged @webkit) runs the crash regression and Try
 * again only.
 *
 * Phase 31: the host's two copies (1080p and the 720p phone copy) are both
 * answered with the fixture, and the logged URLs tell them apart: phones (the
 * 375 px Chrome phone and the WebKit iPhone) get `mp4Small`, the desktop
 * `mp4`. Captions come from our own origin (`/captions/…vtt`), answered with
 * e2e/fixtures/player-test.vtt (two cues: 0–12 s and 12–23.5 s).
 *
 * Full screen: headless Chrome may or may not enter it, so the test checks
 * the request (on the player itself, never the bare <video>) and, when Chrome
 * did enter it, that Esc leaves full screen without closing the dialog.
 */

test.skip(!WALKTHROUGH_VIDEO || !WHATS_NEW_VIDEO, "no video is set in src/lib/site.ts");

const FIXTURE = readFileSync(path.resolve("e2e/fixtures/player-test.mp4"));

const CAPTIONS_FIXTURE = readFileSync(path.resolve("e2e/fixtures/player-test.vtt"));
const FIRST_CUE = "This is the first caption.";

const DROP_FIXTURE = readFileSync(path.resolve("e2e/fixtures/player-drop-test.mp4"));
/** DROP_FIXTURE's bytes up to here: enough for Chrome to open it and play ~13.5 s (65%, measured). */
const CUT_AT = 34_157;

/**
 * Answer the video host with the fixture (206 for ranges); record every URL asked for. `refuse` fails every
 * request; `cut` serves only the bytes before CUT_AT and fails anything beyond, like a connection lost mid-play.
 */
async function serveVideos(page: Page, log: string[], answer: "video" | "refuse" | "cut" = "video") {
  let mode = answer;
  const file = answer === "cut" ? DROP_FIXTURE : FIXTURE;
  await page.route(`${VIDEO_HOST_ORIGIN}/**`, async (route: Route) => {
    log.push(route.request().url());
    if (mode === "refuse") return route.abort("internetdisconnected");
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
    const headers = { "content-type": "video/mp4", "accept-ranges": "bytes" };
    if (!range && mode === "video") return route.fulfill({ status: 200, headers, body: file });
    const start = range ? Number(range[1]) : 0;
    if (mode === "cut" && start >= CUT_AT) return route.abort("internetdisconnected");
    const last = mode === "cut" ? CUT_AT - 1 : file.length - 1;
    const end = range?.[2] ? Math.min(Number(range[2]), last) : last;
    return route.fulfill({
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${file.length}` },
      body: file.subarray(start, end + 1),
    });
  });
  return { serve: () => (mode = "video"), refuse: () => (mode = "refuse") };
}

/** Answer our own captions files with the fixture; record every path asked for. */
async function serveCaptions(page: Page, log: string[]) {
  await page.route("**/captions/**", (route) => {
    log.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, headers: { "content-type": "text/vtt; charset=utf-8" }, body: CAPTIONS_FIXTURE });
  });
}

/** The file a device should stream: the 720p copy on phones, the 1080p file elsewhere. */
const copyFor = (video: { mp4: string; mp4Small?: string }, phone: boolean) => (phone && video.mp4Small ? video.mp4Small : video.mp4);

/** The top of the visible controls (the seek row) and the bottom of the caption box, in page px. */
async function captionPlacement(player: Locator) {
  const row = (await player.locator("[data-controls-bar] > :first-child").boundingBox())!;
  const cue = (await player.locator("[data-cue]").boundingBox())!;
  const frame = (await player.boundingBox())!;
  return { controlsTop: row.y, cueBottom: cue.y + cue.height, frameBottom: frame.y + frame.height };
}

/** Record calls to requestFullscreen / webkitEnterFullscreen, with what they were called on. */
async function watchFullscreen(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { fullscreenCalls: string[] };
    w.fullscreenCalls = [];
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (this: Element, options?: FullscreenOptions) {
      w.fullscreenCalls.push(this.hasAttribute("data-media-player") ? "player" : this.tagName.toLowerCase());
      return original.call(this, options);
    };
  });
}
const fullscreenCalls = (page: Page) => page.evaluate(() => (window as unknown as { fullscreenCalls: string[] }).fullscreenCalls);

const video = (page: Page) => page.locator("[data-media-player] video");
// The function is sent to the browser as it is: it must not use anything from this file.
const media = <T,>(page: Page, read: (v: HTMLVideoElement) => T) => video(page).evaluate(read as unknown as (el: HTMLElement | SVGElement) => T);
const at = (page: Page) => media(page, (v) => v.currentTime);
const seekTo = (page: Page, t: number) =>
  video(page).evaluate(async (v: HTMLVideoElement, t) => {
    v.currentTime = t;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  }, t);

/** Bring hidden controls back as a person would (a mouse movement, or a tap), before pressing one while it plays. */
async function showControls(page: Page, player: Locator, touch: boolean) {
  if ((await player.getAttribute("data-controls")) === "shown") return;
  const b = (await player.boundingBox())!;
  if (touch) await page.touchscreen.tap(b.x + b.width * 0.85, b.y + b.height * 0.2);
  else await page.mouse.move(b.x + b.width * 0.85 - Math.random() * 20, b.y + b.height * 0.2);
  await expect(player).toHaveAttribute("data-controls", "shown");
}

/** Press the cover's play button: a tap on a touch screen, a click elsewhere. */
async function openWalkthrough(page: Page, touch = false) {
  const play = page.getByRole("main").getByRole("button", { name: "Play the walkthrough" });
  if (touch) await play.tap();
  else await play.click();
  const dialog = page.getByRole("dialog", { name: "InkBoard walkthrough" });
  await expect(dialog).toBeVisible();
  const player = dialog.getByRole("region", { name: "InkBoard walkthrough video" });
  await expect(player).toBeVisible();
  return { play, dialog, player };
}

for (const device of [
  { name: "desktop", viewport: { width: 1280, height: 800 }, touch: false },
  { name: "phone", viewport: { width: 375, height: 812 }, touch: true },
]) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, hasTouch: device.touch });

    test("nothing from the host before the press; then our player in a dialog, with every control and shortcut", async ({ page }) => {
      test.setTimeout(240_000);
      const toHost: string[] = [];
      await serveVideos(page, toHost);
      await watchFullscreen(page);
      await page.goto("/about");
      await page.waitForLoadState("networkidle");
      expect(toHost).toEqual([]);
      await expect(page.locator("video, iframe, [role=dialog]")).toHaveCount(0);

      const { play, dialog, player } = await openWalkthrough(page, device.touch);
      // Only the walkthrough's file, and our own cover as its poster.
      await expect.poll(() => toHost.length).toBeGreaterThan(0);
      expect(toHost.every((u) => u.startsWith(copyFor(WALKTHROUGH_VIDEO!, device.touch)))).toBe(true);
      expect(new URL((await video(page).getAttribute("poster"))!, page.url()).pathname).toMatch(/^\/_next\/static\/.*walkthrough-cover-1920.*\.webp$/);
      expect(await video(page).getAttribute("controls")).toBeNull();
      // The music credit is in the dialog too.
      await expect(dialog.getByRole("link", { name: "Kevin MacLeod" })).toBeVisible();
      // And the site's attribution, at the foot of the dialog.
      await expect(dialog.getByText(`Designed & Built by ${SITE_OPERATOR}`)).toBeVisible();
      // First focus: the main button.
      const primary = player.locator("[data-primary]");
      await expect(primary).toBeFocused();

      // It starts (the press counts as the gesture); then Pause and Play.
      await expect(player).toHaveAttribute("data-state", "playing");
      await showControls(page, player, device.touch);
      await player.getByRole("button", { name: "Pause" }).click();
      await expect(player).toHaveAttribute("data-state", "paused");
      expect(await media(page, (v) => v.paused)).toBe(true);
      await player.getByRole("button", { name: "Play", exact: true }).click();
      await expect(player).toHaveAttribute("data-state", "playing");
      await showControls(page, player, device.touch);
      await player.getByRole("button", { name: "Pause" }).click();
      await expect(player).toHaveAttribute("data-state", "paused");

      // Back and forward ten seconds, never before 0 or after the end.
      await seekTo(page, 12);
      await player.getByRole("button", { name: "Back 10 seconds" }).click();
      await expect.poll(() => at(page)).toBeCloseTo(2, 0);
      await player.getByRole("button", { name: "Back 10 seconds" }).click();
      await expect.poll(() => at(page)).toBe(0);
      await player.getByRole("button", { name: "Forward 10 seconds" }).click();
      await expect.poll(() => at(page)).toBeCloseTo(10, 0);
      const seek = player.getByRole("slider", { name: "Seek" });
      await expect(seek).toHaveAttribute("aria-valuetext", "0:10 of 0:24");
      await expect(player.locator("[data-time]")).toHaveText("0:10 / 0:24");

      // Mute and unmute.
      await player.getByRole("button", { name: "Mute" }).click();
      expect(await media(page, (v) => v.muted)).toBe(true);
      await player.getByRole("button", { name: "Unmute" }).click();
      expect(await media(page, (v) => v.muted)).toBe(false);

      // Volume: a slider where there's room (desktop), the keys everywhere.
      const volume = player.getByRole("slider", { name: "Volume" });
      if (device.name === "desktop") {
        await volume.focus();
        await page.keyboard.press("ArrowLeft");
        await expect(volume).toHaveAttribute("aria-valuetext", "Volume 95%");
        expect(await media(page, (v) => v.volume)).toBeCloseTo(0.95);
        // A focused slider keeps its arrows: the position didn't move.
        expect(await at(page)).toBeCloseTo(10, 0);
      } else {
        await expect(volume).toHaveCount(0);
      }

      // Shortcuts, with focus on the main button (Space is the button's own there).
      await primary.focus();
      const before = await media(page, (v) => v.volume);
      await page.keyboard.press("ArrowDown");
      expect(await media(page, (v) => v.volume)).toBeCloseTo(before - 0.05);
      await page.keyboard.press("ArrowUp");
      expect(await media(page, (v) => v.volume)).toBeCloseTo(before);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => at(page)).toBeCloseTo(20, 0);
      await page.keyboard.press("j");
      await expect.poll(() => at(page)).toBeCloseTo(10, 0);
      await page.keyboard.press("l");
      await expect.poll(() => at(page)).toBeCloseTo(20, 0);
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => at(page)).toBeCloseTo(10, 0);
      await page.keyboard.press("m");
      expect(await media(page, (v) => v.muted)).toBe(true);
      await page.keyboard.press("M");
      expect(await media(page, (v) => v.muted)).toBe(false);
      await page.keyboard.press("k");
      await expect(player).toHaveAttribute("data-state", "playing");
      await page.keyboard.press("K");
      await expect(player).toHaveAttribute("data-state", "paused");
      // Space on the focused button presses it: one toggle, not two.
      await page.keyboard.press(" ");
      await expect(player).toHaveAttribute("data-state", "playing");
      await page.keyboard.press(" ");
      await expect(player).toHaveAttribute("data-state", "paused");
      // Space from the seek slider (not a button) is the shortcut.
      await seek.focus();
      await page.keyboard.press(" ");
      await expect(player).toHaveAttribute("data-state", "playing");
      await page.keyboard.press("k");
      await expect(player).toHaveAttribute("data-state", "paused");

      // Playback speed: a shadcn menu, not a native dropdown.
      await player.getByRole("button", { name: "Playback speed 1×" }).click();
      await page.getByRole("menuitemradio", { name: "1.5×" }).click();
      expect(await media(page, (v) => v.playbackRate)).toBe(1.5);
      await expect(player.getByRole("button", { name: "Playback speed 1.5×" })).toBeVisible();
      await expect(dialog).toBeVisible();

      // Full screen on the player itself, by button and by F; Esc there leaves full screen, not the dialog.
      await player.getByRole("button", { name: "Full screen" }).click();
      expect(await fullscreenCalls(page)).toEqual(["player"]);
      const entered = await page.evaluate(() => document.fullscreenElement?.hasAttribute("data-media-player") ?? false);
      if (entered) {
        await expect(player.getByRole("button", { name: "Exit full screen" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        if (await page.evaluate(() => document.fullscreenElement !== null)) {
          await player.getByRole("button", { name: "Exit full screen" }).click();
        }
        await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
        await expect(dialog).toBeVisible();
      }
      await primary.focus();
      await page.keyboard.press("f");
      expect((await fullscreenCalls(page)).length).toBe(2);
      if (await page.evaluate(() => document.fullscreenElement !== null)) {
        await page.evaluate(() => document.exitFullscreen());
        await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
      }

      // Esc closes it: the video is gone and focus is back on the play button.
      await page.waitForTimeout(600); // past the "Esc that left full screen" window
      await primary.focus();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("video")).toHaveCount(0);
      await expect(play).toBeFocused();

      // Opening again starts afresh; the close button closes it too.
      const { dialog: again } = await openWalkthrough(page, device.touch);
      await expect.poll(() => at(page)).toBeLessThan(5);
      expect(await media(page, (v) => v.playbackRate)).toBe(1);
      await again.getByRole("button", { name: "Close" }).click();
      await expect(again).toHaveCount(0);
      await expect(page.locator("video")).toHaveCount(0);
      await expect(play).toBeFocused();
    });

    test("controls hide while playing and come back; they stay while paused; what's new has its own dialog", async ({ page }) => {
      test.setTimeout(180_000);
      await serveVideos(page, []);
      await page.goto("/about");
      const { player, dialog } = await openWalkthrough(page, device.touch);
      await expect(player).toHaveAttribute("data-state", "playing");
      await expect(player).toHaveAttribute("data-controls", "shown");
      // Off the control bar (a pointer resting on it keeps them), over the picture.
      const box = (await player.boundingBox())!;
      if (!device.touch) await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await expect(player).toHaveAttribute("data-controls", "hidden", { timeout: 8000 });
      if (device.touch) {
        // A tap shows them (and doesn't pause).
        await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.3);
        await expect(player).toHaveAttribute("data-controls", "shown");
        await expect(player).toHaveAttribute("data-state", "playing");
      } else {
        await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 3);
        await expect(player).toHaveAttribute("data-controls", "shown");
      }
      await player.getByRole("button", { name: "Pause" }).click();
      await page.waitForTimeout(4000);
      await expect(player).toHaveAttribute("data-controls", "shown");
      // Outside click closes it.
      await page.mouse.click(5, 5);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("video")).toHaveCount(0);

      const whatsNew = page.getByRole("main").getByRole("button", { name: "Play what’s new" });
      await whatsNew.click();
      const second = page.getByRole("dialog", { name: "What’s new in InkBoard" });
      await expect(second.getByRole("region", { name: "What’s new in InkBoard video" })).toBeVisible();
      expect(await video(page).getAttribute("src")).toBe(copyFor(WHATS_NEW_VIDEO!, device.touch));
      await expect(second.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(second).toHaveCount(0);
      await expect(whatsNew).toBeFocused();
    });

    test("a video that can't load says so (code 4), and Try again plays it, even with its source gone", async ({ page }) => {
      const toHost: string[] = [];
      const host = await serveVideos(page, toHost, "refuse");
      await page.goto("/about");
      const { player } = await openWalkthrough(page, device.touch);
      await expect(player.getByRole("alert")).toHaveText(/The video couldn’t load/);
      await expect(player).toHaveAttribute("data-state", "error");
      // A host refusing from the start: MEDIA_ERR_SRC_NOT_SUPPORTED, never retried by itself.
      await expect(player).toHaveAttribute("data-media-error", "4");
      const asked = toHost.length;
      await page.waitForTimeout(3000);
      expect(toHost.length).toBe(asked);
      // Try again sets the source afresh, so it works even when the element has none left.
      await video(page).evaluate((v: HTMLVideoElement) => v.removeAttribute("src"));
      host.serve();
      await player.getByRole("button", { name: "Try again" }).click();
      await expect(player.getByRole("alert")).toHaveCount(0);
      await expect(player).toHaveAttribute("data-state", "playing");
      // The same file as before (chosen once, when the player opened).
      expect(await video(page).getAttribute("src")).toBe(copyFor(WALKTHROUGH_VIDEO!, device.touch));
      await expect.poll(() => at(page)).toBeGreaterThan(1);
    });

    test("a connection lost mid-play comes back by itself: one retry, from the same place", async ({ page }) => {
      test.setTimeout(180_000);
      const host = await serveVideos(page, [], "cut");
      await page.goto("/about");
      const { player } = await openWalkthrough(page, device.touch);
      await expect(player).toHaveAttribute("data-state", "playing");
      // Chrome gives up on the missing bytes: a network error, and the player waits to retry (the spinner, no error).
      await expect(player).toHaveAttribute("data-media-error", "2", { timeout: 90_000 });
      const lost = await at(page);
      expect(lost).toBeGreaterThan(2);
      await expect(player).toHaveAttribute("data-state", "loading");
      await expect(player.getByRole("alert")).toHaveCount(0);
      host.serve(); // back before the retry (AUTO_RETRY_DELAY_MS)
      await expect(player).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
      await expect.poll(() => at(page)).toBeGreaterThan(lost);
      expect(await at(page)).toBeLessThan(lost + 6); // resumed there, not from the start
      await expect(player.getByRole("alert")).toHaveCount(0);
      // The same element, its source intact.
      expect(await video(page).getAttribute("src")).toBe(copyFor(WALKTHROUGH_VIDEO!, device.touch));
    });

    test("a connection that stays down: one retry only, then the error; Try again resumes near the same place", async ({ page }) => {
      test.setTimeout(240_000);
      const toHost: string[] = [];
      const host = await serveVideos(page, toHost, "cut");
      await page.goto("/about");
      const { player } = await openWalkthrough(page, device.touch);
      await expect(player).toHaveAttribute("data-media-error", "2", { timeout: 90_000 });
      const lost = await at(page);
      // The one automatic retry fails as well: now the error, and no more retries.
      await expect(player).toHaveAttribute("data-state", "error", { timeout: 90_000 });
      await expect(player.getByRole("alert")).toHaveText(/The video couldn’t load/);
      const asked = toHost.length;
      await page.waitForTimeout(4000);
      expect(toHost.length).toBe(asked);
      host.serve();
      await player.getByRole("button", { name: "Try again" }).click();
      await expect(player).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
      await expect.poll(() => at(page)).toBeGreaterThan(lost - 1);
      expect(await at(page)).toBeLessThan(lost + 6);
    });

    test("the copy for this screen: the phone streams the 720p file, the desktop the 1080p one, for both videos", async ({ page }) => {
      const toHost: string[] = [];
      await serveVideos(page, toHost);
      await page.goto("/about");
      for (const v of [
        { video: WALKTHROUGH_VIDEO!, play: "Play the walkthrough", title: "InkBoard walkthrough" },
        { video: WHATS_NEW_VIDEO!, play: "Play what’s new", title: "What’s new in InkBoard" },
      ]) {
        const before = toHost.length;
        await page.getByRole("main").getByRole("button", { name: v.play }).click();
        const dialog = page.getByRole("dialog", { name: v.title });
        await expect(dialog.locator("[data-media-player]")).toHaveAttribute("data-state", "playing");
        const wanted = copyFor(v.video, device.touch);
        const other = wanted === v.video.mp4 ? v.video.mp4Small! : v.video.mp4;
        expect(await video(page).getAttribute("src")).toBe(wanted);
        const asked = toHost.slice(before);
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.every((u) => u === wanted)).toBe(true);
        expect(toHost).not.toContain(other);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      }
    });

    test("captions: off at first and nothing fetched; CC and C turn them on and off; above the controls while they show, lower when they hide", async ({ page }) => {
      test.setTimeout(180_000);
      const vtt: string[] = [];
      await serveVideos(page, []);
      await serveCaptions(page, vtt);
      await page.goto("/about");
      await page.waitForLoadState("networkidle");
      expect(vtt).toEqual([]);

      const { player } = await openWalkthrough(page, device.touch);
      // Taps on the phone: a mouse click would leave the pointer resting on the bar, which keeps the controls up.
      const press = (control: Locator) => (device.touch ? control.tap() : control.click());
      const cc = player.getByRole("button", { name: "Captions" });
      await expect(cc).toHaveAttribute("aria-pressed", "false");
      // Layout size (the dialog may still be zooming in).
      expect(await cc.evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight])).toEqual([44, 44]);
      await expect(player).toHaveAttribute("data-state", "playing");
      // Paused through the element (the controls' own timing is tested above): paused, they stay up.
      await video(page).evaluate((v: HTMLVideoElement) => v.pause());
      await expect(player).toHaveAttribute("data-state", "paused");
      await seekTo(page, 2);
      await expect(player.locator("[data-captions]")).toHaveCount(0);
      // Off: the .vtt isn't fetched, even with the player open.
      await page.waitForTimeout(1000);
      expect(vtt).toEqual([]);

      // On: the cue's text, from our own file, fetched now (once).
      await press(cc);
      await expect(cc).toHaveAttribute("aria-pressed", "true");
      const cue = player.locator("[data-cue]");
      await expect(cue).toHaveText(FIRST_CUE);
      expect(vtt).toEqual(["/captions/inkboard-walkthrough.en.vtt"]);
      await expect(player.locator("[data-captions]")).toHaveAttribute("lang", "en");
      // Readable: a dark backing, at least 15 px.
      const style = await cue.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, size: parseFloat(getComputedStyle(el).fontSize) }));
      expect(style.bg).toMatch(/rgba\(0, 0, 0, 0\.8\)|oklab\(0 0 0 \/ 0\.8\)/);
      expect(style.size).toBeGreaterThanOrEqual(15);

      // Paused, the controls show: the cue sits above them.
      await expect(player).toHaveAttribute("data-controls", "shown");
      await expect.poll(async () => { const p = await captionPlacement(player); return p.cueBottom <= p.controlsTop; }).toBe(true);

      // C turns them off and on again (focus on the main button; the key is the player's there).
      await player.locator("[data-primary]").focus();
      await page.keyboard.press("c");
      await expect(cc).toHaveAttribute("aria-pressed", "false");
      await expect(player.locator("[data-captions]")).toHaveCount(0);
      await page.keyboard.press("C");
      await expect(cc).toHaveAttribute("aria-pressed", "true");
      await expect(cue).toHaveText(FIRST_CUE);
      expect(vtt).toHaveLength(1); // not fetched again

      // Playing, the controls hide: the cue drops back down, still above the frame's edge.
      await expect(player).toHaveAttribute("data-state", "paused");
      const shownAt = await captionPlacement(player);
      // Let go of keyboard focus (it keeps the controls up), then play.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const box = (await player.boundingBox())!;
      if (!device.touch) await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await video(page).evaluate((v: HTMLVideoElement) => v.play());
      await expect(player).toHaveAttribute("data-state", "playing");
      await expect(player).toHaveAttribute("data-controls", "hidden", { timeout: 10_000 });
      await expect(cue).toHaveText(FIRST_CUE);
      await expect.poll(async () => (await captionPlacement(player)).cueBottom).toBeGreaterThan(shownAt.cueBottom + 20);
      const hidden = await captionPlacement(player);
      expect(hidden.cueBottom).toBeLessThan(hidden.frameBottom);
      expect(hidden.frameBottom - hidden.cueBottom).toBeLessThan(24);

      // The controls come back: so does the lift.
      await showControls(page, player, device.touch);
      await expect.poll(async () => { const p = await captionPlacement(player); return p.cueBottom <= p.controlsTop; }).toBe(true);

      // The next cue replaces it (its two lines kept on a wide player, joined to wrap on a phone).
      await seekTo(page, 13);
      await expect(cue).toHaveText(device.touch ? "And this is the second one, over two lines." : "And this is the second one,\nover two lines.");
    });
  });
}

/*
 * WebKit (the `webkit-iphone` project: an iPhone 15 profile) and Chrome. The regression for the phones'
 * failure: WebKit's currentTime moves between two reads in one task, and a live read in useSyncExternalStore
 * made React loop until "Maximum update depth exceeded" took the page down a moment into playback, emptying the
 * <video> as it went. Now it plays on: the same element, its source intact, no error page.
 */
test.describe("@webkit", () => {
  // A phone: the iPhone 15 profile in the webkit-iphone project; the same size, with touch, in Chrome.
  test.use({ hasTouch: true, viewport: { width: 393, height: 852 } });

  test("plays on without taking the page down, the same video and its source intact", async ({ page }) => {
    const crashes: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Maximum update depth|React error #185/.test(m.text())) crashes.push(m.text());
    });
    await serveVideos(page, []);
    await page.goto("/about");
    const { player } = await openWalkthrough(page, true);
    await expect(player).toHaveAttribute("data-state", "playing");
    await video(page).evaluate((v) => ((window as unknown as { first: Element }).first = v));
    await expect.poll(() => at(page), { timeout: 20_000 }).toBeGreaterThan(4);
    expect(await video(page).evaluate((v) => v === (window as unknown as { first: Element }).first)).toBe(true);
    // A phone: the 720p copy.
    expect(await video(page).getAttribute("src")).toBe(copyFor(WALKTHROUGH_VIDEO!, true));
    await expect(player.locator("[data-time]")).toContainText(/^0:0[4-9]/);
    await expect(page.getByText(/couldn.t load this page/)).toHaveCount(0);
    expect(crashes).toEqual([]);
  });

  test("captions: nothing fetched while off; CC shows the cue, C hides it", async ({ page }) => {
    const vtt: string[] = [];
    await serveVideos(page, []);
    await serveCaptions(page, vtt);
    await page.goto("/about");
    const { player } = await openWalkthrough(page, true);
    await expect(player).toHaveAttribute("data-state", "playing");
    await showControls(page, player, true);
    await player.getByRole("button", { name: "Pause" }).tap();
    await expect(player).toHaveAttribute("data-state", "paused");
    await seekTo(page, 2);
    await page.waitForTimeout(1000);
    expect(vtt).toEqual([]);
    const cc = player.getByRole("button", { name: "Captions" });
    await cc.tap();
    await expect(cc).toHaveAttribute("aria-pressed", "true");
    await expect(player.locator("[data-cue]")).toHaveText(FIRST_CUE);
    expect(vtt).toEqual(["/captions/inkboard-walkthrough.en.vtt"]);
    await expect.poll(async () => { const p = await captionPlacement(player); return p.cueBottom <= p.controlsTop; }).toBe(true);
    // Our own drawing only: the track is hidden, so the engine draws nothing of its own on top.
    expect(await media(page, (v) => v.textTracks[0]?.mode)).toBe("hidden");
    await player.locator("[data-primary]").focus();
    await page.keyboard.press("c");
    await expect(cc).toHaveAttribute("aria-pressed", "false");
    await expect(player.locator("[data-captions]")).toHaveCount(0);
    expect(await media(page, (v) => v.textTracks[0]?.mode)).toBe("disabled");
  });

  test("Try again recovers after the host failed", async ({ page }) => {
    const host = await serveVideos(page, [], "refuse");
    await page.goto("/about");
    const { player } = await openWalkthrough(page, true);
    await expect(player).toHaveAttribute("data-state", "error");
    await expect(player).toHaveAttribute("data-media-error", /\d/);
    host.serve();
    await player.getByRole("button", { name: "Try again" }).tap();
    await expect(player).toHaveAttribute("data-state", "playing");
    await expect.poll(() => at(page)).toBeGreaterThan(1);
  });
});
