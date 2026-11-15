"use client";

import { useEffect } from "react";
import { SAVE_MESSAGE } from "@/lib/offline/rules";

const asked = new Set<string>();

/**
 * Asks the worker to keep a copy of this reader page. Needed for pages shown
 * by a soft navigation (the poem overlay never loads the page's HTML) and for
 * the first visit, before the worker controls the page. The worker fetches its
 * own cookie-less copy and applies the storage rules; nothing is sent from here
 * but the path. Once per path per page load (re-mounts and <Activity> re-shows
 * don't repeat it).
 */
export function SaveForOffline({ path }: { path: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || asked.has(path)) return;
    asked.add(path);
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: SAVE_MESSAGE, path }));
  }, [path]);
  return null;
}
