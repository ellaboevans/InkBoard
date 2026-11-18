"use client";

import { useSyncExternalStore } from "react";
import { PAGES_CACHE_PREFIX, SAVED_INDEX_KEY } from "./rules";

/*
 * Which reader pages this device has saved for offline reading (the worker's
 * index, src/lib/offline/worker.ts), read straight from Cache Storage like
 * the offline page does. Used by the novel page to mark saved chapters
 * (Phase 24). Nothing here writes: only the worker saves pages. Without
 * CacheStorage (private windows, `next dev` before any worker) the set is
 * empty; on the server and while hydrating it's empty too, so the HTML is the
 * same for everyone.
 */

const EMPTY: ReadonlySet<string> = new Set();
let snapshot: ReadonlySet<string> = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

/** Read the index again (after a save) and tell every subscriber. */
export async function refreshSavedPages() {
  const urls = new Set<string>();
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith(PAGES_CACHE_PREFIX)) continue;
      const res = await (await caches.open(name)).match(SAVED_INDEX_KEY);
      for (const e of res ? ((await res.json()) as { url: string }[]) : []) urls.add(e.url);
    }
  } catch {
    // No CacheStorage: nothing saved.
  }
  snapshot = urls;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    void refreshSavedPages();
  }
  return () => listeners.delete(listener);
}

/** The saved pages' paths (`/a/x/n/y/z`), empty on the server. */
export function useSavedPages(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
