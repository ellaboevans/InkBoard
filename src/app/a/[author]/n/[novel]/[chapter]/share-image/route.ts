import { env } from "@/env";
import { clientIpFromForwardedFor, ipBucket } from "@/server/auth/ip";
import { rateLimit } from "@/server/rate-limit";
import { passageImageEtag, renderPassageImage } from "@/server/share-image";
import { getShareChapter } from "@/server/share-image-cache";
import { handlePassageImage, SHARE_RENDER_LIMIT, shareRenderKey } from "@/server/share-image-route";
import { ensureChapterShortCode } from "@/server/short-links";

/*
 * GET /a/<author>/n/<novel>/<chapter>/share-image?passage=3.2-4[&format=chat][&design=ink|board]:
 * "Share a passage" (docs/PLAN.md, Phase 25), a PNG of a passage of a
 * published chapter of a public novel. The rules (404s, 400s, no server
 * cache, the shared rate limit) are in src/server/share-image-route.ts. Not a
 * reader page: the proxy's real-404 check doesn't match it and the service
 * worker passes it through.
 */
export async function GET(request: Request, { params }: RouteContext<"/a/[author]/n/[novel]/[chapter]/share-image">) {
  return handlePassageImage(request, await params, {
    getChapter: getShareChapter,
    ensureShortCode: ensureChapterShortCode,
    render: renderPassageImage,
    etagFor: passageImageEtag,
    limitRender: () => {
      const ip = clientIpFromForwardedFor(request.headers.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS);
      return rateLimit(shareRenderKey(ipBucket(ip)), SHARE_RENDER_LIMIT.limit, SHARE_RENDER_LIMIT.windowSeconds);
    },
  });
}
