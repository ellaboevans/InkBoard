import "server-only";
import { siteUrl } from "@/lib/site";

/**
 * The WebAuthn relying party, derived from APP_URL (siteUrl()): the RP ID is
 * its host name and the only accepted origin is its exact origin (scheme,
 * host and port). So localhost works in dev and E2E as long as APP_URL is the
 * URL the browser uses (playwright.config.ts sets it for the E2E server).
 */
export type RelyingParty = { id: string; name: string; origin: string };

export function relyingParty(): RelyingParty {
  const url = siteUrl();
  return { id: url.hostname, name: "InkBoard", origin: url.origin };
}
