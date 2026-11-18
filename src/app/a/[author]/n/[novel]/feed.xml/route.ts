import { ATOM_TYPE } from "@/lib/feed-links";
import { getNovelFeed } from "@/server/board-cache";

/** One novel's Atom feed of published chapters (docs/PLAN.md, Phase 24); 404 when readers can't see the novel. */
export async function GET(_request: Request, { params }: RouteContext<"/a/[author]/n/[novel]/feed.xml">) {
  const { author, novel } = await params;
  const xml = await getNovelFeed(author, novel);
  if (xml === null) return new Response("Novel not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(xml, { headers: { "Content-Type": `${ATOM_TYPE}; charset=utf-8` } });
}
