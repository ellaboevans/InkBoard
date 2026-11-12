import type { NextRequest } from "next/server";
import { env } from "@/env";
import { clientIpFromForwardedFor, ipBucket } from "@/server/auth/ip";
import { rateLimit } from "@/server/rate-limit";
import { searchBoard } from "@/server/search";

/**
 * GET /api/search?q=… : public board search (R10). Returns author and poem
 * *titles* only, never poem text (src/server/search.ts).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const ip = ipBucket(
    clientIpFromForwardedFor(request.headers.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS),
  );

  // Generous: one request per debounced keystroke is normal.
  const limit = await rateLimit(`search:ip:${ip}`, 120, 60);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many searches. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const results = await searchBoard(q);
  return Response.json(results, {
    // Results change as poems are published; don't let browsers keep them long.
    headers: { "Cache-Control": "private, max-age=10" },
  });
}
