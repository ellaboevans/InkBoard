import { env } from "@/env";
import { clientIpFromForwardedFor, ipBucket } from "@/server/auth/ip";
import { rateLimit } from "@/server/rate-limit";
import { renderShareImage, shareImageEtag } from "@/server/share-image";
import { getShareImage, getSharePoem } from "@/server/share-image-cache";
import { ensureShortCode } from "@/server/short-links";
import { handleShareImage, SHARE_RENDER_LIMIT, shareRenderKey } from "@/server/share-image-route";

/*
 * GET /p/<author>/<poem>/share-image[?format=chat][&design=ink|board][&lines=3-6,9]: the "Share
 * as image" PNG of a published public poem (docs/PLAN.md, Phase 21). The
 * rules (404s, 400s, caching, the rate limit) are in src/server/share-image-route.ts.
 * A route handler sets its own status, so the proxy's real-404 check
 * (src/proxy.ts) isn't needed here and doesn't match this path. The service
 * worker passes it through and never stores it (src/lib/offline/rules.ts).
 */
export async function GET(request: Request, { params }: RouteContext<"/p/[author]/[poem]/share-image">) {
  return handleShareImage(request, await params, {
    getPoem: getSharePoem,
    getWholeImage: getShareImage,
    ensureShortCode,
    renderPicked: renderShareImage,
    etagFor: shareImageEtag,
    limitRender: () => {
      const ip = clientIpFromForwardedFor(request.headers.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS);
      return rateLimit(shareRenderKey(ipBucket(ip)), SHARE_RENDER_LIMIT.limit, SHARE_RENDER_LIMIT.windowSeconds);
    },
  });
}
