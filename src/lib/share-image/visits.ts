/*
 * What counts as a visit through a short link (docs/PLAN.md, Phase 21 round 3).
 * Pure, so the list and the rules are tested in one place
 * (tests/lib/share-visits.test.ts).
 *
 * A visit is a GET of /s/<code> that redirects to a public poem, by a person:
 *   - not a HEAD (link checkers, previews that only ask for headers);
 *   - not a prefetch (browsers speculating: Purpose / Sec-Purpose: prefetch,
 *     X-Purpose: preview, X-Moz: prefetch, Next's own router prefetches);
 *   - not a link-preview crawler (LINK_PREVIEW_BOTS: WhatsApp fetches the
 *     link to draw its preview the moment someone pastes it, and so do the
 *     others);
 *   - and not a repeat: one visit per network (ipBucket) per poem per
 *     SHARE_VISIT_WINDOW_SECONDS, counted in rate_limits like every other
 *     limit, so no IP address or anything else about the visitor is stored.
 */

/** One visit per network per poem in this window. */
export const SHARE_VISIT_WINDOW_SECONDS = 86_400;

/**
 * Link-preview crawlers and other fetchers that aren't a person following the
 * link, matched case-insensitively anywhere in the User-Agent.
 */
export const LINK_PREVIEW_BOTS = [
  "WhatsApp",
  "facebookexternalhit",
  "Facebot",
  "meta-externalagent",
  "Twitterbot",
  "Slackbot",
  "Slack-ImgProxy",
  "TelegramBot",
  "Discordbot",
  "LinkedInBot",
  "SkypeUriPreview",
  "Pinterestbot",
  "redditbot",
  "Applebot",
  "Googlebot",
  "bingbot",
  "Snapchat",
  "Viber",
  "Iframely",
  "Embedly",
  "vkShare",
  "W3C_Validator",
  // Generic words crawlers put in their names.
  "bot/",
  "crawler",
  "spider",
  "preview",
] as const;

const BOT_PATTERN = new RegExp(LINK_PREVIEW_BOTS.map((b) => b.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|"), "i");

export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  return !!userAgent && BOT_PATTERN.test(userAgent);
}

/** A speculative fetch, not a person opening the link. */
export function isPrefetch(headers: Headers): boolean {
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""} ${headers.get("x-purpose") ?? ""} ${headers.get("x-moz") ?? ""}`.toLowerCase();
  return /\b(prefetch|preview)\b/.test(purpose) || headers.has("next-router-prefetch");
}

/** Whether this request, which resolved to a public poem, counts as a visit (before the per-network repeat check). */
export function countsAsVisit(request: { method: string; headers: Headers }): boolean {
  return request.method === "GET" && !isPrefetch(request.headers) && !isLinkPreviewBot(request.headers.get("user-agent"));
}

/** The rate_limits key that lets one network count once a day per poem. */
export const shareVisitKey = (poemId: string, bucket: string) => `share:visit:${poemId}:${bucket}`;
