"use client";

import { useEffect } from "react";

/**
 * Registers the offline-reading worker (/sw.js) in production builds only.
 * Under `next dev` it instead removes any worker left by a production run on
 * the same origin, so dev pages and chunks are never served from its caches.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
      return;
    }
    // updateViaCache "none": every check fetches /sw.js from the network, so a deploy is picked up.
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
