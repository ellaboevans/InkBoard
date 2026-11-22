import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { env } from "@/env";
import { isDocumentRequest, readerPathFromPathname } from "@/lib/reader-paths";
import { SESSION_COOKIE } from "@/server/auth/cookie";
import { clientIpFromForwardedFor, ipBucket } from "@/server/auth/ip";
import { resolveOwner } from "@/server/auth/owner";
import { validateSession } from "@/server/auth/sessions";
import { readerPathExists } from "@/server/board";
import { handleShortLink, SHORT_LINK_CACHE_CONTROL } from "@/server/short-link-route";
import { countChapterShareVisit, countShareVisit, resolveShortCode } from "@/server/short-links";

/**
 * Two jobs, both before anything renders:
 *
 * 1. /admin: optimistic check only. Visitors without a session cookie are
 *    bounced to /sign-in. The real check (is the session valid?) happens in
 *    the Data Access Layer (src/server/auth/dal.ts) on every request.
 *    The owner's page (/admin/owner, Phase 32 round 3): on a full page load,
 *    anyone who isn't the owner is rewritten to /missing/page, so the status
 *    is a real 404 like any missing address (its requireOwner() is the check;
 *    a streamed notFound() there can't change the status).
 *
 * 2. Reader pages (/a/x, /a/x/c/y, /p/x/y, and the novel pages /a/x/n/y and
 *    /a/x/n/y/z of Phase 23b): real 404s (docs/PLAN.md, Phase 19).
 *    Under Cache Components the prerendered shell is sent first, which starts
 *    a 200 response; a `notFound()` inside the page then still renders "not
 *    found" (with noindex), but the status can no longer change. Next's docs
 *    point to Proxy for request-time 404s, so on a full page load we ask the
 *    database whether the page has anything to show, and if not rewrite the
 *    request to /missing/<kind>: a page that calls notFound() while it's
 *    prerendered, so it's served statically with a real 404, showing the same
 *    "Author / Poem / Collection not found" UI. (Rewriting to the page itself
 *    with `status: 404` works under `next dev` only: in production the
 *    prerendered shell resets the status to 200.) Soft navigations,
 *    prefetches and the board's poem overlay never match (see the matcher's
 *    `missing` and isDocumentRequest), so they don't wait on the query.
 *
 * 3. Short links (/s/<code>, docs/PLAN.md Phase 21 round 3): a published public
 *    poem's code is a 302 (no-store) to its page; anything else is the same
 *    rewrite to /missing/poem as a missing poem page, so a private poem's code
 *    looks like one that never existed (src/server/short-link-route.ts). A
 *    visit is counted after the response (event.waitUntil): the redirect
 *    never waits on the count or fails because of it.
 */
const SHORT_LINK = /^\/s\/([^/]+)\/?$/;
const MISSING_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

function missing(request: NextRequest, kind: string) {
  const res = NextResponse.rewrite(new URL(`/missing/${kind}`, request.url));
  // The static 404 page says "cache for a year"; this address could have a
  // page tomorrow (a new author, a published poem), so nothing may keep it.
  res.headers.set("Cache-Control", MISSING_CACHE_CONTROL);
  return res;
}

async function shortLink(request: NextRequest, event: NextFetchEvent, raw: string) {
  let outcome;
  try {
    outcome = await handleShortLink(request, raw, resolveShortCode);
  } catch (error) {
    // Not "missing": the link may well exist. Ask again in a moment.
    console.error("short link lookup failed", error);
    return new NextResponse("InkBoard couldn't open this link just now. Try again in a moment.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": MISSING_CACHE_CONTROL, "Retry-After": "30" },
    });
  }
  if (outcome.kind === "missing") return missing(request, "poem");
  const res = NextResponse.redirect(new URL(outcome.location, request.url), 302);
  res.headers.set("Cache-Control", SHORT_LINK_CACHE_CONTROL);
  res.headers.set("X-Robots-Tag", "noindex");
  if (outcome.count) {
    const bucket = ipBucket(clientIpFromForwardedFor(request.headers.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS));
    const counted = "chapterId" in outcome ? countChapterShareVisit(outcome.chapterId, bucket) : countShareVisit(outcome.poemId, bucket);
    event.waitUntil(counted.catch((error) => console.error("share visit not counted", error)));
  }
  return res;
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const short = SHORT_LINK.exec(pathname);
  if (short) {
    let raw: string;
    try {
      raw = decodeURIComponent(short[1]);
    } catch {
      return missing(request, "poem");
    }
    return shortLink(request, event, raw);
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
    if ((pathname === "/admin/owner" || pathname.startsWith("/admin/owner/")) && isDocumentRequest(request)) {
      let owner = true;
      try {
        owner = (await resolveOwner(await validateSession(request.cookies.get(SESSION_COOKIE)?.value ?? ""))) !== null;
      } catch (error) {
        // Fail open: the page's own requireOwner() still answers "not found".
        console.error("owner check failed", error);
      }
      if (!owner) return missing(request, "page");
    }
    return NextResponse.next();
  }

  const target = readerPathFromPathname(pathname);
  if (target && isDocumentRequest(request)) {
    let exists = true;
    try {
      exists = await readerPathExists(target);
    } catch (error) {
      // Fail open: the page renders as before (its own not-found UI, if any).
      console.error("reader 404 check failed", error);
    }
    if (!exists) return missing(request, target.kind);
  }
  return NextResponse.next();
}

// RSC requests (soft navigations, prefetches, the overlay) carry these headers.
// Literals only: Next reads the matcher statically and ignores variables. (Next
// also strips these headers before calling the proxy, so this is the only
// place they can be checked.)
export const config = {
  matcher: [
    "/admin/:path*",
    "/admin",
    // Short links: every request, even a prefetch (it must still not count).
    "/s/:code",
    {
      source: "/a/:author",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
      ],
    },
    {
      source: "/a/:author/c/:collection",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
      ],
    },
    {
      source: "/a/:author/n/:novel",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
      ],
    },
    {
      source: "/a/:author/n/:novel/:chapter",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
      ],
    },
    {
      source: "/p/:author/:poem",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
      ],
    },
  ],
};
