import { getShareChapter } from "@/server/share-image-cache";
import { handlePassageOutline } from "@/server/share-image-route";

/*
 * GET /a/<author>/n/<novel>/<chapter>/share-image/passage: the paragraphs and
 * sentences "Share a passage" picks from (docs/PLAN.md, Phase 25), the
 * novel's language and where the scene breaks are. The same cached loader
 * and the same 404 as the picture: nothing for a private novel's chapter.
 */
export async function GET(_request: Request, { params }: RouteContext<"/a/[author]/n/[novel]/[chapter]/share-image/passage">) {
  return handlePassageOutline(await params, getShareChapter);
}
