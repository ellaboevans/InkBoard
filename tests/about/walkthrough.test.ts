import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WalkthroughPlayer, WalkthroughVideo, WHATS_NEW_COPY, WhatsNewVideo } from "@/components/about/walkthrough-video";
import { buildCsp } from "@/lib/csp";
import {
  HOSTED_VIDEO,
  VIDEO_HOST_ORIGIN,
  WALKTHROUGH_MUSIC_CREDIT,
  WALKTHROUGH_VIDEO,
  WHATS_NEW_VIDEO,
  type WalkthroughSource,
} from "@/lib/site";

/*
 * The About page's walkthrough video (docs/PLAN.md, Phase 19) in both states:
 * no video (cover + "Video coming soon", no media origin allowed), and a video
 * set (a play button and no <video> until it's pressed, so nothing from
 * ImageKit before that; then the browser's own player, HLS then MP4, from the
 * one origin the CSP then allows in media-src).
 */
const VIDEO: WalkthroughSource = {
  hls: `${VIDEO_HOST_ORIGIN}/acct/walk.mp4/ik-master.m3u8?tr=sr-240_360_480_720_1080`,
  mp4: `${VIDEO_HOST_ORIGIN}/acct/walk.mp4?tr=w-1280`,
};
const IMAGEKIT = /imagekit/i;
const html = (video: WalkthroughSource | null) => renderToStaticMarkup(createElement(WalkthroughVideo, { video }));
const directives = (csp: string) => csp.split("; ");

describe("the walkthrough setting", () => {
  it("is null, or HLS and MP4 sources on the video host over https", () => {
    if (WALKTHROUGH_VIDEO === null) return;
    expect(VIDEO_HOST_ORIGIN).toBe("https://ik.imagekit.io");
    expect(WALKTHROUGH_VIDEO.hls).toBeDefined();
    const hls = new URL(WALKTHROUGH_VIDEO.hls!);
    const mp4 = new URL(WALKTHROUGH_VIDEO.mp4);
    expect(hls.origin).toBe(VIDEO_HOST_ORIGIN);
    expect(mp4.origin).toBe(VIDEO_HOST_ORIGIN);
    expect(hls.pathname).toMatch(/\/ik-master\.m3u8$/);
    expect(mp4.pathname).toMatch(/\.mp4$/);
  });
});

describe("the what's-new setting", () => {
  it("is null, or an MP4 (and optionally HLS) on the video host over https", () => {
    if (WHATS_NEW_VIDEO === null) return;
    const mp4 = new URL(WHATS_NEW_VIDEO.mp4);
    expect(mp4.origin).toBe(VIDEO_HOST_ORIGIN);
    expect(mp4.pathname).toMatch(/\.mp4$/);
    if (WHATS_NEW_VIDEO.hls) expect(new URL(WHATS_NEW_VIDEO.hls).origin).toBe(VIDEO_HOST_ORIGIN);
  });

  it("makes the CSP and the Privacy page allow the host whenever either video is set", () => {
    expect(HOSTED_VIDEO).toBe(WALKTHROUGH_VIDEO !== null || WHATS_NEW_VIDEO !== null);
  });
});

describe("no video yet", () => {
  it("shows our cover with 'Video coming soon', and nothing from the video host", () => {
    const out = html(null);
    expect(out).toContain("Video coming soon");
    expect(out).toContain('alt="How InkBoard works');
    expect(out).not.toMatch(/<video|<iframe|<button/);
    expect(out).not.toMatch(IMAGEKIT);
  });

  it("allows no media or frame origins in the CSP", () => {
    for (const dev of [false, true]) {
      const csp = buildCsp({ dev, videoOrigin: null });
      expect(csp).not.toMatch(/media-src|frame-src/);
      expect(csp).not.toMatch(IMAGEKIT);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });
});

describe("with a video", () => {
  it("shows a play button over the cover, with no <video> and no request to the host before it's pressed", () => {
    const out = html(VIDEO);
    expect(out).toMatch(/<button[^>]*type="button"/);
    expect(out).toContain("Play the walkthrough");
    expect(out).not.toMatch(/<video|<source|<iframe/);
    expect(out).not.toContain(VIDEO.hls!.replaceAll("&", "&amp;"));
    expect(out).not.toContain(`${VIDEO_HOST_ORIGIN}/`);
  });

  it("credits the music, as its licence requires", () => {
    const out = html(VIDEO);
    expect(out).toContain(`“${WALKTHROUGH_MUSIC_CREDIT.title}” by`);
    expect(out).toContain(`href="${WALKTHROUGH_MUSIC_CREDIT.artistUrl}"`);
    expect(out).toContain(`href="${WALKTHROUGH_MUSIC_CREDIT.licenceUrl}"`);
    expect(out).toContain(">CC BY 4.0<");
  });

  it("then plays in the browser's own player: HLS first, then MP4, with controls, inline on phones, and a name", () => {
    const out = renderToStaticMarkup(createElement(WalkthroughPlayer, { video: VIDEO }));
    expect(out).toMatch(/^<video [^>]*controls=""/);
    expect(out).toContain('playsInline=""');
    expect(out).toContain('aria-label="InkBoard walkthrough video"');
    const sources = [...out.matchAll(/<source src="([^"]+)" type="([^"]+)"/g)].map((m) => [m[1].replaceAll("&amp;", "&"), m[2]]);
    expect(sources).toEqual([
      [VIDEO.hls, "application/vnd.apple.mpegurl"],
      [VIDEO.mp4, "video/mp4"],
    ]);
    expect(out).not.toContain("<iframe");
  });

  it("allows exactly the host's origin in media-src, and changes nothing else in the CSP", () => {
    for (const dev of [false, true]) {
      const without = directives(buildCsp({ dev, videoOrigin: null }));
      const withVideo = directives(buildCsp({ dev, videoOrigin: VIDEO_HOST_ORIGIN }));
      expect(withVideo.filter((d) => !without.includes(d))).toEqual(["media-src 'self' https://ik.imagekit.io"]);
      expect(without.filter((d) => !withVideo.includes(d))).toEqual([]);
      expect(withVideo.join("; ")).not.toContain("frame-src");
    }
  });
});

describe("what's new, the second video", () => {
  const MP4_ONLY: WalkthroughSource = { mp4: `${VIDEO_HOST_ORIGIN}/acct/new-720p.mp4` };
  const whatsNew = (video: WalkthroughSource | null) => renderToStaticMarkup(createElement(WhatsNewVideo, { video }));

  it("renders nothing while it isn't set", () => {
    expect(whatsNew(null)).toBe("");
  });

  it("is its own play button, with no <video> and no request to the host before it's pressed", () => {
    const out = whatsNew(MP4_ONLY);
    expect(out).toContain('data-whats-new="ready"');
    expect(out).not.toContain("data-walkthrough");
    expect(out).toContain("Play what’s new");
    expect(out).not.toMatch(/<video|<source|<iframe/);
    expect(out).not.toContain(`${VIDEO_HOST_ORIGIN}/`);
    expect(out).toContain(`“${WALKTHROUGH_MUSIC_CREDIT.title}” by`);
  });

  it("plays its MP4 alone when there's no HLS, under its own name", () => {
    const out = renderToStaticMarkup(
      createElement(WalkthroughPlayer, {
        video: MP4_ONLY,
        copy: WHATS_NEW_COPY,
      }),
    );
    expect(out).toContain('aria-label="What’s new in InkBoard video"');
    const sources = [...out.matchAll(/<source src="([^"]+)" type="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(sources).toEqual([[MP4_ONLY.mp4, "video/mp4"]]);
  });
});
