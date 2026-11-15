import { ATOM_TYPE } from "@/lib/feed-links";
import { getSiteFeed } from "@/server/board-cache";

/**
 * Atom feed of the newest published poems on the board (docs/PLAN.md,
 * Phase 12). Cached with BOARD_TAG (board-cache.ts), so it's prerendered and
 * follows every publish, edit, unpublish and rename.
 */
export async function GET() {
  return new Response(await getSiteFeed(), {
    headers: { "Content-Type": `${ATOM_TYPE}; charset=utf-8` },
  });
}
