import type { Metadata } from "next";
import { notFound } from "next/navigation";

/*
 * Where the proxy (src/proxy.ts) rewrites a full page load of the owner's page
 * (/admin/owner) for anyone who isn't the owner (docs/PLAN.md, Phase 32
 * round 3), so the answer is a real 404 with the same "not found" page as any
 * address that doesn't exist (no not-found.tsx here: the root's default).
 * The owner page's own requireOwner() is the check; this only fixes the status
 * code, which its streamed notFound() can't. See src/app/missing/poem/page.tsx.
 */

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function MissingPage() {
  notFound();
}
