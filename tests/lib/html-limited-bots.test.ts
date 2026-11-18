import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { htmlLimitedBots } from "@/lib/html-limited-bots";

/*
 * Who gets reader pages' metadata (feed links, canonical) in the <head>
 * rather than streamed into the <body> (src/lib/html-limited-bots.ts).
 */
const pattern = htmlLimitedBots(HTML_LIMITED_BOT_UA_RE);

describe("htmlLimitedBots", () => {
  it("is what next.config.ts uses", () => {
    expect(nextConfig.htmlLimitedBots?.source).toBe(pattern.source);
    expect(nextConfig.htmlLimitedBots?.flags).toContain("i");
  });

  it.each([
    "NetNewsWire (RSS Reader; https://netnewswire.com/)",
    "Feedbin feed-id:1 - 1 subscribers",
    "Mozilla/5.0 (compatible; Inoreader/1.0; https://www.inoreader.com)",
    "Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)",
    "NewsBlur Feed Fetcher - 3 subscribers",
    "Miniflux/2.2.0 (https://miniflux.app)",
    "FreshRSS/1.24.0 (Linux; https://freshrss.org)",
    "Tiny Tiny RSS/24.05 (https://tt-rss.org/)",
    "SimplePie/1.8.0 (Feed Parser; http://simplepie.org)",
    "UniversalFeedParser/6.0.11 +https://github.com/kurtmckee/feedparser/",
    "Reeder/5.0 CFNetwork/1490 Darwin/23.2.0",
  ])("a feed reader gets the <head>: %s", (ua) => {
    expect(pattern.test(ua)).toBe(true);
  });

  it.each(["Twitterbot/1.0", "facebookexternalhit/1.1", "WhatsApp/2.23", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; bingbot/2.0)", "AdsBot-Google"])(
    "Next's own bots still do: %s",
    (ua) => {
      expect(HTML_LIMITED_BOT_UA_RE.test(ua)).toBe(true);
      expect(pattern.test(ua)).toBe(true);
    },
  );

  it.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    "Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_US]",
  ])("a browser keeps streamed metadata and the prerendered shell: %s", (ua) => {
    expect(pattern.test(ua)).toBe(false);
  });
});
