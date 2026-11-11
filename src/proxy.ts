import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie";

/**
 * Optimistic check only: bounce visitors without a session cookie away from
 * /admin before rendering. The real check (is the session valid?) happens in
 * the Data Access Layer (src/server/auth/dal.ts) on every request.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/admin"],
};
