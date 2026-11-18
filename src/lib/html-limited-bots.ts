/**
 * Who gets a page's metadata in the <head> (next.config.ts `htmlLimitedBots`).
 *
 * Reader pages other than the board build their metadata from `params`, so
 * under Cache Components Next streams it: the tags (canonical, feed links,
 * Open Graph) come at the end of the <body>, and React moves them into the
 * <head> when it hydrates. That's fine for browsers, but a feed reader's
 * autodiscovery reads the raw HTML without running scripts and looks for
 * <link rel="alternate" type="application/atom+xml"> in the <head>, so on an
 * author, collection, poem, novel or chapter page it found no feed. Only user
 * agents on this list get blocking metadata (the tags in the <head>).
 *
 * Setting `htmlLimitedBots` *replaces* Next's own list (Google's crawlers,
 * Bingbot, Twitterbot, Slackbot, WhatsApp, …), so the pattern is that list
 * plus feed readers. In production a listed agent also skips the prerendered
 * shell (Next renders its whole page at request time, since a shell has
 * already closed its <head>), which is why this stays a list of bots and feed
 * readers and never `/.*\/`: browsers keep the fast prerendered shell.
 */

/** Feed readers and the feed libraries they fetch with. Never a browser token. */
export const FEED_READER_UA_SOURCE = [
  "NetNewsWire",
  "Feedbin",
  "Feedly",
  "Inoreader",
  "NewsBlur",
  "Miniflux",
  "FreshRSS",
  "Tiny Tiny RSS",
  "The Old Reader",
  "Reeder",
  "ReadKit",
  "Vienna",
  "Feeder",
  "Liferea",
  "Akregator",
  "Thunderbird",
  "SimplePie",
  "Feedjira",
  "feedparser",
  "Rome Client",
  "FeedFetcher",
  "Feed-Fetcher",
  "\\bRSS\\b",
].join("|");

/** Next's default HTML-limited bots plus feed readers, as one case-insensitive pattern. */
export function htmlLimitedBots(nextDefault: RegExp): RegExp {
  return new RegExp(`${nextDefault.source}|${FEED_READER_UA_SOURCE}`, "i");
}
