import type { Metadata } from "next";
import { notFound } from "next/navigation";

/*
 * Where the proxy (src/proxy.ts) rewrites a full page load of a missing chapter
 * page (docs/PLAN.md, Phase 23b): unknown, or with nothing published. It works
 * like /missing/collection (see there): notFound() before anything streams,
 * so the static page is served with a real 404.
 */

export const metadata: Metadata = { title: "Chapter not found" };

export default function MissingChapter() {
  notFound();
}
