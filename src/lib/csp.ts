/**
 * The Content Security Policy (next.config.ts). Static, without nonces: nonces
 * force every page to render dynamically, which would disable the prerendered
 * board (Partial Prerendering). `'unsafe-inline'` scripts are needed for Next's
 * inline RSC payload; the risk is limited because no user-supplied HTML is ever
 * rendered (poems are plain text, escaped by React). Everything else is locked
 * down: only our own origin, no framing of us, no plugins, forms only post to
 * us. `'unsafe-eval'` is dev-only (React Refresh).
 *
 * The one third-party origin is the walkthrough video's host
 * (WALKTHROUGH_VIDEO and WHATS_NEW_VIDEO in src/lib/site.ts), and only when one is set: then
 * `media-src` allows that origin (VIDEO_HOST_ORIGIN) and nothing else (no frames, no
 * scripts: the browser's own player streams it). It has to be site-wide, not
 * just /about: a soft navigation to /about keeps the CSP of the page the
 * reader first loaded.
 */

export function buildCsp({ dev, videoOrigin }: { dev: boolean; videoOrigin: string | null }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    // Sileo and Radix inject inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    // next/font self-hosts the Google fonts.
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    // Without a video, media falls back to default-src 'self'. We embed no frames.
    ...(videoOrigin ? [`media-src 'self' ${videoOrigin}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
