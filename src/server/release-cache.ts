import "server-only";
import { cacheLife } from "next/cache";
import { secondsToNextRelease } from "./chapter-release";

const HOUR = 3600;
const DAY = 86_400;

/**
 * The cache life of reader data that can show chapters (Phase 28): the
 * `hours` profile, with `revalidate` cut to the next scheduled release when
 * that comes sooner. Call once, inside a "use cache" function, instead of
 * cacheLife("hours").
 *
 * Per the Next 16 docs (cacheLife.md): after `revalidate` the next request is
 * served the cached copy and regenerates it in the background, so the first
 * request after a release still sees the old data and every one after it the
 * new. `stale` (5 min, the client router's reuse) and `expire` (1 day) stay as
 * in `hours`: an `expire` under 5 minutes or a `stale` under 30 s would take
 * the data out of the prerendered board. A cache made before a chapter was
 * scheduled still has its old life: scheduling calls updateTag(BOARD_TAG).
 */
export async function releaseAwareCacheLife(): Promise<void> {
  const s = await secondsToNextRelease();
  if (s === null || s >= HOUR) {
    cacheLife("hours");
    return;
  }
  cacheLife({ stale: 300, revalidate: Math.max(1, Math.ceil(s)), expire: DAY });
}
