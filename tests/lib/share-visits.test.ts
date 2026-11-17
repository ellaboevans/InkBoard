import { describe, expect, it } from "vitest";
import { countsAsVisit, isLinkPreviewBot, isPrefetch, LINK_PREVIEW_BOTS, SHARE_VISIT_WINDOW_SECONDS, shareVisitKey } from "@/lib/share-image/visits";

/* What counts as a visit through a short link (docs/PLAN.md, Phase 21 round 3). */

const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const CRAWLERS: Record<string, string> = {
  WhatsApp: "WhatsApp/2.24.21.84 A",
  "WhatsApp (iOS)": "WhatsApp/2.24.20.79 i",
  Facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  Facebot: "Facebot",
  Meta: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  Twitter: "Twitterbot/1.0",
  Slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "Slack images": "Slack-ImgProxy (+https://api.slack.com/robots)",
  Telegram: "TelegramBot (like TwitterBot)",
  Discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  LinkedIn: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  Skype: "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
  Pinterest: "Pinterestbot/1.0",
  Reddit: "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)",
  Apple: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)",
  Google: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Bing: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  Snapchat: "Mozilla/5.0 (compatible; Snapchat; +https://developers.snap.com/robots)",
  Viber: "Viber/21.6.0 (Android)",
  Iframely: "Iframely/1.3.1 (+https://iframely.com/docs/about)",
  "a generic crawler": "SomeCrawler/2.0 (+https://example.com/crawler)",
};

describe("link-preview crawlers", () => {
  for (const [name, ua] of Object.entries(CRAWLERS)) {
    it(`${name} isn't a visit`, () => {
      expect(isLinkPreviewBot(ua)).toBe(true);
      expect(countsAsVisit({ method: "GET", headers: new Headers({ "user-agent": ua }) })).toBe(false);
    });
  }

  it("every name on the list is caught, whatever its case", () => {
    for (const bot of LINK_PREVIEW_BOTS) {
      expect(isLinkPreviewBot(`Mozilla/5.0 ${bot}x`), bot).toBe(true);
      expect(isLinkPreviewBot(`Mozilla/5.0 ${bot.toUpperCase()}x`), bot).toBe(true);
    }
  });

  it("people's browsers aren't crawlers (WhatsApp's own in-app browser opens the poem in the phone's browser)", () => {
    for (const ua of [PHONE, IPHONE, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"]) {
      expect(isLinkPreviewBot(ua), ua).toBe(false);
    }
    expect(isLinkPreviewBot(null)).toBe(false);
  });
});

describe("prefetches", () => {
  it("Purpose / Sec-Purpose / X-Purpose / X-Moz prefetches and Next's router prefetches aren't visits", () => {
    const cases: Record<string, string>[] = [
      { purpose: "prefetch" },
      { "sec-purpose": "prefetch" },
      { "sec-purpose": "prefetch;prerender" },
      { "x-purpose": "preview" },
      { "x-moz": "prefetch" },
      { "next-router-prefetch": "1" },
    ];
    for (const h of cases) {
      const headers = new Headers({ ...h, "user-agent": PHONE });
      expect(isPrefetch(headers), JSON.stringify(h)).toBe(true);
      expect(countsAsVisit({ method: "GET", headers }), JSON.stringify(h)).toBe(false);
    }
  });
});

describe("countsAsVisit", () => {
  it("a person's GET counts; a HEAD doesn't", () => {
    expect(countsAsVisit({ method: "GET", headers: new Headers({ "user-agent": PHONE }) })).toBe(true);
    expect(countsAsVisit({ method: "GET", headers: new Headers() })).toBe(true);
    expect(countsAsVisit({ method: "HEAD", headers: new Headers({ "user-agent": PHONE }) })).toBe(false);
    expect(countsAsVisit({ method: "POST", headers: new Headers({ "user-agent": PHONE }) })).toBe(false);
  });

  it("repeats are skipped per network and poem for a day, in rate_limits", () => {
    expect(SHARE_VISIT_WINDOW_SECONDS).toBe(86_400);
    expect(shareVisitKey("p1", "203.0.113.7")).toBe("share:visit:p1:203.0.113.7");
  });
});
