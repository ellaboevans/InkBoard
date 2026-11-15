"use client";

import { CopyIcon, ExternalLinkIcon, RssIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ATOM_TYPE, SITE_FEED_PATH } from "@/lib/feed-links";
import { notify } from "@/lib/notify";

/**
 * "Subscribe" in the board toolbar (canvas and list view): a small popover
 * that says what a feed is, opens it, and copies its link (docs/PLAN.md,
 * Phase 12). Icon-only on phones, still named "Subscribe".
 *
 * `feedUrl` is the absolute URL from siteUrl(), resolved on the server (the
 * client has no APP_URL). The "Open feed" link is a plain <a>: it's XML, not
 * a page the router can render.
 */
export function SubscribeButton({ feedUrl, className }: { feedUrl: string; className?: string }) {
  const titleId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      notify.success("Feed link copied", "Paste it into your feed reader.");
    } catch {
      // No clipboard (permissions, insecure context): the URL is on screen to copy by hand.
      notify.error("Couldn't copy the link", `Copy it by hand: ${feedUrl}`);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("bg-background/85 backdrop-blur max-sm:w-7 max-sm:px-0", className)}>
          <RssIcon />
          {/* Icon-only on phones, but still named. */}
          <span className="max-sm:sr-only">Subscribe</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        aria-labelledby={titleId}
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <PopoverHeader>
          <PopoverTitle id={titleId}>Follow new poems</PopoverTitle>
          <PopoverDescription>
            Add this feed (RSS) to a feed reader app to see new poems as they&apos;re published. No account or email
            needed.
          </PopoverDescription>
        </PopoverHeader>
        <p className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all select-all" data-feed-url>
          {feedUrl}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={copy}>
            <CopyIcon />
            Copy feed link
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={SITE_FEED_PATH} type={ATOM_TYPE}>
              <ExternalLinkIcon />
              Open feed
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
