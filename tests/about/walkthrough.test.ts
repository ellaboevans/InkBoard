import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WalkthroughEmbed, WalkthroughVideo } from "@/components/about/walkthrough-video";
import { buildCsp, isYouTubeId, walkthroughEmbedUrl, YOUTUBE_EMBED_ORIGIN } from "@/lib/csp";
import { WALKTHROUGH_YOUTUBE_ID } from "@/lib/site";

/*
 * The About page's walkthrough video (docs/PLAN.md, Phase 19) in both states:
 * no id yet (cover + "Video coming soon", no frames allowed), and an id set
 * (a play button; nothing from YouTube until it's pressed; then the
 * youtube-nocookie.com player, which the CSP then allows and nothing else).
 */
const ID = "dQw4w9WgXcQ";
const YOUTUBE = /youtube(-nocookie)?\.com\/|ytimg|googlevideo/;
const html = (youtubeId: string | null) => renderToStaticMarkup(createElement(WalkthroughVideo, { youtubeId }));

describe("the walkthrough setting", () => {
  it("is null or a valid YouTube id", () => {
    expect(WALKTHROUGH_YOUTUBE_ID === null || isYouTubeId(WALKTHROUGH_YOUTUBE_ID)).toBe(true);
  });
});

describe("no video yet", () => {
  it("shows our cover with 'Video coming soon', and nothing from YouTube", () => {
    const out = html(null);
    expect(out).toContain("Video coming soon");
    expect(out).toContain('alt="How InkBoard works');
    expect(out).not.toMatch(/<iframe|<button/);
    expect(out).not.toMatch(YOUTUBE);
  });

  it("allows no frames in the CSP (frames fall back to default-src 'self')", () => {
    for (const dev of [false, true]) {
      const csp = buildCsp({ dev, youtubeId: null });
      expect(csp).not.toContain("frame-src");
      expect(csp).not.toMatch(YOUTUBE);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });
});

describe("with a video id", () => {
  it("shows a play button over the cover, and loads nothing from YouTube before it's pressed", () => {
    const out = html(ID);
    expect(out).toMatch(/<button[^>]*type="button"/);
    expect(out).toContain("Play the walkthrough");
    expect(out).not.toContain("<iframe");
    expect(out).not.toMatch(YOUTUBE);
    expect(out).not.toContain(ID);
  });

  it("then plays the youtube-nocookie.com player, autoplaying, with a title and our origin as referrer", () => {
    const out = renderToStaticMarkup(createElement(WalkthroughEmbed, { youtubeId: ID }));
    expect(out).toContain(`src="${YOUTUBE_EMBED_ORIGIN}/embed/${ID}?autoplay=1&amp;rel=0"`);
    expect(out).toContain('title="InkBoard walkthrough video"');
    expect(out).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(out).toContain("allowFullScreen");
  });

  it("allows exactly that origin in frame-src, and changes nothing else in the CSP", () => {
    for (const dev of [false, true]) {
      const without = buildCsp({ dev, youtubeId: null });
      const withVideo = buildCsp({ dev, youtubeId: ID });
      expect(withVideo.split("; ").filter((d) => !without.split("; ").includes(d))).toEqual([
        "frame-src https://www.youtube-nocookie.com",
      ]);
      expect(without.split("; ").filter((d) => !withVideo.split("; ").includes(d))).toEqual([]);
    }
  });

  it("refuses anything that isn't a video id in the player URL", () => {
    expect(walkthroughEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`);
    for (const bad of ["", "short", "dQw4w9WgXcQ?x=1", "../../evil", "dQw4w9WgXc/"]) {
      expect(() => walkthroughEmbedUrl(bad), bad).toThrow();
    }
  });
});
