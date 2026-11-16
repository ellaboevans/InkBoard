/**
 * The Content Security Policy (next.config.ts). Static, without nonces: nonces
 * force every page to render dynamically, which would disable the prerendered
 * board (Partial Prerendering). `'unsafe-inline'` scripts are needed for Next's
 * inline RSC payload; the risk is limited because no user-supplied HTML is ever
 * rendered (poems are plain text, escaped by React). Everything else is locked
 * down: only our own origin, no framing of us, no plugins, forms only post to
 * us. `'unsafe-eval'` is dev-only (React Refresh).
 *
 * The one third-party origin is the walkthrough video's player
 * (WALKTHROUGH_YOUTUBE_ID in src/lib/site.ts), and only when a video id is set:
 * then `frame-src` allows youtube-nocookie.com and nothing else. It has to be
 * site-wide, not just /about: a soft navigation to /about keeps the CSP of the
 * page the reader first loaded.
 */

export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/** A YouTube video id as it appears in youtube.com/watch?v=<id>. */
export const isYouTubeId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);

/** The player URL, opened only after the reader presses play (so it may autoplay). */
export function walkthroughEmbedUrl(id: string): string {
  if (!isYouTubeId(id)) throw new Error(`Not a YouTube video id: ${JSON.stringify(id)}`);
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${id}?autoplay=1&rel=0`;
}

export function buildCsp({ dev, youtubeId }: { dev: boolean; youtubeId: string | null }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    // Sileo and Radix inject inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    // next/font self-hosts the Google fonts.
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    // Without a video, frames fall back to default-src 'self' (and we embed none).
    ...(youtubeId ? [`frame-src ${YOUTUBE_EMBED_ORIGIN}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
