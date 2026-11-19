import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WALKTHROUGH_COPY, WalkthroughVideo, WHATS_NEW_COPY, WhatsNewVideo } from "@/components/about/walkthrough-video";
import { MediaPlayer } from "@/components/media-player/media-player";
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
 * the video host before that; then InkBoard's own player in a dialog, Phase
 * 30, from the one origin the CSP then allows in media-src).
 */
const VIDEO: WalkthroughSource = {
  hls: `${VIDEO_HOST_ORIGIN}/acct/walk.mp4/ik-master.m3u8?tr=sr-240_360_480_720_1080`,
  mp4: `${VIDEO_HOST_ORIGIN}/acct/walk.mp4?tr=w-1280`,
};
const HOST = new RegExp(new URL(VIDEO_HOST_ORIGIN).host.replaceAll(".", "\\."), "i");
const html = (video: WalkthroughSource | null) => renderToStaticMarkup(createElement(WalkthroughVideo, { video }));
const directives = (csp: string) => csp.split("; ");

describe("the walkthrough setting", () => {
  it("is null, or an MP4 (and optionally HLS) on the video host over https", () => {
    expect(new URL(VIDEO_HOST_ORIGIN).protocol).toBe("https:");
    expect(new URL(VIDEO_HOST_ORIGIN).origin).toBe(VIDEO_HOST_ORIGIN);
    if (WALKTHROUGH_VIDEO === null) return;
    const mp4 = new URL(WALKTHROUGH_VIDEO.mp4);
    expect(mp4.origin).toBe(VIDEO_HOST_ORIGIN);
    expect(mp4.pathname).toMatch(/\.mp4$/);
    if (WALKTHROUGH_VIDEO.hls) expect(new URL(WALKTHROUGH_VIDEO.hls).origin).toBe(VIDEO_HOST_ORIGIN);
  });

  it("has its small copy on the video host and its captions on our own origin (Phase 31)", () => {
    for (const video of [WALKTHROUGH_VIDEO, WHATS_NEW_VIDEO]) {
      if (!video) continue;
      if (video.mp4Small) expect(new URL(video.mp4Small).origin).toBe(VIDEO_HOST_ORIGIN);
      if (!video.captions) continue;
      // A path on our origin (no CORS, `media-src 'self'`), never the video host, and the file is committed.
      expect(video.captions.src).toMatch(/^\/captions\/[a-z0-9-]+\.[a-z]{2}\.vtt$/);
      expect(existsSync(path.resolve("public", video.captions.src.slice(1)))).toBe(true);
    }
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
    expect(out).not.toMatch(HOST);
  });

  it("allows no media or frame origins in the CSP", () => {
    for (const dev of [false, true]) {
      const csp = buildCsp({ dev, videoOrigin: null });
      expect(csp).not.toMatch(/media-src|frame-src/);
      expect(csp).not.toMatch(HOST);
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

  it("opens a dialog: the button says so, and neither the dialog nor its code is in the page's HTML", () => {
    const out = html(VIDEO);
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('data-walkthrough="ready"');
    expect(out).not.toMatch(/role="dialog"|data-media-player/);
  });

  it("then plays in our own player: no browser controls, inline on phones, our cover as poster, named for its video", () => {
    const out = renderToStaticMarkup(
      createElement(MediaPlayer, { sources: VIDEO, poster: "/_next/static/media/walkthrough-cover-1920.webp", label: WALKTHROUGH_COPY.player }),
    );
    expect(out).toMatch(/<div[^>]*role="region"[^>]*aria-label="InkBoard walkthrough video"/);
    const video = out.match(/<video [^>]*>/)![0];
    expect(video).not.toContain("controls");
    expect(video).toContain('playsInline=""');
    expect(video).toContain('poster="/_next/static/media/walkthrough-cover-1920.webp"');
    // Without native HLS (as on the server), the MP4; one source, no <source> list.
    expect(video).toContain(`src="${VIDEO.mp4.replaceAll("&", "&amp;")}"`);
    expect(out).not.toContain("<source");
    for (const name of ["Play", "Back 10 seconds", "Forward 10 seconds", "Mute", "Seek", "Volume", "Playback speed 1×"]) {
      expect(out, name).toContain(`aria-label="${name}"`);
    }
    expect(out).not.toMatch(/<iframe|<select/);
    // No captions given: no CC button and no <track>.
    expect(out).not.toContain('aria-label="Captions"');
    expect(out).not.toContain("<track");
  });

  it("with captions: a CC toggle, off, and a <track> from our own origin, not loaded until turned on", () => {
    const captions = { src: "/captions/inkboard-walkthrough.en.vtt", lang: "en", label: "English" };
    const out = renderToStaticMarkup(createElement(MediaPlayer, { sources: VIDEO, captions, label: WALKTHROUGH_COPY.player }));
    expect(out).toMatch(/<button[^>]*aria-label="Captions"[^>]*aria-pressed="false"/);
    const track = out.match(/<track [^>]*>/)![0];
    expect(track).toContain('kind="captions"');
    expect(track).toContain(`src="${captions.src}"`);
    expect(track).toContain('srcLang="en"');
    expect(track).toContain('label="English"');
    // Not `default`: a track that isn't turned on loads nothing.
    expect(track).not.toContain("default");
    // Our own origin: the <video> needs no crossorigin, and the CSP's media-src 'self' already covers it.
    expect(out).not.toContain("crossOrigin");
    expect(out).not.toContain("data-captions=");
  });

  it("allows exactly the host's origin in media-src, and changes nothing else in the CSP", () => {
    for (const dev of [false, true]) {
      const without = directives(buildCsp({ dev, videoOrigin: null }));
      const withVideo = directives(buildCsp({ dev, videoOrigin: VIDEO_HOST_ORIGIN }));
      expect(withVideo.filter((d) => !without.includes(d))).toEqual([`media-src 'self' ${VIDEO_HOST_ORIGIN}`]);
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

  it("plays its MP4 under its own name", () => {
    const out = renderToStaticMarkup(createElement(MediaPlayer, { sources: MP4_ONLY, label: WHATS_NEW_COPY.player }));
    expect(out).toContain('aria-label="What’s new in InkBoard video"');
    expect(out).toContain(`src="${MP4_ONLY.mp4}"`);
    expect(WHATS_NEW_COPY.title).toBe("What’s new in InkBoard");
  });
});
