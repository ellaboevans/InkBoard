"use client";

import { Analytics as VercelAnalytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics (cookieless page views), production builds only: in
 * development the SDK only logs, and its debug script comes from a host our
 * CSP doesn't allow. In production it loads from our own origin
 * (/_vercel/insights/*), which the CSP already permits.
 *
 * Every event's URL is reduced to origin + path before it leaves the
 * browser: the sign-in link carries its token in the fragment
 * (/sign-in/link#…), and query strings are never needed for page counts.
 */
function scrubUrl(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.hash = "";
  url.search = "";
  return { ...event, url: url.href };
}

export function Analytics() {
  if (process.env.NODE_ENV !== "production") return null;
  return <VercelAnalytics beforeSend={scrubUrl} />;
}
