/**
 * A short, human label for a session's User-Agent ("Chrome on macOS"), for the
 * device list on the profile page. Deliberately rough: it only has to help an
 * editor recognise their own devices, not identify browsers precisely.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";

  // Order matters: Edge and Opera include "Chrome", Chrome includes "Safari".
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;

  const os =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
