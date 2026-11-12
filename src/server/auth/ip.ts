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

/**
 * Rate-limit bucket for a client IP. IPv6 addresses are grouped by their
 * /64 prefix: one customer or server typically controls a whole /64, so
 * per-address limits there would be trivially sidestepped by rotating.
 * IPv4 (and IPv4-mapped IPv6) stay per address. Unknown -> one shared bucket.
 */
export function ipBucket(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  const raw = ip.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  if (!raw.includes(":")) return raw;

  // Expand "::" and take the first four hextets.
  const [head, tail = ""] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = raw.includes("::") && tail ? tail.split(":") : [];
  // An embedded IPv4 tail counts as two hextets.
  const width = (parts: string[]) => parts.reduce((n, p) => n + (p.includes(".") ? 2 : 1), 0);
  const missing = raw.includes("::") ? 8 - width(h) - width(t) : 0;
  const full = [...h, ...Array(Math.max(0, missing)).fill("0"), ...t];
  if (full.length < 4 || full.slice(0, 4).some((p) => !/^[0-9a-f]{1,4}$/.test(p))) {
    return raw.slice(0, 64); // not parseable: fall back to the raw value
  }
  return `${full.slice(0, 4).map((p) => p.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
