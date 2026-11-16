import { connection } from "next/server";
import { serviceWorkerSource } from "@/lib/offline/worker";

/**
 * The service worker (docs/PLAN.md, Phase 15 round 2), from our own origin
 * with scope "/". Rendered per request (connection()) so these headers are
 * sent as written: `no-cache` makes the browser check for a new worker on
 * every navigation, and each build bakes in its own id, so a deploy is a new
 * worker. Registered only in production builds (ServiceWorkerRegistration).
 */
export async function GET() {
  await connection();
  return new Response(serviceWorkerSource(process.env.INKBOARD_BUILD_ID ?? "dev", process.env.INKBOARD_VAPID_PUBLIC_KEY ?? ""), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
