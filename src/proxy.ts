import { NextResponse, type NextRequest } from "next/server";
import { isDocumentRequest, readerPathFromPathname } from "@/lib/reader-paths";
import { SESSION_COOKIE } from "@/server/auth/cookie";
import { readerPathExists } from "@/server/board";

/**
 * Two jobs, both before anything renders:
 *
 * 1. /admin: optimistic check only. Visitors without a session cookie are
 *    bounced to /sign-in. The real check (is the session valid?) happens in
 *    the Data Access Layer (src/server/auth/dal.ts) on every request.
 *
 * 2. Reader pages (/a/x, /a/x/c/y, /p/x/y): real 404s (docs/PLAN.md, Phase 19).
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
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
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
    if (!exists) {
      const res = NextResponse.rewrite(new URL(`/missing/${target.kind}`, request.url));
      // The static 404 page says "cache for a year"; this address could have a
      // page tomorrow (a new author, a published poem), so nothing may keep it.
      res.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
      return res;
    }
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
      source: "/p/:author/:poem",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
      ],
    },
  ],
};
