import { getSharePoem } from "@/server/share-image-cache";
import { handleShareLines } from "@/server/share-image-route";

/*
 * GET /p/<author>/<poem>/share-image/lines: a published public poem's lines
 * and language, for the share sheet's "Choose lines" (docs/PLAN.md, Phase 21
 * round 2). The same text the reading page shows, from the same cached
 * loader; the same 404 for anything else. Used by the reading page and the
 * dashboard alike, so writers get exactly what readers get.
 */
export async function GET(_request: Request, { params }: RouteContext<"/p/[author]/[poem]/share-image/lines">) {
  return handleShareLines(await params, getSharePoem);
}
