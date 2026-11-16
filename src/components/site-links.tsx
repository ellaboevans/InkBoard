import { cn } from "cn";
import Link from "next/link";

const linkClass =
  "underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * "About InkBoard · Privacy": the quiet links at the foot of reader pages, the
 * list view, the sign-in screens, the not-found pages and the Privacy page
 * (docs/PLAN.md, Phase 19).
 * One `nav` per page ("Site"), so give each page at most one.
 */
export function SiteLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Site" className={cn("text-sm text-muted-foreground", className)}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li>
          <Link href="/about" className={linkClass}>
            About InkBoard
          </Link>
        </li>
        <li>
          <Link href="/privacy" className={linkClass}>
            Privacy
          </Link>
        </li>
      </ul>
    </nav>
  );
}
