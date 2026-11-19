import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { VIDEO_HOST_ORIGIN, WALKTHROUGH_VIDEO, WHATS_NEW_VIDEO } from "../src/lib/site";

/*
 * InkBoard's own media player on the About page (docs/PLAN.md, Phase 30), on
 * a desktop and a phone. The video host is never really reached: its URLs are
 * answered with a 24-second silent fixture (e2e/fixtures/player-test.mp4,
 * ~5 KB, every frame a keyframe), with range requests like R2's.
 *
 * Full screen: headless Chrome may or may not enter it, so the test checks
 * the request (on the player itself, never the bare <video>) and, when Chrome
 * did enter it, that Esc leaves full screen without closing the dialog.
 */

test.skip(!WALKTHROUGH_VIDEO || !WHATS_NEW_VIDEO, "no video is set in src/lib/site.ts");

const FIXTURE = readFileSync(path.resolve("e2e/fixtures/player-test.mp4"));

/** Answer the video host with the fixture (206 for ranges); record every URL asked for. */
async function serveVideos(page: Page, log: string[], answer: "video" | "refuse" = "video") {
  let mode = answer;
  await page.route(`${VIDEO_HOST_ORIGIN}/**`, async (route: Route) => {
    log.push(route.request().url());
    if (mode === "refuse") return route.abort();
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
    const headers = { "content-type": "video/mp4", "accept-ranges": "bytes" };
    if (!range) return route.fulfill({ status: 200, headers, body: FIXTURE });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), FIXTURE.length - 1) : FIXTURE.length - 1;
    return route.fulfill({
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${FIXTURE.length}` },
      body: FIXTURE.subarray(start, end + 1),
    });
  });
  return { serve: () => (mode = "video") };
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
      expect(toHost.every((u) => u.startsWith(WALKTHROUGH_VIDEO!.mp4))).toBe(true);
      expect(new URL((await video(page).getAttribute("poster"))!, page.url()).pathname).toMatch(/^\/_next\/static\/.*walkthrough-cover-1920.*\.webp$/);
      expect(await video(page).getAttribute("controls")).toBeNull();
      // The music credit is in the dialog too.
      await expect(dialog.getByRole("link", { name: "Kevin MacLeod" })).toBeVisible();
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
      expect(await video(page).getAttribute("src")).toBe(WHATS_NEW_VIDEO!.mp4);
      await expect(second.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(second).toHaveCount(0);
      await expect(whatsNew).toBeFocused();
    });

    test("a video that can't load says so, and Try again plays it", async ({ page }) => {
      const toHost: string[] = [];
      const host = await serveVideos(page, toHost, "refuse");
      await page.goto("/about");
      const { player } = await openWalkthrough(page);
      await expect(player.getByRole("alert")).toHaveText(/The video couldn’t load/);
      await expect(player).toHaveAttribute("data-state", "error");
      host.serve();
      await player.getByRole("button", { name: "Try again" }).click();
      await expect(player).not.toHaveAttribute("data-state", "error");
      await expect(player.getByRole("alert")).toHaveCount(0);
      await expect.poll(() => media(page, (v) => v.readyState)).toBeGreaterThanOrEqual(1);
    });
  });
}
