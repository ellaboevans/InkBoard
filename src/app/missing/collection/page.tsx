import type { Metadata } from "next";
import { notFound } from "next/navigation";

/*
 * Where the proxy (src/proxy.ts) rewrites a full page load of an unknown
 * collection, or one with nothing published (docs/PLAN.md, Phase 19).
 *
 * notFound() runs at the top of the page, before anything streams: while the
 * page is prerendered (production: a static page served with a real 404) and
 * when `next dev` renders it on demand. The collection page itself can't do that:
 * under Cache Components its prerendered shell has already started the
 * response with a 200 by the time its own notFound() runs. The browser keeps
 * the address that was asked for. Opening /missing/collection directly is a 404 too.
 *
 * Under `next dev`, loading one logs "Could not validate `instant` because an
 * error prevented the target segment from rendering": dev's instant-navigation
 * check can't render a page that throws before streaming, and `instant = false`
 * doesn't silence it (the @modal slot's catch-all page is still checked). It's
 * dev-only (the build is clean) and these pages are never navigated to.
 */

export const metadata: Metadata = { title: "Collection not found" };

export default function MissingCollection() {
  notFound();
}
