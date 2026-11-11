/**
 * Pick the client IP from X-Forwarded-For, trusting only the right-most
 * `trustedHops` entries (the ones our own proxies appended). Anything to the
 * left of that was supplied by the client and can be spoofed.
 *
 * Note: if the app is reachable *without* a proxy in front, the whole header
 * is client-controlled; deploy behind one (e.g. Vercel) for IP limits to hold.
 */
export function clientIpFromForwardedFor(
  header: string | null | undefined,
  trustedHops = 1,
): string | null {
  if (!header) return null;
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const ip = parts[Math.max(0, parts.length - trustedHops)];
  return ip.slice(0, 64);
}
