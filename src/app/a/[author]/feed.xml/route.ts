import { ATOM_TYPE } from "@/lib/feed-links";
import { getAuthorFeed } from "@/server/board-cache";

/** One author's Atom feed (docs/PLAN.md, Phase 12); 404 for unknown authors. */
export async function GET(_request: Request, { params }: RouteContext<"/a/[author]/feed.xml">) {
  const { author } = await params;
  const xml = await getAuthorFeed(author);
  if (xml === null) return new Response("Author not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(xml, { headers: { "Content-Type": `${ATOM_TYPE}; charset=utf-8` } });
}
